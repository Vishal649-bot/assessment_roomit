import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

dotenv.config();
 
const app = express();
const PORT = process.env.PORT || 4000;
const MAX_DAILY_MINUTES = 240;

app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/roomit";

async function connectDB() {
  if (mongoose.connection.readyState >= 1) return;
  await mongoose.connect(MONGODB_URI);
}

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    res.status(500).json({ error: "Database connection failed" });
  }
});

// Converts time (HH:MM) into total minutes
function toMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// Calculates duration between start and end time in minutes
function durationMinutes(startTime, endTime) {
  return toMin(endTime) - toMin(startTime);
}


// Generates all 30-minute slot start times between start and end time
function getSlotStarts(startTime, endTime) {
  const slots = [];
  for (let t = toMin(startTime); t < toMin(endTime); t += 30) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

// Checks if two time ranges overlap with each other
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}


// Checks whether the given time is aligned to a 30-minute boundary
function isAligned30(time) {
  const m = toMin(time);
  return m % 30 === 0;
}

// Validates booking start and end times
// Ensures times are on 30-minute intervals and start < end
function validateTimes(startTime, endTime) {
  if (!isAligned30(startTime) || !isAligned30(endTime)) {
    return "Times must align to 30-minute boundaries (e.g. 09:00, 09:30)";
  }
  if (toMin(startTime) >= toMin(endTime)) {
    return "startTime must be before endTime";
  }
  return null;
}

// Converts time into HH:MM format by adding leading zeros if needed
function normalizeTime(t) {
  if (!t) return t;
  const parts = t.split(":");
  return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
}

// Checks if a slot overlaps with an existing booking
function slotOverlapsBooking(slotStart, slotEnd, booking) {
  return (
    toMin(slotStart) < toMin(booking.endTime) &&
    toMin(slotEnd) > toMin(booking.startTime)
  );
}

/** Cleanup buffer after booking ends — does not include the slot ending exactly at endTime */
function slotInBufferWindow(slotStart, slotEnd, bookingEndMin, bufferMinutes) {
  if (bufferMinutes <= 0) return false;
  const sStart = toMin(slotStart);
  const sEnd = toMin(slotEnd);
  const bufStart = bookingEndMin;
  const bufEnd = bookingEndMin + bufferMinutes;
  return sStart < bufEnd && sEnd > bufStart;
}

// Determines whether a slot is blocked by either a booking or its buffer time
function slotBlockedByBooking(slotStart, slotEnd, booking, bufferMinutes) {
  if (slotOverlapsBooking(slotStart, slotEnd, booking)) return true;
  return slotInBufferWindow(slotStart, slotEnd, toMin(booking.endTime), bufferMinutes);
}

// Checks whether a requested booking range conflicts with an existing booking
function rangeConflictsBooking(reqStart, reqEnd, booking, bufferMinutes) {
  const start = `${String(Math.floor(reqStart / 60)).padStart(2, "0")}:${String(reqStart % 60).padStart(2, "0")}`;
  const end = `${String(Math.floor(reqEnd / 60)).padStart(2, "0")}:${String(reqEnd % 60).padStart(2, "0")}`;
  return slotBlockedByBooking(start, end, booking, bufferMinutes);
}

// Detects MongoDB duplicate key errors
function isDuplicateKey(err) {
  return err.code === 11000 || err.code === 11001;
}

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String, required: true },
  capacity: { type: Number, required: true },
  bufferMinutes: { type: Number, default: 0 },
});

const bookingSchema = new mongoose.Schema({
  room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  bookedBy: {
    name: { type: String, required: true },
    email: { type: String, required: true },
  },
  title: { type: String, required: true },
  status: {
    type: String,
    enum: ["confirmed", "cancelled-refundable", "cancelled-non-refundable"],
    default: "confirmed",
  },
  createdAt: { type: Date, default: Date.now },
  version: { type: Number, default: 0 },
});

bookingSchema.index(
  { room: 1, date: 1, startTime: 1 },
  { unique: true, partialFilterExpression: { status: "confirmed" } }
);

const slotLockSchema = new mongoose.Schema({
  room: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: String, required: true },
  slotStart: { type: String, required: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
});

slotLockSchema.index({ room: 1, date: 1, slotStart: 1 }, { unique: true });

const quotaSchema = new mongoose.Schema({
  email: { type: String, required: true },
  date: { type: String, required: true },
  minutesUsed: { type: Number, default: 0 },
});

quotaSchema.index({ email: 1, date: 1 }, { unique: true });

const Room = mongoose.model("Room", roomSchema);
const Booking = mongoose.model("Booking", bookingSchema);
const SlotLock = mongoose.model("SlotLock", slotLockSchema);
const DailyQuota = mongoose.model("DailyQuota", quotaSchema);

async function findRoomConflicts(roomId, date, startTime, endTime, bufferMinutes, excludeId) {
  const bookings = await Booking.find({
    room: roomId,
    date,
    status: "confirmed",
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });

  const reqStart = toMin(startTime);
  const reqEnd = toMin(endTime);
  return bookings.find((b) => rangeConflictsBooking(reqStart, reqEnd, b, bufferMinutes));
}


