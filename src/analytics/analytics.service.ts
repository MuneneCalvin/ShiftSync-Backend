import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfISOWeek, endOfISOWeek, subWeeks, differenceInMinutes } from 'date-fns';

export interface StaffHoursSummary {
  userId: string;
  name: string;
  email: string;
  totalHours: number;
  weeklyBreakdown: { weekOf: string; hours: number }[];
  premiumEveningShifts: number; // Fri + Sat evenings
  desiredHoursPerWeek: number | null;
  hoursVariance: number | null; // actual - desired
}

export interface OvertimeSummary {
  userId: string;
  name: string;
  weekOf: string;
  totalHours: number;
  overtimeHours: number; // hours beyond 40
  shifts: { shiftId: string; date: string; hours: number; locationName: string }[];
}

export interface FairnessReport {
  locationId: string;
  locationName: string;
  staff: StaffHoursSummary[];
  fairnessScore: number; // 0-100, higher = more fair distribution
  premiumEveningDistribution: { userId: string; name: string; count: number }[];
}

function shiftHours(startTime: Date, endTime: Date): number {
  return differenceInMinutes(endTime, startTime) / 60;
}

function isPremiumEvening(shift: { startTime: Date; endTime: Date }): boolean {
  // Premium = Friday or Saturday evening (20:00+ UTC, or the next day's 00:00-06:00 UTC)
  const start = shift.startTime;
  const day = start.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
  const hour = start.getUTCHours();
  // Saturday evening: Sat 20:00+ or Sun 00:00-06:00
  const satEve = (day === 6 && hour >= 20) || (day === 0 && hour >= 0 && hour <= 6);
  // Friday evening: Fri 20:00+ or Sat 00:00-06:00
  const friEve = (day === 5 && hour >= 20) || (day === 6 && hour >= 0 && hour <= 6);
  return satEve || friEve;
}

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getOvertimeReport(weeksBack = 4): Promise<OvertimeSummary[]> {
    const now = new Date();
    const results: OvertimeSummary[] = [];

    for (let w = 0; w < weeksBack; w++) {
      const weekStart = startOfISOWeek(subWeeks(now, w));
      const weekEnd = endOfISOWeek(subWeeks(now, w));

      const assignments = await this.prisma.shiftAssignment.findMany({
        where: {
          shift: {
            startTime: { gte: weekStart, lte: weekEnd },
            published: true,
          },
        },
        include: {
          shift: { include: { location: true } },
          user: true,
        },
      });

      // Group by user
      const byUser = new Map<string, typeof assignments>();
      for (const a of assignments) {
        if (!byUser.has(a.userId)) byUser.set(a.userId, []);
        byUser.get(a.userId)!.push(a);
      }

      for (const [userId, userAssignments] of byUser) {
        const totalHours = userAssignments.reduce(
          (sum, a) => sum + shiftHours(a.shift.startTime, a.shift.endTime),
          0,
        );

        if (totalHours > 40) {
          results.push({
            userId,
            name: userAssignments[0].user.name,
            weekOf: weekStart.toISOString(),
            totalHours: Math.round(totalHours * 10) / 10,
            overtimeHours: Math.round((totalHours - 40) * 10) / 10,
            shifts: userAssignments.map((a) => ({
              shiftId: a.shiftId,
              date: a.shift.startTime.toISOString(),
              hours: Math.round(shiftHours(a.shift.startTime, a.shift.endTime) * 10) / 10,
              locationName: a.shift.location.name,
            })),
          });
        }
      }
    }

    return results.sort((a, b) => b.overtimeHours - a.overtimeHours);
  }

  async getFairnessReport(locationId: string, weeksBack = 6): Promise<FairnessReport> {
    const location = await this.prisma.location.findUniqueOrThrow({
      where: { id: locationId },
    });

    const now = new Date();
    const since = subWeeks(startOfISOWeek(now), weeksBack);

    // All certified staff at this location
    const certs = await this.prisma.locationCertification.findMany({
      where: { locationId },
      include: { user: { include: { assignments: { include: { shift: true } } } } },
    });

    const staffMap = new Map<string, (typeof certs)[0]['user']>();
    for (const c of certs) {
      if (c.user.role === 'STAFF') staffMap.set(c.userId, c.user);
    }

    // All published shifts at this location in window
    const shifts = await this.prisma.shift.findMany({
      where: {
        locationId,
        published: true,
        startTime: { gte: since },
      },
      include: {
        assignments: { include: { user: true } },
      },
    });

    // Build per-staff summaries
    const staff: StaffHoursSummary[] = [];

    for (const [userId, user] of staffMap) {
      const myShifts = shifts.flatMap((s) =>
        s.assignments.filter((a) => a.userId === userId).map(() => s),
      );

      const totalHours = myShifts.reduce(
        (sum, s) => sum + shiftHours(s.startTime, s.endTime),
        0,
      );

      const satEveShifts = myShifts.filter(isPremiumEvening).length;

      // Weekly breakdown
      const weekMap = new Map<string, number>();
      for (const s of myShifts) {
        const wk = startOfISOWeek(s.startTime).toISOString();
        weekMap.set(wk, (weekMap.get(wk) ?? 0) + shiftHours(s.startTime, s.endTime));
      }

      const weeklyBreakdown = Array.from(weekMap.entries())
        .map(([weekOf, hours]) => ({ weekOf, hours: Math.round(hours * 10) / 10 }))
        .sort((a, b) => a.weekOf.localeCompare(b.weekOf));

      const desired = user.desiredHoursPerWeek;
      const avgWeeklyActual = weeksBack > 0 ? totalHours / weeksBack : 0;

      staff.push({
        userId,
        name: user.name,
        email: user.email,
        totalHours: Math.round(totalHours * 10) / 10,
        weeklyBreakdown,
        premiumEveningShifts: satEveShifts,
        desiredHoursPerWeek: desired,
        hoursVariance: desired !== null ? Math.round((avgWeeklyActual - desired) * 10) / 10 : null,
      });
    }

    staff.sort((a, b) => b.totalHours - a.totalHours);

    // Fairness score: based on coefficient of variation of weekly hours
    // Lower CV = more fair = higher score
    const allHours = staff.map((s) => s.totalHours);
    const mean = allHours.length > 0 ? allHours.reduce((a, b) => a + b, 0) / allHours.length : 0;
    const variance =
      allHours.length > 0
        ? allHours.reduce((sum, h) => sum + Math.pow(h - mean, 2), 0) / allHours.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;
    const fairnessScore = Math.round(Math.max(0, Math.min(100, (1 - cv) * 100)));

    const premiumEveningDistribution = staff
      .map((s) => ({ userId: s.userId, name: s.name, count: s.premiumEveningShifts }))
      .sort((a, b) => b.count - a.count);

    return {
      locationId,
      locationName: location.name,
      staff,
      fairnessScore,
      premiumEveningDistribution,
    };
  }

  async getHoursDistribution(
    locationId: string,
    weeksBack = 8,
  ): Promise<{ weekOf: string; staff: { name: string; hours: number }[] }[]> {
    const now = new Date();
    const results = [];

    for (let w = 0; w < weeksBack; w++) {
      const weekStart = startOfISOWeek(subWeeks(now, w));
      const weekEnd = endOfISOWeek(subWeeks(now, w));

      const assignments = await this.prisma.shiftAssignment.findMany({
        where: {
          shift: {
            locationId,
            startTime: { gte: weekStart, lte: weekEnd },
            published: true,
          },
        },
        include: { shift: true, user: true },
      });

      const byUser = new Map<string, { name: string; hours: number }>();
      for (const a of assignments) {
        if (!byUser.has(a.userId)) {
          byUser.set(a.userId, { name: a.user.name, hours: 0 });
        }
        byUser.get(a.userId)!.hours += shiftHours(a.shift.startTime, a.shift.endTime);
      }

      results.push({
        weekOf: weekStart.toISOString(),
        staff: Array.from(byUser.values())
          .map((s) => ({ ...s, hours: Math.round(s.hours * 10) / 10 }))
          .sort((a, b) => b.hours - a.hours),
      });
    }

    return results.sort((a, b) => a.weekOf.localeCompare(b.weekOf));
  }
}
