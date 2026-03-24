# ShiftSync

A full-stack multi-location staff scheduling platform built for Coastal Eats.

**Live URLs**
- Frontend: https://shift-sync-app.vercel.app
- Backend API: https://13.244.142.224.nip.io

---

## Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@coastaleats.com | Admin123! |
| Manager (LA/SF) | manager.la@coastaleats.com | Manager1! |
| Manager (NYC/Miami) | manager.nyc@coastaleats.com | Manager1! |
| Staff | alex.rivera@coastaleats.com | Staff123! |
| Staff | sam.chen@coastaleats.com | Staff123! |
| Staff | maria.santos@coastaleats.com | Staff123! |
| Staff | jordan.kim@coastaleats.com | Staff123! |
| Staff | casey.okafor@coastaleats.com | Staff123! |
| Staff | taylor.nguyen@coastaleats.com | Staff123! |
| Staff | jamie.park@coastaleats.com | Staff123! |
| Staff | drew.hassan@coastaleats.com | Staff123! |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router), Tailwind CSS, TanStack Query, socket.io-client |
| Backend | NestJS 11, TypeScript, Passport JWT |
| Database | PostgreSQL 18 via Prisma v7 + `@prisma/adapter-pg` |
| Cache / Locks | Redis (ioredis v5) |
| Real-time | Socket.io 4 |
| Deployment | Vercel (frontend), AWS EC2 + Nginx + Docker (backend) |

---

## Deployment Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│         Vercel              │        │           AWS EC2 Instance           │
│                             │        │                                      │
│   Next.js 15 (SSR/SSG)      │──────▶ │  Nginx (reverse proxy, SSL termination)
│   shift-sync-app.vercel.app │        │           │                          │
└─────────────────────────────┘        │           ▼                          │
                                       │  ┌─────────────────────────────┐    │
                                       │  │       Docker Compose        │    │
                                       │  │                             │    │
                                       │  │  ┌──────────┐  ┌────────┐  │    │
                                       │  │  │ NestJS   │  │ Redis  │  │    │
                                       │  │  │ :3001    │  │ :6379  │  │    │
                                       │  │  └────┬─────┘  └────────┘  │    │
                                       │  │       │                     │    │
                                       │  │  ┌────▼────────────────┐   │    │
                                       │  │  │    PostgreSQL        │   │    │
                                       │  │  │    :5432            │   │    │
                                       │  │  └─────────────────────┘   │    │
                                       │  └─────────────────────────────┘    │
                                       └──────────────────────────────────────┘