// This function ensures that a user cannot book more than 4 hours (240 minutes) per day.
async function reserveQuota(email, date, minutes) {
  if (minutes <= 0) return;
  const doc = await DailyQuota.findOneAndUpdate(
    { email, date },
    { $inc: { minutesUsed: minutes } },
    { upsert: true, new: true }
  );
  if (doc.minutesUsed > MAX_DAILY_MINUTES) {
    await DailyQuota.findOneAndUpdate({ email, date }, { $inc: { minutesUsed: -minutes } });
    const err = new Error("quota");
    err.days = [date];
    throw err;
  }
}

// Releases previously reserved booking quota when booking is cancelled or changed
async function releaseQuota(email, date, minutes) {
  if (minutes <= 0) return;
  await DailyQuota.findOneAndUpdate({ email, date }, { $inc: { minutesUsed: -minutes } });
}

// Creates slot lock records for all slots occupied by a booking
async function syncSlotLocksForBooking(booking) {
  await SlotLock.deleteMany({ booking: booking._id });
  const slots = getSlotStarts(booking.startTime, booking.endTime);
  if (slots.length === 0) return;
  await SlotLock.insertMany(
    slots.map((slotStart) => ({
      room: booking.room,
      date: booking.date,
      slotStart,
      booking: booking._id,
    })),
    { ordered: true }
  );
}

/** Remove locks that no longer match their booking's time range */
async function reconcileOrphanLocks(roomId, date) {
  const [bookings, locks] = await Promise.all([
    Booking.find({ room: roomId, date, status: "confirmed" }),
    SlotLock.find({ room: roomId, date }),
  ]);

  for (const lock of locks) {
    const booking = bookings.find((b) => b._id.equals(lock.booking));
    const valid =
      booking &&
      getSlotStarts(booking.startTime, booking.endTime).includes(lock.slotStart);
    if (!valid) await SlotLock.deleteOne({ _id: lock._id });
  }
}

// Deletes all slot locks associated with a booking
async function deleteSlotLocks(bookingId) {
  await SlotLock.deleteMany({ booking: bookingId });
}

// Restores slot locks if an update operation fails and needs rollback
async function restoreSlotLocks(roomId, date, startTime, endTime, bookingId) {
  try {
    await syncSlotLocksForBooking({
      _id: bookingId,
      room: roomId,
      date,
      startTime,
      endTime,
    });
  } catch (err) {
    console.error("Failed to restore slot locks:", err);
  }
}

