import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogsService {
  constructor(private prisma: PrismaService) {}

  async exportCsv(filters: {
    locationId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<string> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        ...(filters.action && { action: filters.action }),
        ...(filters.startDate || filters.endDate ? {
          createdAt: {
            ...(filters.startDate && { gte: new Date(filters.startDate) }),
            ...(filters.endDate && { lte: new Date(filters.endDate) }),
          },
        } : {}),
        ...(filters.locationId && {
          OR: [
            { shift: { locationId: filters.locationId } },
            { swap: { shift: { locationId: filters.locationId } } },
          ],
        }),
      },
      include: {
        actor: { select: { name: true, email: true, role: true } },
        shift: { include: { location: { select: { name: true } } } },
        swap: { select: { id: true, type: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['timestamp', 'action', 'actor_name', 'actor_email', 'actor_role', 'location', 'shift_id', 'swap_id', 'note'].join(',');
    const rows = logs.map((l) =>
      [
        escape(l.createdAt.toISOString()),
        escape(l.action),
        escape(l.actor.name),
        escape(l.actor.email),
        escape(l.actor.role),
        escape(l.shift?.location.name ?? ''),
        escape(l.shiftId ?? ''),
        escape(l.swapId ?? ''),
        escape(l.note ?? ''),
      ].join(',')
    );
    return [header, ...rows].join('\n');
  }

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
