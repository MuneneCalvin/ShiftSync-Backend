import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertAvailabilityDto } from './dto/upsert-availability.dto';

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  async findByUser(userId: string) {
    return this.prisma.availability.findMany({ where: { userId } });
  }

  async upsert(userId: string, dto: UpsertAvailabilityDto) {
    return this.prisma.availability.create({
      data: {
        userId,
        type: dto.type,
        locationId: dto.locationId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        date: dto.date ? new Date(dto.date) : undefined,
        isBlocked: dto.isBlocked ?? false,
      },
    });
  }

  async remove(id: string) {
    return this.prisma.availability.delete({ where: { id } });
  }
}