```

- **Nginx** handles HTTPS via nip.io SSL certificate and proxies to the NestJS container on port 3001
- **Docker Compose** orchestrates NestJS, PostgreSQL, and Redis as isolated containers
- **nip.io** provides DNS resolution for the EC2 public IP (`13.244.142.224.nip.io`)

---

## Evaluator Scenarios

### Scenario 1 — Skill mismatch
Assign **Jordan Kim** (skills: server, host) to the Sunday **bartender** shift at Santa Monica.
- Constraint engine returns `BLOCK: SKILL_MATCH` — Jordan doesn't have the bartender skill.
- UI shows red ViolationBanner; assignment is rejected.

### Scenario 2 — Overtime warning
Jordan Kim already has 34h scheduled this week (Mon–Thu at New York).
Attempt to assign Jordan to another 8.5h shift:
- Constraint engine returns `WARN: DAILY_OVERTIME` (shift is 8.5h, threshold is 8h).
- Manager can override with a written reason.

### Scenario 3 — Pending swap
A `SWAP` request from **Taylor Nguyen → Drew Hassan** for the Wednesday SF line cook shift is pre-seeded with status `PENDING`.
- Visible in the Manager's **Swap Requests** page.
- Manager can Approve (re-runs constraint engine) or Reject.
- State machine: `PENDING → ACCEPTED → MANAGER_REVIEW → APPROVED`.

### Scenario 4 — Location certification block
Attempt to assign **Casey Okafor** (certified at Santa Monica only) to the San Francisco line cook shift:
- Constraint engine returns `BLOCK: LOCATION_CERT` + `BLOCK: SKILL_MATCH`.
- Suggestions list shows staff who are both certified and available.

### Scenario 5 — Fairness complaint
Open **Analytics → Fairness** tab, select Coastal Eats — Santa Monica:
- Alex Rivera has 6 Saturday evening shifts in the past 6 weeks.
- Casey Okafor has **0** Saturday evening shifts — highlighted with a callout banner.
- Fairness score reflects the unequal distribution.

### Scenario 6 — Sam Chen callout
The Sunday 7pm shift at Santa Monica has **headcount 2**, with Sam Chen and Drew Hassan assigned and the shift published.
- Sam calling out = manager removes Sam's assignment via the schedule grid.
- The shift still has Drew; manager can assign a replacement from the suggestions list (Alex Rivera qualifies: has bartender skill + SM cert).

---

## Architecture Decisions & Ambiguities

### Prisma v7 driver adapter
Prisma v7 removed the `url = env("DATABASE_URL")` field from `schema.prisma`. The datasource URL is now provided exclusively via `@prisma/adapter-pg` passed to `new PrismaClient({ adapter })`. A `prisma.config.ts` file handles the Prisma CLI.

### Week calculation (UTC)
`weekOf` is stored as the Monday 00:00 UTC of the ISO week. All calculations use `getUTCDay()` to avoid local timezone shifts (e.g., UTC-8 where midnight UTC = previous local day).

### Constraint engine — never short-circuits
All 6 rules (SKILL_MATCH, LOCATION_CERT, AVAILABILITY, DOUBLE_BOOK, REST_PERIOD, OVERTIME) run on every check, collecting all violations at once. This gives managers the full picture rather than fixing errors one by one.

### Overtime threshold
The spec says "flag overtime". Interpreted as:
- `WARN` at > 40h/week projected (overridable with reason)
- `BLOCK` at > 60h/week projected (hard stop)
- `WARN` for single shifts > 8h (daily threshold)

### Swap state machine
`DROP` requests (no target user) expire automatically via a `@Cron('*/15 * * * *')` job that sets status to `EXPIRED` when `expiresAt` passes. `SWAP` requests require target acceptance before entering `MANAGER_REVIEW`.

### Redis distributed lock
Before creating a `ShiftAssignment`, a Redis lock is acquired with a 3-second TTL using `SET key 1 PX 3000 NX`. Concurrent assignments to the same shift queue naturally — the second request re-runs the constraint engine after the first commits. Lock key: `shift:assign:{shiftId}`.

### Real-time rooms
Socket.io rooms are mapped on connection:
- `user:{id}` — personal notifications
- `location:{locationId}` — one room per certified location (staff) or managed location (manager)
- `admin` — all admin-level events

### CORS
`CORS_ORIGIN` env var accepts comma-separated origins. Falls back to `origin: true` (mirror) if not set.

### SSL on Docker
The NestJS app connects to PostgreSQL and Redis on the Docker internal network (no SSL needed). The `DATABASE_SSL` env var drives SSL — set to `true` only for external connections (e.g. seeding from a local machine against a remote DB).

---

## Running Locally

### Backend
```bash
cd backend
cp .env.example .env          # fill in DATABASE_URL, REDIS_URL, JWT secrets
npm install
npx prisma db push
npx ts-node prisma/seed.ts
npm run start:dev
# API on http://localhost:3001
```

### Frontend
```bash
cd frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > .env.local
npm install
npm run dev
# UI on http://localhost:3000
```

### Docker (production-like)
```bash
# From the backend directory
docker compose up -d
# Runs NestJS + PostgreSQL + Redis in containers
# Nginx sits in front on the host, proxying :443 → :3001
```

---

## Known Limitations

- **No email delivery** — notifications are stored in the DB and surfaced in-app only. No SMTP integration.
- **Availability granularity** — recurring availability is stored per day-of-week with a time window. Exception dates (single-day blocks) are supported but not exposed in the UI.
- **No pagination** — shift and user lists are returned in full. Acceptable for the seed dataset; would need cursor pagination at scale.
- **nip.io domain** — the backend URL is tied to the EC2 public IP. If the instance is stopped and restarted with a new IP, the URL changes.