app.get("/api/rooms", async (req, res) => {
  try {
    res.json(await Room.find().sort({ name: 1 }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/rooms/:id/availability", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });

    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: "Room not found" });

    await reconcileOrphanLocks(req.params.id, date);

    const bookings = await Booking.find({ room: req.params.id, date, status: "confirmed" });

    const buffer = room.bufferMinutes || 0;
    const slots = [];

    for (let h = 8; h < 20; h++) {
      for (let m of [0, 30]) {
        const slotStart = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const endM = m + 30;
        const slotEnd = `${String(endM >= 60 ? h + 1 : h).padStart(2, "0")}:${String(endM >= 60 ? 0 : endM).padStart(2, "0")}`;

        const taken = bookings.some((b) =>
          slotBlockedByBooking(slotStart, slotEnd, b, buffer)
        );

        let reason = null;
        if (taken) {
          const blocker = bookings.find((b) =>
            slotOverlapsBooking(slotStart, slotEnd, b)
          );
          reason = blocker ? "booked" : "buffer";
        }

        slots.push({ slotStart, slotEnd, available: !taken, ...(reason && { reason }) });
      }
    }

    res.json({ room: room.name, date, bufferMinutes: buffer, slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const { roomId, date, startTime, endTime, bookedBy, title } = req.body;
    if (!roomId || !date || !startTime || !endTime || !bookedBy?.email || !bookedBy?.name || !title) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const email = bookedBy.email.toLowerCase();
    const mins = durationMinutes(startTime, endTime);
    if (mins <= 0) return res.status(400).json({ error: "Invalid time range" });

    const timeErr = validateTimes(startTime, endTime);
    if (timeErr) return res.status(400).json({ error: timeErr });

    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });

    const conflict = await findRoomConflicts(roomId, date, startTime, endTime, room.bufferMinutes);
    if (conflict) return res.status(409).json({ error: "Slot already booked" });

    await reserveQuota(email, date, mins);

    let booking;
    try {
      booking = await Booking.create({
        room: roomId,
        date,
        startTime,
        endTime,
        bookedBy: { name: bookedBy.name, email },
        title,
        status: "confirmed",
      });

      try {
        await syncSlotLocksForBooking(booking);
      } catch (lockErr) {
        await Booking.findByIdAndDelete(booking._id);
        await releaseQuota(email, date, mins);
        if (isDuplicateKey(lockErr)) {
          return res.status(409).json({ error: "Slot already booked" });
        }
        throw lockErr;
      }
    } catch (err) {
      if (!isDuplicateKey(err)) await releaseQuota(email, date, mins);
      if (isDuplicateKey(err)) return res.status(409).json({ error: "Slot already booked" });
      throw err;
    }

    const populated = await Booking.findById(booking._id).populate("room", "name location bufferMinutes");
    res.status(201).json(populated);
  } catch (err) {
    if (err.message === "quota") {
      return res.status(400).json({
        error: "Daily booking limit exceeded (max 4 hours/day)",
        details: { days: err.days },
      });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/bookings", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "email query param required" });

    const bookings = await Booking.find({ "bookedBy.email": email.toLowerCase() })
      .populate("room", "name location capacity bufferMinutes")
      .sort({ date: -1, startTime: -1 });

    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/bookings/:id/cancel", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.status !== "confirmed") {
      return res.status(400).json({ error: "Booking already cancelled" });
    }

    const start = new Date(`${booking.date}T${booking.startTime}:00`);
    const hrs = (start - Date.now()) / 3_600_000;
    booking.status = hrs >= 2 ? "cancelled-refundable" : "cancelled-non-refundable";
    booking.version += 1;
    await booking.save();

    await deleteSlotLocks(booking._id);
    await releaseQuota(
      booking.bookedBy.email,
      booking.date,
      durationMinutes(booking.startTime, booking.endTime)
    );

    const populated = await Booking.findById(booking._id).populate("room", "name location");
    res.json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/api/bookings/:id/reschedule", async (req, res) => {
  try {
    let { date, startTime, endTime, version } = req.body;
    if (!date || !startTime || !endTime || version === undefined) {
      return res.status(400).json({ error: "date, startTime, endTime, and version are required" });
    }

    startTime = normalizeTime(startTime);
    endTime = normalizeTime(endTime);

    const newMins = durationMinutes(startTime, endTime);
    if (newMins <= 0) return res.status(400).json({ error: "Invalid time range" });

    const timeErr = validateTimes(startTime, endTime);
    if (timeErr) return res.status(400).json({ error: timeErr });

    const existing = await Booking.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Booking not found" });
    if (existing.status !== "confirmed") {
      return res.status(400).json({ error: "Booking already cancelled" });
    }
    if (existing.version !== version) {
      return res.status(409).json({ error: "Booking was updated — please refresh and try again" });
    }

    const room = await Room.findById(existing.room);
    const email = existing.bookedBy.email;
    const oldDate = existing.date;
    const oldStart = existing.startTime;
    const oldEnd = existing.endTime;
    const oldMins = durationMinutes(oldStart, oldEnd);

    const conflict = await findRoomConflicts(
      existing.room,
      date,
      startTime,
      endTime,
      room.bufferMinutes,
      existing._id
    );
    if (conflict) return res.status(409).json({ error: "Slot already booked" });

    const updated = await Booking.findOneAndUpdate(
      { _id: existing._id, version, status: "confirmed" },
      { $set: { date, startTime, endTime }, $inc: { version: 1 } },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ error: "Booking was updated — please refresh and try again" });
    }

    try {
      await syncSlotLocksForBooking(updated);
    } catch (lockErr) {
      await Booking.findByIdAndUpdate(updated._id, {
        $set: { date: oldDate, startTime: oldStart, endTime: oldEnd },
        $inc: { version: 1 },
      });
      await syncSlotLocksForBooking({
        _id: existing._id,
        room: existing.room,
        date: oldDate,
        startTime: oldStart,
        endTime: oldEnd,
      });
      if (isDuplicateKey(lockErr)) {
        return res.status(409).json({ error: "Slot already booked" });
      }
      throw lockErr;
    }

    await releaseQuota(email, oldDate, oldMins);

    try {
      await reserveQuota(email, date, newMins);
    } catch (quotaErr) {
      await Booking.findByIdAndUpdate(updated._id, {
        $set: { date: oldDate, startTime: oldStart, endTime: oldEnd },
        $inc: { version: 1 },
      });
      await syncSlotLocksForBooking({
        _id: existing._id,
        room: existing.room,
        date: oldDate,
        startTime: oldStart,
        endTime: oldEnd,
      });
      await reserveQuota(email, oldDate, oldMins);
      if (quotaErr.message === "quota") {
        return res.status(400).json({
          error: "Daily booking limit exceeded (max 4 hours/day)",
          details: { days: quotaErr.days },
        });
      }
      throw quotaErr;
    }

    await reconcileOrphanLocks(existing.room, oldDate);
    if (date !== oldDate) await reconcileOrphanLocks(existing.room, date);

    const populated = await Booking.findById(updated._id).populate("room", "name location bufferMinutes");
    res.json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

export default app;

if (!process.env.VERCEL) {
  connectDB()
    .then(() => app.listen(PORT, () => console.log(`RoomIt API on http://localhost:${PORT}`)))
    .catch((err) => {
      console.error("MongoDB connection failed:", err);
      process.exit(1);
    });
}
