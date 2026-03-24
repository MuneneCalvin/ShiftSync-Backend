import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async findByUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(id: string, userId: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, emailEnabled: false, pushEnabled: true },
      update: {},
    });
  }

  async updatePreferences(userId: string, dto: { emailEnabled?: boolean; pushEnabled?: boolean }) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, emailEnabled: dto.emailEnabled ?? false, pushEnabled: dto.pushEnabled ?? true },
      update: dto,
    });
  }
}
