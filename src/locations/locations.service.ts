import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.location.findMany({
      include: {
        managers: { include: { user: { select: { id: true, name: true, email: true } } } },
        certifications: { include: { user: { select: { id: true, name: true } } } },
      },
    });
  }

  async findOne(id: string) {
    const location = await this.prisma.location.findUnique({
      where: { id },
      include: {
        managers: { include: { user: { select: { id: true, name: true, email: true } } } },
        certifications: { include: { user: { select: { id: true, name: true, role: true, skills: true } } } },
      },
    });
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async getOnDuty(locationId: string) {
    const now = new Date();
    const shifts = await this.prisma.shift.findMany({
      where: {
        locationId,
        published: true,
        startTime: { lte: now },
        endTime: { gte: now },
      },
      include: {
        assignments: {
          include: { user: { select: { id: true, name: true, email: true, skills: true } } },
        },
        location: true,
      },
    });

    return shifts.map((s) => ({
      shiftId: s.id,
      requiredSkill: s.requiredSkill,
      startTime: s.startTime,
      endTime: s.endTime,
      staff: s.assignments.map((a) => ({
        userId: a.userId,
        name: a.user.name,
        email: a.user.email,
        skills: a.user.skills,
      })),
    }));
  }

  async create(dto: CreateLocationDto) {
    return this.prisma.location.create({ data: dto });
  }

  async update(id: string, dto: Partial<CreateLocationDto>) {
    return this.prisma.location.update({ where: { id }, data: dto });
  }
}
