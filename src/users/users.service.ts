import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        desiredHoursPerWeek: true,
        skills: true,
        certifications: { include: { location: true } },
        managedLocations: { include: { location: true } },
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        desiredHoursPerWeek: true,
        skills: true,
        certifications: { include: { location: true } },
        managedLocations: { include: { location: true } },
        availability: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        desiredHoursPerWeek: true,
      },
    });
  }

  async addSkill(userId: string, skill: string) {
    return this.prisma.userSkill.upsert({
      where: { userId_skill: { userId, skill } },
      create: { userId, skill },
      update: {},
    });
  }

  async removeSkill(userId: string, skill: string) {
    return this.prisma.userSkill.delete({
      where: { userId_skill: { userId, skill } },
    });
  }

  async addCertification(userId: string, locationId: string) {
    return this.prisma.locationCertification.upsert({
      where: { userId_locationId: { userId, locationId } },
      create: { userId, locationId },
      update: {},
    });
  }

  async removeCertification(userId: string, locationId: string) {
    return this.prisma.locationCertification.delete({
      where: { userId_locationId: { userId, locationId } },
    });
  }
}
