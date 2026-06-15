# RoomIt — Meeting Room Booking System

A full-stack meeting room booking app with conflict-safe reservations, configurable cleanup buffers, rescheduling with optimistic locking, and per-user daily quotas.

| Layer    | Stack |
|----------|-------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Backend  | Node.js, Express, Mongoose, MongoDB |
| Deploy   | Frontend → Vercel · Backend → [assessment-roomit-api-eta.vercel.app](https://assessment-roomit-api-eta.vercel.app) |

---

## Folder structure

```
assesment/
├── README.md
├── backend/
│   ├── index.js          # Express API — models, routes, business logic
│   ├── seed.js           # Seeds rooms, bookings, slot locks, quotas
│   ├── vercel.json       # Vercel serverless config for Express
│   ├── package.json
│   └── .env.example      # MONGODB_URI, PORT
│
└── frontend/
    ├── global.js         # Shared BASE_URL for API calls
    ├── app/
    │   ├── layout.js     # Root layout + nav
    │   ├── globals.css   # Tailwind styles
    │   ├── page.js       # Home — room list
    │   ├── bookings/
    │   │   └── page.js   # Lookup by email, cancel, reschedule
    │   └── rooms/
    │       └── [id]/
    │           └── page.js   # 30-min slot grid + booking form
    ├── public/           # Static assets
    ├── package.json
    └── .env.local.example
```

---

## Getting started

### Prerequisites

- Node.js 18+
- MongoDB (local or [MongoDB Atlas](https://www.mongodb.com/atlas))

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env — set MONGODB_URI (e.g. mongodb://localhost:27017/roomit)
npm install
npm run seed    # optional — sample rooms & bookings
npm run dev     # http://localhost:4000
```

### Frontend

```bash
cd frontend
cp .env.local.example .env.local
# For local dev: NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev     # http://localhost:3000
```

`frontend/global.js` defaults to the deployed API when `NEXT_PUBLIC_API_URL` is not set:

```
https://assessment-roomit-api-eta.vercel.app
```

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rooms` | List all rooms |
| `GET` | `/api/rooms/:id/availability?date=YYYY-MM-DD` | 30-min slot grid (08:00–20:00) |
| `POST` | `/api/bookings` | Create booking |
| `GET` | `/api/bookings?email=` | List bookings for an email |
| `PATCH` | `/api/bookings/:id/cancel` | Cancel booking (refund window ≥ 2 hrs) |
| `PATCH` | `/api/bookings/:id/reschedule` | Move booking (requires `version`) |

---

## Frontend overview

| Page | Path | Purpose |
|------|------|---------|
| Rooms | `/` | Lists rooms with capacity, location, and buffer info |
| Room detail | `/rooms/[id]` | Date picker, availability grid, multi-slot selection, booking form |
| My Bookings | `/bookings` | Email lookup, cancel with confirmation, inline reschedule form |

**Key UI behaviour**

- Slots are 30 minutes; click one slot to open the form, click a later slot to extend the range.
- Unavailable slots are grey; **buffer** slots are amber with a `buffer` label.
- Booking errors (conflict, quota) are shown inline — no toast library.
- Reschedule sends the booking `version` from when the form was opened; a `409` shows the server message (e.g. “please refresh”).
- After reschedule, `sessionStorage` flags the room page to refetch availability.

---

## Backend overview

All logic lives in `backend/index.js` (single-file API for simplicity).

**Data models**

| Model | Role |
|-------|------|
| `Room` | `name`, `location`, `capacity`, `bufferMinutes` |
| `Booking` | Room, date, times, `bookedBy`, `status`, `version` (optimistic locking) |
| `SlotLock` | One row per 30-min slot held by a confirmed booking — unique on `{ room, date, slotStart }` |
| `DailyQuota` | Per-email, per-date `minutesUsed` — unique on `{ email, date }` |

**Concurrency (Section 3.1 safeguard)**

- `SlotLock` unique index prevents two bookings from holding the same slot.
- `Booking` partial unique index on `{ room, date, startTime }` for confirmed bookings.
- On create: reserve quota → create booking → insert slot locks; rollback on duplicate key.
- `reconcileOrphanLocks()` cleans stale locks after reschedules or manual DB edits.

---

## Extended requirements — implementation details

### 4.3 Buffer time between bookings

**Requirement:** Each room has a configurable buffer (e.g. 10 min) after a booking ends. The grid must show buffer as unavailable, and the API must reject bookings that overlap buffer time — not just the UI.

**How it was implemented**

**Data**

- `Room.bufferMinutes` on the Room schema (seeded: Orion 10 min, Atlas 15 min, Pulse 5 min, Nova 0 min).

**Availability grid (`GET /api/rooms/:id/availability`)**

- For each 30-min slot, `slotBlockedByBooking()` checks:
  1. Direct overlap with a confirmed booking (`slotOverlapsBooking`).
  2. Overlap with the cleanup window **after** `booking.endTime` (`slotInBufferWindow`).
- Buffer starts at `endTime`, not inside the booked range — a slot ending exactly at `endTime` is still bookable.
- Response includes `reason: "booked"` or `reason: "buffer"` so the UI can distinguish them.

**Booking safeguard (`POST /api/bookings`, reschedule)**

- `findRoomConflicts()` loads confirmed bookings for the room/date and uses `rangeConflictsBooking()` with the room’s `bufferMinutes`.
- A request whose time range intersects another booking **or** its buffer returns `409 Slot already booked`.

**Frontend**

- Amber styling and `buffer` label when `slot.reason === "buffer"`.
- Room list and detail pages show buffer duration when `bufferMinutes > 0`.

---

### 4.4 Reschedule with re-validation

**Requirement:** Move a booking to a new date/time with full conflict checks (including buffers). Use optimistic locking — reject with a clear “please refresh” if the booking changed. Free old slot and reserve new slot as one logical operation.

**How it was implemented**

**Optimistic locking**

- `Booking.version` starts at `0`, incremented on cancel and reschedule.
- `PATCH /api/bookings/:id/reschedule` requires `version` in the body.
- Early check: `existing.version !== version` → `409 Booking was updated — please refresh and try again`.
- Atomic update: `findOneAndUpdate({ _id, version, status: "confirmed" }, { $set: { date, startTime, endTime }, $inc: { version: 1 } })` — if no document matches, same `409` response.

**Re-validation**

- `validateTimes()` enforces 30-minute alignment.
- `findRoomConflicts(..., excludeId)` runs the same buffer-aware conflict logic as create, excluding the current booking.

**Single logical slot swap**

1. Update booking document (version-gated).
2. `syncSlotLocksForBooking()` — delete old locks, insert locks for the new range.
3. On lock duplicate key: **rollback** booking to old date/times and restore old locks.
4. `releaseQuota()` for old date/minutes, then `reserveQuota()` for new date/minutes.
5. On quota failure: rollback booking, locks, and re-reserve old quota.
6. `reconcileOrphanLocks()` on old and new dates.

This avoids a window where neither slot is held (booking updated but locks failed) or both are held (locks inserted before old ones removed — old locks are deleted inside `syncSlotLocksForBooking` immediately before insert).

**Frontend**

- `/bookings` reschedule form sends `version: booking.version ?? 0`.
- Displays server error messages including quota day details.
- Sets `sessionStorage` flag so the room page refetches after a successful reschedule.

---

### 4.5 Per-user daily booking quota

**Requirement:** Max 4 hours/day per user across all rooms, enforced server-side. Response indicates which day(s) caused rejection. Must hold under concurrency (two simultaneous 1-hour requests at 3.5 hrs → at most one succeeds). Cancelling frees quota.

**How it was implemented**

**Limit**

- `MAX_DAILY_MINUTES = 240` (4 hours) in `index.js`.

**Storage**

- `DailyQuota` collection: `{ email, date, minutesUsed }` with unique compound index.

**Reserve (create & reschedule)**

```js
DailyQuota.findOneAndUpdate(
  { email, date },
  { $inc: { minutesUsed: minutes } },
  { upsert: true, new: true }
)
```

- If `minutesUsed > 240` after increment, immediately `$inc` back by `-minutes` and throw with `err.days = [date]`.
- API returns `400` with `{ error: "Daily booking limit exceeded (max 4 hours/day)", details: { days: ["YYYY-MM-DD"] } }`.

**Concurrency**

- Atomic `$inc` on a single document per `{ email, date }` means two parallel 60-minute requests when the user is at 210 minutes: first lands at 270 → rolled back; second may succeed to 270 or also fail — **at most one** can end above 240.

**Release (cancel & reschedule)**

- `PATCH .../cancel` calls `releaseQuota(email, date, durationMinutes)`.
- Reschedule releases old-day minutes before reserving new-day minutes (with full rollback on quota failure).

**Frontend**

- Booking and reschedule errors surface `details.days` in the inline error message.

---

## Seed data

`npm run seed` in `backend/` creates:

- **4 rooms** with varying `bufferMinutes`
- **8 confirmed bookings** with matching `SlotLock` rows and `DailyQuota` entries
- **2 cancelled bookings** (refundable / non-refundable) for cancel-flow testing

---

## Environment variables

| Variable | Where | Description |
|----------|-------|-------------|
| `MONGODB_URI` | backend | MongoDB connection string |
| `PORT` | backend | Local port (default `4000`) |
| `NEXT_PUBLIC_API_URL` | frontend | API base URL (overrides `global.js` default) |

---

## Deployment notes

**Backend (Vercel)**

- Set project root to `backend/`.
- Add `MONGODB_URI` pointing to Atlas (Vercel cannot reach localhost).
- `vercel.json` routes all traffic to `index.js`; the app exports Express as a serverless handler.

**Frontend (Vercel)**

- Set project root to `frontend/`.
- Optionally set `NEXT_PUBLIC_API_URL` to the backend URL (already the default in `global.js`).

---

## Not implemented (out of scope)

- **4.1** Recurring bookings
- **4.2** Waitlist
