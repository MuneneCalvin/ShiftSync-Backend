import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConstraintEngineService } from '../constraint-engine/constraint-engine.service';
import { CreateSwapDto } from './dto/create-swap.dto';
import { SwapStatus, SwapType } from '@prisma/client';
import { EventsGateway } from '../gateway/events.gateway';

@Injectable()
export class SwapsService {
  constructor(
    private prisma: PrismaService,
    private constraintEngine: ConstraintEngineService,
    private gateway: EventsGateway,
  ) {}

  async findAll(filters: { requesterId?: string; locationId?: string; status?: SwapStatus }) {
    return this.prisma.swapRequest.findMany({
      where: {
        ...(filters.requesterId && { requesterId: filters.requesterId }),
        ...(filters.status && { status: filters.status }),
        ...(filters.locationId && { shift: { locationId: filters.locationId } }),
      },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        targetUser: { select: { id: true, name: true, email: true } },
        shift: { include: { location: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const swap = await this.prisma.swapRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        targetUser: { select: { id: true, name: true, email: true } },
        shift: { include: { location: true, assignments: true } },
      },
    });
    if (!swap) throw new NotFoundException('Swap request not found');
    return swap;
  }

  async create(dto: CreateSwapDto, requesterId: string) {
    // Enforce max 3 pending requests
    const pendingCount = await this.prisma.swapRequest.count({
      where: { requesterId, status: { in: [SwapStatus.PENDING, SwapStatus.ACCEPTED] } },
    });
    if (pendingCount >= 3) {
      throw new BadRequestException('You cannot have more than 3 pending swap or drop requests at once.');
    }

    // Verify requester is assigned to the shift
    const assignment = await this.prisma.shiftAssignment.findUnique({
      where: { shiftId_userId: { shiftId: dto.shiftId, userId: requesterId } },
      include: { shift: true },
    });
    if (!assignment) {
      throw new BadRequestException('You are not assigned to this shift.');
    }

    if (dto.type === SwapType.SWAP && !dto.targetUserId) {
      throw new BadRequestException('targetUserId is required for SWAP requests.');
    }

    const expiresAt = new Date(assignment.shift.startTime.getTime() - 24 * 60 * 60 * 1000);

    const swap = await this.prisma.swapRequest.create({
      data: {
        type: dto.type,
        requesterId,
        targetUserId: dto.targetUserId ?? null,
        shiftId: dto.shiftId,
        status: SwapStatus.PENDING,
        expiresAt,
      },
      include: {
        requester: { select: { id: true, name: true } },
        targetUser: { select: { id: true, name: true } },
        shift: { include: { location: true } },
      },
    });

    await this.createNotification(requesterId, 'SWAP_CREATED', 'Swap Request Submitted',
      `Your ${dto.type} request for the shift has been submitted.`);

    if (dto.targetUserId) {
      await this.createNotification(dto.targetUserId, 'SWAP_REQUESTED', 'Swap Request Received',
        `${swap.requester.name} has requested to swap shifts with you.`);
    }

    await this.prisma.auditLog.create({
      data: { action: 'SWAP_CREATED', actorId: requesterId, swapId: swap.id },
    });

    // Notify all managers of the shift's location
    const shiftManagers = await this.prisma.managerLocation.findMany({
      where: { locationId: swap.shift.locationId },
      select: { userId: true },
    });
    for (const m of shiftManagers) {
      this.gateway.emitToManager(m.userId, 'swap:requested', { swap });
    }

    return swap;
  }

  async accept(swapId: string, userId: string) {
    const swap = await this.findOne(swapId);

    if (swap.status !== SwapStatus.PENDING) {
      throw new BadRequestException('Swap request is no longer pending.');
    }

    // For SWAP: target user must accept
    if (swap.type === SwapType.SWAP) {
      if (swap.targetUserId !== userId) {
        throw new ForbiddenException('Only the target user can accept this swap.');
      }
    } else {
      // DROP: any qualified staff can pick up (just needs to be certified + have skill)
      const shift = swap.shift;
      const hasSkill = await this.prisma.userSkill.findFirst({
        where: { userId, skill: shift.requiredSkill },
      });
      const hasCert = await this.prisma.locationCertification.findUnique({
        where: { userId_locationId: { userId, locationId: shift.locationId } },
      });
      if (!hasSkill || !hasCert) {
        throw new BadRequestException('You do not have the required skill or certification for this shift.');
      }
    }

    const updated = await this.prisma.swapRequest.update({
      where: { id: swapId },
      data: {
        status: SwapStatus.MANAGER_REVIEW,
        targetApproved: true,
        targetUserId: swap.type === SwapType.DROP ? userId : swap.targetUserId,
      },
      include: {
        requester: { select: { id: true, name: true } },
        targetUser: { select: { id: true, name: true } },
        shift: { include: { location: true } },
      },
    });

    // Notify manager
    const managers = await this.prisma.managerLocation.findMany({
      where: { locationId: swap.shift.locationId },
      select: { userId: true },
    });
    for (const m of managers) {
      await this.createNotification(m.userId, 'SWAP_PENDING_REVIEW', 'Swap Awaiting Approval',
        `A ${swap.type} request for a shift at ${swap.shift.location.name} needs your review.`);
      this.gateway.emitToManager(m.userId, 'swap:requested', { swap: updated });
    }

    await this.createNotification(swap.requesterId, 'SWAP_ACCEPTED', 'Swap Accepted',
      `Your swap request has been accepted and is awaiting manager approval.`);

    await this.prisma.auditLog.create({
      data: { action: 'SWAP_ACCEPTED', actorId: userId, swapId },
    });

    this.gateway.emitToUser(swap.requesterId, 'swap:status_changed', { swapId, status: 'MANAGER_REVIEW' });
    this.gateway.emitToUser(userId, 'swap:status_changed', { swapId, status: 'MANAGER_REVIEW' });

    return updated;
  }

  async approve(swapId: string, managerId: string) {
    const swap = await this.findOne(swapId);

    if (swap.status !== SwapStatus.MANAGER_REVIEW) {
      throw new BadRequestException('Swap is not in MANAGER_REVIEW state.');
    }

    // Re-run constraint engine for the target user
    const targetUserId = swap.targetUserId!;
    const constraintResult = await this.constraintEngine.check({
      userId: targetUserId,
      shiftId: swap.shiftId,
      managerId,
    });

    if (!constraintResult.allowed) {
      return {
        success: false,
        message: 'Swap can no longer be approved — constraint violations exist.',
        violations: constraintResult.violations,
        suggestions: constraintResult.suggestions,
      };
    }

    // Update assignments: remove requester, add target
    await this.prisma.$transaction([
      this.prisma.shiftAssignment.delete({
        where: { shiftId_userId: { shiftId: swap.shiftId, userId: swap.requesterId } },
      }),
      this.prisma.shiftAssignment.create({
        data: { shiftId: swap.shiftId, userId: targetUserId, assignedBy: managerId },
      }),
      this.prisma.swapRequest.update({
        where: { id: swapId },
        data: { status: SwapStatus.APPROVED, managerApproved: true },
      }),
    ]);

    // Notify both parties
    await this.createNotification(swap.requesterId, 'SWAP_APPROVED', 'Swap Approved',
      'Your swap request has been approved. You are no longer assigned to the shift.');
    await this.createNotification(targetUserId, 'SWAP_APPROVED', 'Shift Assigned',
      'The swap was approved. You are now assigned to the shift.');

    await this.prisma.auditLog.create({
      data: { action: 'SWAP_APPROVED', actorId: managerId, swapId, shiftId: swap.shiftId },
    });

    this.gateway.emitToUser(swap.requesterId, 'swap:status_changed', { swapId, status: 'APPROVED' });
    this.gateway.emitToUser(targetUserId, 'swap:status_changed', { swapId, status: 'APPROVED' });
    this.gateway.emitToLocation(swap.shift.locationId, 'schedule:updated', { shiftId: swap.shiftId });

    return { success: true };
  }

  async cancel(swapId: string, userId: string) {
    const swap = await this.findOne(swapId);

    // Only requester can cancel, only before manager approval
    if (swap.requesterId !== userId) {
      throw new ForbiddenException('Only the requester can cancel this swap.');
    }
    const cancellableStatuses: SwapStatus[] = [SwapStatus.PENDING, SwapStatus.ACCEPTED];
    if (!cancellableStatuses.includes(swap.status)) {
      throw new BadRequestException('Swap can only be cancelled before manager approval.');
    }

    await this.prisma.swapRequest.update({
      where: { id: swapId },
      data: { status: SwapStatus.CANCELLED },
    });

    // Notify target if one exists
    if (swap.targetUserId) {
      await this.createNotification(swap.targetUserId, 'SWAP_CANCELLED', 'Swap Cancelled',
        `${swap.requester.name} has cancelled their swap request.`);
    }

    await this.prisma.auditLog.create({
      data: { action: 'SWAP_CANCELLED', actorId: userId, swapId },
    });

    if (swap.targetUserId) {
      this.gateway.emitToUser(swap.targetUserId, 'swap:status_changed', { swapId, status: 'CANCELLED' });
    }

    return { success: true };
  }

  async reject(swapId: string, managerId: string) {
    const swap = await this.findOne(swapId);
    if (swap.status !== SwapStatus.MANAGER_REVIEW) {
      throw new BadRequestException('Swap is not in MANAGER_REVIEW state.');
    }

    await this.prisma.swapRequest.update({
      where: { id: swapId },
      data: { status: SwapStatus.CANCELLED, managerApproved: false },
    });

    await this.createNotification(swap.requesterId, 'SWAP_REJECTED', 'Swap Rejected',
      'Your swap request was rejected by the manager. Your original assignment remains.');
    if (swap.targetUserId) {
      await this.createNotification(swap.targetUserId, 'SWAP_REJECTED', 'Swap Rejected',
        'The swap request was rejected by the manager.');
    }

    await this.prisma.auditLog.create({
      data: { action: 'SWAP_REJECTED', actorId: managerId, swapId },
    });

    this.gateway.emitToUser(swap.requesterId, 'swap:status_changed', { swapId, status: 'CANCELLED' });
    if (swap.targetUserId) {
      this.gateway.emitToUser(swap.targetUserId, 'swap:status_changed', { swapId, status: 'CANCELLED' });
    }

    return { success: true };
  }

  // Cron job: runs every 15 minutes
  async expireDropRequests() {
    const expired = await this.prisma.swapRequest.findMany({
      where: {
        type: SwapType.DROP,
        status: SwapStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      select: { id: true, requesterId: true },
    });

    if (expired.length === 0) return;

    await this.prisma.swapRequest.updateMany({
      where: { id: { in: expired.map((e) => e.id) } },
      data: { status: SwapStatus.EXPIRED },
    });

    for (const swap of expired) {
      await this.createNotification(swap.requesterId, 'DROP_EXPIRED', 'Drop Request Expired',
        'Your drop request expired with no one picking up the shift.');
      this.gateway.emitToUser(swap.requesterId, 'swap:status_changed', { swapId: swap.id, status: 'EXPIRED' });
    }
  }

  private async createNotification(userId: string, type: string, title: string, body: string) {
    return this.prisma.notification.create({
      data: { userId, type, title, body },
    });
  }
}
