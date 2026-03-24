import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    shiftId?: string;
    swapId?: string;
    actorId?: string;
    action?: string;
    locationId?: string;
    limit?: number;
    offset?: number;
  }) {
    const { shiftId, swapId, actorId, action, locationId, limit = 50, offset = 0 } = filters;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          ...(shiftId && { shiftId }),
          ...(swapId && { swapId }),
          ...(actorId && { actorId }),
          ...(action && { action }),
          ...(locationId && {
            OR: [
              { shift: { locationId } },
              { swap: { shift: { locationId } } },
            ],
          }),
        },
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
          shift: { include: { location: { select: { id: true, name: true } } } },
          swap: { select: { id: true, type: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({
        where: {
          ...(shiftId && { shiftId }),
          ...(swapId && { swapId }),
          ...(actorId && { actorId }),
          ...(action && { action }),
          ...(locationId && {
            OR: [
              { shift: { locationId } },
              { swap: { shift: { locationId } } },
            ],
          }),
        },
      }),
    ]);

    return { logs, total, limit, offset };
  }
}
