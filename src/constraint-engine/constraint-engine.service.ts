import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toZonedTime } from 'date-fns-tz';
import { differenceInHours, differenceInMinutes, startOfDay, differenceInDays, isSameDay, startOfISOWeek, endOfISOWeek } from 'date-fns';

export interface Violation {
  rule: string;
  message: string;
  severity: 'BLOCK' | 'WARN';
}

export interface Suggestion {
  userId: string;
  name: string;
  reason: string;
}

export interface ConstraintResult {
  allowed: boolean;
  violations: Violation[];
  suggestions: Suggestion[];
  projectedWeeklyHours?: number;
}

export interface CheckInput {
  userId: string;
  shiftId: string;
  managerId: string;
  overrideOvertimeReason?: string;
  /** Internal flag: skip suggestion lookup to avoid infinite recursion */
  _isSuggestionCheck?: boolean;
}

@Injectable()
export class ConstraintEngineService {
  constructor(private prisma: PrismaService) {}

  async check(input: CheckInput): Promise<ConstraintResult> {
    const violations: Violation[] = [];

    const [user, shift] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: input.userId },
        include: {
          skills: true,
          certifications: true,
          assignments: {
            include: { shift: { include: { location: true } } },
          },
        },
      }),
      this.prisma.shift.findUniqueOrThrow({
        where: { id: input.shiftId },
        include: { location: true },
      }),
    ]);

    // ── 1. SKILL_MATCH ─────────────────────────────────────────────────────
    const hasSkill = user.skills.some((s) => s.skill === shift.requiredSkill);
    if (!hasSkill) {
      violations.push({
        rule: 'SKILL_MATCH',
        message: `${user.name} doesn't have the '${shift.requiredSkill}' skill.`,
        severity: 'BLOCK',
      });
    }

    // ── 2. LOCATION_CERT ───────────────────────────────────────────────────
    const hasCert = user.certifications.some((c) => c.locationId === shift.locationId);
    if (!hasCert) {
      violations.push({
        rule: 'LOCATION_CERT',
        message: `${user.name} isn't certified at ${shift.location.name}.`,
        severity: 'BLOCK',
      });
    }

    // ── 3. AVAILABILITY ────────────────────────────────────────────────────
    const tz = shift.location.timezone;
    const shiftStartLocal = toZonedTime(shift.startTime, tz);
    const shiftEndLocal = toZonedTime(shift.endTime, tz);
    const shiftDayOfWeek = shiftStartLocal.getDay(); // 0=Sun..6=Sat
    const shiftStartHHMM = `${String(shiftStartLocal.getHours()).padStart(2, '0')}:${String(shiftStartLocal.getMinutes()).padStart(2, '0')}`;
    const shiftEndHHMM = `${String(shiftEndLocal.getHours()).padStart(2, '0')}:${String(shiftEndLocal.getMinutes()).padStart(2, '0')}`;

    const availability = await this.prisma.availability.findMany({
      where: { userId: input.userId, locationId: shift.locationId },
    });

    // Check for blocked exceptions first
    const blockedException = availability.find(
      (a) =>
        a.type === 'EXCEPTION' &&
        a.isBlocked &&
        a.date &&
        isSameDay(toZonedTime(a.date, tz), shiftStartLocal),
    );

    if (blockedException) {
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][shiftDayOfWeek];
      violations.push({
        rule: 'AVAILABILITY',
        message: `${user.name} is unavailable on ${dayName} (blocked exception).`,
        severity: 'BLOCK',
      });
    } else {
      // Check recurring availability for this day
      const recurringForDay = availability.filter(
        (a) => a.type === 'RECURRING' && a.dayOfWeek === shiftDayOfWeek && !a.isBlocked,
      );

      if (recurringForDay.length === 0) {
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][shiftDayOfWeek];
        violations.push({
          rule: 'AVAILABILITY',
          message: `${user.name} has no availability set for ${dayName} at ${shift.location.name}.`,
          severity: 'BLOCK',
        });
      } else {
        // Check if shift falls within any availability window
        const shiftCovered = recurringForDay.some((a) => {
          return a.startTime <= shiftStartHHMM && a.endTime >= shiftEndHHMM;
        });

        if (!shiftCovered) {
          const window = recurringForDay.map((a) => `${a.startTime}–${a.endTime}`).join(', ');
          const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][shiftDayOfWeek];
          violations.push({
            rule: 'AVAILABILITY',
            message: `${user.name} is unavailable ${dayName} ${shiftStartHHMM}. Their window is ${window}.`,
            severity: 'BLOCK',
          });
        }
      }
    }

    // ── 4. DOUBLE_BOOK ─────────────────────────────────────────────────────
    const overlapping = user.assignments.find((a) => {
      const s = a.shift;
      if (s.id === input.shiftId) return false;
      return s.startTime < shift.endTime && s.endTime > shift.startTime;
    });
    if (overlapping) {
      const loc = overlapping.shift.location.name;
      const start = toZonedTime(overlapping.shift.startTime, overlapping.shift.location.timezone);
      const end = toZonedTime(overlapping.shift.endTime, overlapping.shift.location.timezone);
      const fmt = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      violations.push({
        rule: 'DOUBLE_BOOK',
        message: `${user.name} is already assigned at ${loc} ${fmt(start)}–${fmt(end)}.`,
        severity: 'BLOCK',
      });
    }

    // ── 5. REST_PERIOD ─────────────────────────────────────────────────────
    for (const a of user.assignments) {
      if (a.shift.id === input.shiftId) continue;
      const gapAfter = differenceInHours(shift.startTime, a.shift.endTime);
      const gapBefore = differenceInHours(a.shift.startTime, shift.endTime);
      if (gapAfter >= 0 && gapAfter < 10) {
        const workedUntil = toZonedTime(a.shift.endTime, a.shift.location.timezone);
        const fmt = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        violations.push({
          rule: 'REST_PERIOD',
          message: `${user.name} worked until ${fmt(workedUntil)} — only ${gapAfter}hr rest before this shift. Min is 10hr.`,
          severity: 'BLOCK',
        });
        break;
      }
      if (gapBefore >= 0 && gapBefore < 10) {
        const fmt = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        const shiftEnd = toZonedTime(shift.endTime, tz);
        void fmt;
        void shiftEnd;
        violations.push({
          rule: 'REST_PERIOD',
          message: `${user.name} would have only ${gapBefore}hr rest before their next shift. Min is 10hr.`,
          severity: 'BLOCK',
        });
        break;
      }
    }

    // ── 6. OVERTIME ────────────────────────────────────────────────────────
    const weekStart = startOfISOWeek(shift.startTime);
    const weekEnd = endOfISOWeek(shift.startTime);

    const weekAssignments = user.assignments.filter((a) => {
      return a.shift.startTime >= weekStart && a.shift.startTime <= weekEnd && a.shift.id !== input.shiftId;
    });

    const existingMinutes = weekAssignments.reduce((sum, a) => {
      return sum + differenceInMinutes(a.shift.endTime, a.shift.startTime);
    }, 0);

    const newShiftMinutes = differenceInMinutes(shift.endTime, shift.startTime);
    const totalMinutes = existingMinutes + newShiftMinutes;
    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

    if (totalHours >= 40) {
      if (input.overrideOvertimeReason) {
        // overtimeOverridden = true — override accepted, no violation
      } else {
        violations.push({
          rule: 'OVERTIME',
          message: `${user.name} will have ${totalHours}hr this week. Overtime requires override.`,
          severity: 'BLOCK',
        });
      }
    } else if (totalHours >= 35) {
      violations.push({
        rule: 'OVERTIME',
        message: `${user.name} will have ${totalHours}hr this week. Approaching overtime.`,
        severity: 'WARN',
      });
    }

    // Daily overtime checks
    const shiftDurationHours = newShiftMinutes / 60;
    if (shiftDurationHours > 12) {
      violations.push({
        rule: 'DAILY_OVERTIME',
        message: `This shift is ${shiftDurationHours.toFixed(1)}hr long. Daily maximum is 12hr.`,
        severity: 'BLOCK',
      });
    } else if (shiftDurationHours > 8) {
      violations.push({
        rule: 'DAILY_OVERTIME',
        message: `This shift is ${shiftDurationHours.toFixed(1)}hr long. Daily warning threshold is 8hr.`,
        severity: 'WARN',
      });
    }

    // Consecutive days check
    const consecutiveDays = this.getConsecutiveDays(user.assignments.map((a) => a.shift), shift);
    if (consecutiveDays >= 7) {
      if (!input.overrideOvertimeReason) {
        violations.push({
          rule: 'CONSECUTIVE_DAYS',
          message: `${user.name} would work ${consecutiveDays} consecutive days. Requires manager override.`,
          severity: 'BLOCK',
        });
      }
    } else if (consecutiveDays >= 6) {
      violations.push({
        rule: 'CONSECUTIVE_DAYS',
        message: `${user.name} would work ${consecutiveDays} consecutive days.`,
        severity: 'WARN',
      });
    }

    const blockCount = violations.filter((v) => v.severity === 'BLOCK').length;
    const allowed = blockCount === 0;

    // ── Suggestions (when blocked) ─────────────────────────────────────────
    const suggestions: Suggestion[] = [];
    if (!allowed && !input._isSuggestionCheck) {
      suggestions.push(...(await this.findSuggestions(input.userId, input.shiftId, shift.requiredSkill, shift.locationId)));
    }

    return { allowed, violations, suggestions, projectedWeeklyHours: totalHours };
  }

  private getConsecutiveDays(existingShifts: { startTime: Date }[], newShift: { startTime: Date }): number {
    const allShifts = [...existingShifts, newShift];
    const workedDates = allShifts
      .map((s) => startOfDay(s.startTime).getTime())
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => a - b)
      .map((t) => new Date(t));

    if (workedDates.length === 0) return 0;

    let streak = 1;
    for (let i = workedDates.length - 1; i > 0; i--) {
      if (differenceInDays(workedDates[i], workedDates[i - 1]) === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  async findSuggestions(failedUserId: string, shiftId: string, requiredSkill: string, locationId: string): Promise<Suggestion[]> {
    const candidates = await this.prisma.user.findMany({
      where: {
        id: { not: failedUserId },
        role: 'STAFF',
        skills: { some: { skill: requiredSkill } },
        certifications: { some: { locationId } },
      },
      include: {
        skills: true,
        certifications: true,
        assignments: {
          include: { shift: { include: { location: true } } },
        },
      },
    });

    const suggestions: Suggestion[] = [];
    for (const candidate of candidates) {
      const result = await this.check({
        userId: candidate.id,
        shiftId,
        managerId: 'system',
        _isSuggestionCheck: true,
      });
      if (result.violations.filter((v) => v.severity === 'BLOCK').length === 0) {
        suggestions.push({
          userId: candidate.id,
          name: candidate.name,
          reason: `Has '${requiredSkill}' skill, certified at location, no conflicts.`,
        });
      }
    }
    return suggestions;
  }
}
