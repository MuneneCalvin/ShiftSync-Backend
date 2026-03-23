import 'dotenv/config';
import { PrismaClient, Role, AvailabilityType, SwapType, SwapStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { addDays, startOfISOWeek, subWeeks } from 'date-fns';

const ssl = !process.env.DATABASE_URL?.includes('localhost') ? { rejectUnauthorized: false } : undefined;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, ssl });
const prisma = new PrismaClient({ adapter });

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// Get Monday 00:00 UTC of the ISO week containing the given date (pure UTC, no local timezone)
function getWeekOf(date: Date): Date {
  const utcDay = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToMonday = utcDay === 0 ? -6 : 1 - utcDay;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + daysToMonday));
}

async function main() {
  console.log('🌱 Seeding database...');

  // Clean up
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.swapRequest.deleteMany();
  await prisma.shiftAssignment.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.locationCertification.deleteMany();
  await prisma.userSkill.deleteMany();
  await prisma.managerLocation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.location.deleteMany();

  // ── Locations ──────────────────────────────────────────────────────────────
  const santaMonica = await prisma.location.create({
    data: { name: 'Coastal Eats — Santa Monica', timezone: 'America/Los_Angeles' },
  });
  const sanFrancisco = await prisma.location.create({
    data: { name: 'Coastal Eats — San Francisco', timezone: 'America/Los_Angeles' },
  });
  const newYork = await prisma.location.create({
    data: { name: 'Coastal Eats — New York', timezone: 'America/New_York' },
  });
  const miami = await prisma.location.create({
    data: { name: 'Coastal Eats — Miami', timezone: 'America/New_York' },
  });

  console.log('✅ Locations created');

  // ── Admin ──────────────────────────────────────────────────────────────────
  const admin = await prisma.user.create({
    data: {
      email: 'admin@coastaleats.com',
      name: 'Admin User',
      passwordHash: await hashPassword('Admin123!'),
      role: Role.ADMIN,
    },
  });

  // ── Managers ───────────────────────────────────────────────────────────────
  const managerLA = await prisma.user.create({
    data: {
      email: 'manager.la@coastaleats.com',
      name: 'Manager LA',
      passwordHash: await hashPassword('Manager1!'),
      role: Role.MANAGER,
      managedLocations: {
        create: [
          { locationId: santaMonica.id },
          { locationId: sanFrancisco.id },
        ],
      },
    },
  });

  const managerNYC = await prisma.user.create({
    data: {
      email: 'manager.nyc@coastaleats.com',
      name: 'Manager NYC',
      passwordHash: await hashPassword('Manager1!'),
      role: Role.MANAGER,
      managedLocations: {
        create: [
          { locationId: newYork.id },
          { locationId: miami.id },
        ],
      },
    },
  });

  console.log('✅ Admin and managers created');

  // ── Staff helper ───────────────────────────────────────────────────────────
  async function createStaff(
    email: string,
    name: string,
    skills: string[],
    certLocationIds: string[],
    desiredHoursPerWeek?: number,
  ) {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword('Staff123!'),
        role: Role.STAFF,
        desiredHoursPerWeek: desiredHoursPerWeek ?? 30,
        skills: {
          create: skills.map((skill) => ({ skill })),
        },
        certifications: {
          create: certLocationIds.map((locationId) => ({ locationId })),
        },
      },
    });

    // Add recurring availability 09:00-23:00 for each certified location
    for (const locationId of certLocationIds) {
      for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
        await prisma.availability.create({
          data: {
            userId: user.id,
            locationId,
            type: AvailabilityType.RECURRING,
            dayOfWeek,
            startTime: '09:00',
            endTime: '23:00', // generous window to cover evening shifts
          },
        });
      }
    }

    return user;
  }

  const alexRivera = await createStaff(
    'alex.rivera@coastaleats.com',
    'Alex Rivera',
    ['bartender', 'server'],
    [santaMonica.id, newYork.id],
    35,
  );

  const samChen = await createStaff(
    'sam.chen@coastaleats.com',
    'Sam Chen',
    ['bartender'],
    [santaMonica.id],
    30,
  );

  const mariaSantos = await createStaff(
    'maria.santos@coastaleats.com',
    'Maria Santos',
    ['bartender', 'line cook'],
    [santaMonica.id, sanFrancisco.id],
    32,
  );

  const jordanKim = await createStaff(
    'jordan.kim@coastaleats.com',
    'Jordan Kim',
    ['server', 'host'],
    [newYork.id, miami.id],
    40,
  );

  const caseyOkafor = await createStaff(
    'casey.okafor@coastaleats.com',
    'Casey Okafor',
    ['server'],
    [santaMonica.id],
    30,
  );

  const taylorNguyen = await createStaff(
    'taylor.nguyen@coastaleats.com',
    'Taylor Nguyen',
    ['line cook'],
    [sanFrancisco.id, newYork.id],
    32,
  );

  const jamiePark = await createStaff(
    'jamie.park@coastaleats.com',
    'Jamie Park',
    ['host', 'server'],
    [miami.id],
    28,
  );

  const drewHassan = await createStaff(
    'drew.hassan@coastaleats.com',
    'Drew Hassan',
    ['bartender', 'host'],
    [santaMonica.id, miami.id],
    35,
  );

  console.log('✅ Staff created');

  // ── Dates ──────────────────────────────────────────────────────────────────
  const now = new Date();
  const currentWeekOf = getWeekOf(now);

  // Find the upcoming Sunday (or today if Sunday)
  const dayOfWeek = now.getDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const upcomingSunday = addDays(now, daysUntilSunday);

  // Sunday 7pm PT = Sunday 19:00 America/Los_Angeles
  // In UTC during PDT (UTC-7): 02:00 Monday UTC
  // We'll store as a reasonable UTC equivalent; for seed purposes use 03:00 UTC next Monday
  const sundayShiftStart = new Date(upcomingSunday);
  sundayShiftStart.setUTCHours(3, 0, 0, 0); // 7pm PDT (UTC-7) = 02:00 UTC; use 03:00 to be safe
  const sundayShiftEnd = new Date(sundayShiftStart);
  sundayShiftEnd.setUTCHours(sundayShiftStart.getUTCHours() + 4); // 4-hour shift

  // ── Published schedule at Santa Monica ────────────────────────────────────
  // Create the published 7pm Sunday callout shift
  const sundayCalloutShift = await prisma.shift.create({
    data: {
      locationId: santaMonica.id,
      requiredSkill: 'bartender',
      headcount: 2,
      startTime: sundayShiftStart,
      endTime: sundayShiftEnd,
      isOvernight: false,
      published: true,
      publishedAt: new Date(),
      weekOf: currentWeekOf,
    },
  });

  // Assign samChen to the Sunday shift (he'll be the one "calling out")
  await prisma.shiftAssignment.create({
    data: {
      shiftId: sundayCalloutShift.id,
      userId: samChen.id,
      assignedBy: managerLA.id,
    },
  });

  // Also assign drewHassan to fill the 2nd headcount spot
  await prisma.shiftAssignment.create({
    data: {
      shiftId: sundayCalloutShift.id,
      userId: drewHassan.id,
      assignedBy: managerLA.id,
    },
  });

  console.log('✅ Published Sunday shift at Santa Monica');

  // ── Jordan Kim: 34 hours this week ────────────────────────────────────────
  // Create shifts in New York to total 34 hours
  // 4 shifts × 8.5 hours = 34 hours
  const jordanShifts = [];
  for (let i = 0; i < 4; i++) {
    const shiftDay = addDays(currentWeekOf, i); // Mon, Tue, Wed, Thu
    // 11am ET = 16:00 UTC (EDT, UTC-4)
    const shiftStart = new Date(shiftDay);
    shiftStart.setUTCHours(16, 0, 0, 0);
    const shiftEnd = new Date(shiftStart);
    shiftEnd.setUTCHours(shiftStart.getUTCHours() + 8);
    shiftEnd.setUTCMinutes(30); // 8.5 hours

    const shift = await prisma.shift.create({
      data: {
        locationId: newYork.id,
        requiredSkill: 'server',
        headcount: 2,
        startTime: shiftStart,
        endTime: shiftEnd,
        published: true,
        publishedAt: new Date(),
        weekOf: currentWeekOf,
      },
    });

    await prisma.shiftAssignment.create({
      data: {
        shiftId: shift.id,
        userId: jordanKim.id,
        assignedBy: managerNYC.id,
      },
    });

    jordanShifts.push(shift);
  }

  console.log('✅ Jordan Kim seeded at 34 hours this week');

  // ── Casey Okafor: no Saturday evening shifts in past 6 weeks ─────────────
  // Give other staff Saturday evening shifts but not Casey
  // Saturday evenings = Sat 17:00–23:00 PT = Sat 00:00–06:00 UTC (next day)
  for (let w = 1; w <= 6; w++) {
    const weekStart = subWeeks(currentWeekOf, w);
    const saturday = addDays(weekStart, 5); // Saturday
    // 5pm PT = midnight UTC (PDT UTC-7 → 00:00 UTC next day)
    const satStart = new Date(saturday);
    satStart.setUTCHours(0, 0, 0, 0); // midnight UTC = 5pm PDT prior day... let's use 00:00 UTC of Sunday
    // Actually: Saturday 17:00 PDT = Saturday 17:00 + 7 = Saturday 24:00 = Sunday 00:00 UTC
    const satEveStart = new Date(addDays(saturday, 1));
    satEveStart.setUTCHours(0, 0, 0, 0);
    const satEveEnd = new Date(satEveStart);
    satEveEnd.setUTCHours(6, 0, 0, 0); // 23:00 PDT = 06:00 UTC

    const satShift = await prisma.shift.create({
      data: {
        locationId: santaMonica.id,
        requiredSkill: 'server',
        headcount: 2,
        startTime: satEveStart,
        endTime: satEveEnd,
        published: true,
        publishedAt: subWeeks(now, w),
        weekOf: weekStart,
      },
    });

    // Assign alexRivera and mariaSantos — NOT Casey
    await prisma.shiftAssignment.create({
      data: {
        shiftId: satShift.id,
        userId: alexRivera.id,
        assignedBy: managerLA.id,
      },
    });
  }

  console.log('✅ Casey Okafor has 0 Saturday evening shifts (past 6 weeks)');

  // ── Taylor <-> Drew pending SWAP ──────────────────────────────────────────
  // Create a shift for Taylor at San Francisco
  const swapShiftStartFixed = new Date(addDays(currentWeekOf, 2));
  swapShiftStartFixed.setUTCHours(18, 0, 0, 0);
  const swapShiftEndFixed = new Date(swapShiftStartFixed);
  swapShiftEndFixed.setTime(swapShiftStartFixed.getTime() + 6 * 60 * 60 * 1000); // +6 hours

  const swapShift = await prisma.shift.create({
    data: {
      locationId: sanFrancisco.id,
      requiredSkill: 'line cook',
      headcount: 1,
      startTime: swapShiftStartFixed,
      endTime: swapShiftEndFixed,
      published: true,
      publishedAt: new Date(),
      weekOf: currentWeekOf,
    },
  });

  await prisma.shiftAssignment.create({
    data: {
      shiftId: swapShift.id,
      userId: taylorNguyen.id,
      assignedBy: managerLA.id,
    },
  });

  const swapExpiresAt = new Date(swapShiftStartFixed.getTime() - 24 * 60 * 60 * 1000);

  await prisma.swapRequest.create({
    data: {
      type: SwapType.SWAP,
      requesterId: taylorNguyen.id,
      targetUserId: drewHassan.id,
      shiftId: swapShift.id,
      status: SwapStatus.PENDING,
      expiresAt: swapExpiresAt,
    },
  });

  console.log('✅ Pending SWAP between Taylor and Drew');

  // ── Draft shift with constraint violation demo ────────────────────────────
  // A shift requiring 'line cook' at Santa Monica where no line cook is certified there except mariaSantos
  // We'll create a draft shift — the violation is demonstrated when trying to assign someone without the skill
  const draftShiftStart = addDays(currentWeekOf, 4); // Friday
  draftShiftStart.setUTCHours(20, 0, 0, 0);
  const draftShiftEnd = new Date(draftShiftStart);
  draftShiftEnd.setTime(draftShiftStart.getTime() + 4 * 60 * 60 * 1000);

  await prisma.shift.create({
    data: {
      locationId: santaMonica.id,
      requiredSkill: 'line cook',
      headcount: 1,
      startTime: draftShiftStart,
      endTime: draftShiftEnd,
      published: false,
      weekOf: currentWeekOf,
    },
  });

  console.log('✅ Draft shift for constraint violation demo');

  // ── Audit log for initial assignments ─────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      action: 'SEED_COMPLETE',
      actorId: admin.id,
      note: 'Initial seed completed',
    },
  });

  console.log('✅ Seed complete!');
  console.log('\n📋 Test Credentials:');
  console.log('  Admin:    admin@coastaleats.com / Admin123!');
  console.log('  Manager:  manager.la@coastaleats.com / Manager1!');
  console.log('  Manager:  manager.nyc@coastaleats.com / Manager1!');
  console.log('  Staff:    alex.rivera@coastaleats.com / Staff123!');
  console.log('  Staff:    casey.okafor@coastaleats.com / Staff123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
