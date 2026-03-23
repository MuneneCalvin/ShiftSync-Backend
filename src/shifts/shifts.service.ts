import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConstraintEngineService } from '../constraint-engine/constraint-engine.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { EventsGateway } from '../gateway/events.gateway';

@Injectable()
export class ShiftsService {
  constructor(
    private prisma: PrismaService,
    private constraintEngine: ConstraintEngineService,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private gateway: EventsGateway,
  ) {}

  async findByLocationAndWeek(locationId?: string, weekOf?: string) {
    return this.prisma.shift.findMany({
      where: {
        ...(locationId && { locationId }),
        ...(weekOf && { weekOf: new Date(weekOf) }),
      },
      include: {
        location: true,
        assignments: {
          include: {
            user: {
              select: { id: true, name: true, email: true, skills: true },
            },
          },
        },
        swapRequests: { where: { status: { in: ['PENDING', 'ACCEPTED', 'MANAGER_REVIEW'] } } },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        location: true,
        assignments: {
          include: { user: { select: { id: true, name: true, email: true, skills: true } } },
        },
      },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  async create(dto: CreateShiftDto, managerId: string) {
    const shift = await this.prisma.shift.create({
      data: {
        locationId: dto.locationId,
        requiredSkill: dto.requiredSkill,
        headcount: dto.headcount,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        isOvernight: dto.isOvernight ?? false,
        weekOf: new Date(dto.weekOf),
      },
      include: { location: true },
    });

    await this.prisma.auditLog.create({
      data: { action: 'SHIFT_CREATED', actorId: managerId, shiftId: shift.id, after: shift as any },
    });

    return shift;
  }

  async publish(shiftId: string, managerId: string) {
    // Auto-cancel any PENDING/ACCEPTED swaps for this shift
    await this.prisma.swapRequest.updateMany({
      where: { shiftId, status: { in: ['PENDING', 'ACCEPTED'] } },
      data: { status: 'CANCELLED' },
    });

    const shift = await this.prisma.shift.update({
      where: { id: shiftId },
      data: { published: true, publishedAt: new Date() },
      include: { location: true, assignments: { include: { user: { select: { id: true, name: true } } } } },
    });

    await this.prisma.auditLog.create({
      data: { action: 'SHIFT_PUBLISHED', actorId: managerId, shiftId, after: shift as any },
    });

    this.gateway.emitToLocation(shift.locationId, 'schedule:published', { shift });

    return shift;
  }

  async checkConstraints(shiftId: string, userId: string, managerId: string) {
    return this.constraintEngine.check({ userId, shiftId, managerId });
  }

  async assign(shiftId: string, dto: AssignShiftDto, managerId: string) {
    const lockKey = `lock:user:${dto.userId}`;
    const lock = await this.redis.set(lockKey, '1', 'PX', 3000, 'NX');

    if (!lock) {
      this.gateway.emitToManager(managerId, 'conflict:concurrent', {
        message: 'Another manager is currently assigning this person. Please wait a moment.',
      });
      throw new BadRequestException(
        'Another manager is currently assigning this person. Please wait a moment.',
      );
    }

    try {
      const result = await this.constraintEngine.check({
        userId: dto.userId,
        shiftId,
        managerId,
        overrideOvertimeReason: dto.overrideOvertimeReason,
      });

      if (!result.allowed) {
        return { success: false, ...result };
      }

      // Check headcount not exceeded
      const shift = await this.prisma.shift.findUniqueOrThrow({
        where: { id: shiftId },
        include: { assignments: true },
      });
      if (shift.assignments.length >= shift.headcount) {
        throw new BadRequestException('Shift headcount is already full.');
      }

      const assignment = await this.prisma.shiftAssignment.create({
        data: { shiftId, userId: dto.userId, assignedBy: managerId },
        include: { user: { select: { id: true, name: true, email: true } }, shift: { include: { location: true } } },
      });

      // Log override if provided
      if (dto.overrideOvertimeReason) {
        await this.prisma.auditLog.create({
          data: {
            action: 'OVERTIME_OVERRIDE',
            actorId: managerId,
            shiftId,
            note: dto.overrideOvertimeReason,
          },
        });
      }

      await this.prisma.auditLog.create({
        data: { action: 'ASSIGNMENT_CREATED', actorId: managerId, shiftId, after: assignment as any },
      });

      this.gateway.emitToUser(dto.userId, 'assignment:created', { assignment });
      this.gateway.emitToLocation(assignment.shift.locationId, 'assignment:created', { assignment });
      if (result.violations.some((v) => v.rule === 'OVERTIME')) {
        this.gateway.emitToManager(managerId, 'overtime:warning', {
          userId: dto.userId,
          projectedWeeklyHours: result.projectedWeeklyHours,
        });
      }

      return { success: true, assignment, ...result };
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async unassign(shiftId: string, userId: string, managerId: string) {
    // Cancel any pending swaps for this user+shift
    await this.prisma.swapRequest.updateMany({
      where: { shiftId, requesterId: userId, status: { in: ['PENDING', 'ACCEPTED', 'MANAGER_REVIEW'] } },
      data: { status: 'CANCELLED' },
    });

    const assignment = await this.prisma.shiftAssignment.delete({
      where: { shiftId_userId: { shiftId, userId } },
    });

    await this.prisma.auditLog.create({
      data: { action: 'ASSIGNMENT_DELETED', actorId: managerId, shiftId, before: assignment as any },
    });

    const updatedShift = await this.prisma.shift.findUnique({ where: { id: shiftId } });
    if (updatedShift) {
      this.gateway.emitToLocation(updatedShift.locationId, 'schedule:updated', { shiftId });
    }

    return { success: true };
  }

  async update(shiftId: string, data: Partial<CreateShiftDto>, managerId: string) {
    const before = await this.prisma.shift.findUnique({ where: { id: shiftId } });

    // Auto-cancel PENDING/ACCEPTED swaps when shift is edited
    await this.prisma.swapRequest.updateMany({
      where: { shiftId, status: { in: ['PENDING', 'ACCEPTED'] } },
      data: { status: 'CANCELLED' },
    });

    const shift = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        ...(data.requiredSkill && { requiredSkill: data.requiredSkill }),
        ...(data.headcount && { headcount: data.headcount }),
        ...(data.startTime && { startTime: new Date(data.startTime) }),
        ...(data.endTime && { endTime: new Date(data.endTime) }),
        ...(data.isOvernight !== undefined && { isOvernight: data.isOvernight }),
      },
      include: { location: true },
    });

    await this.prisma.auditLog.create({
      data: { action: 'SHIFT_EDITED', actorId: managerId, shiftId, before: before as any, after: shift as any },
    });

    this.gateway.emitToLocation(shift.locationId, 'schedule:updated', { shift });

    return shift;
  }
}
