import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const roomSchema = new mongoose.Schema({
  name: String,
  location: String,
  capacity: Number,
  bufferMinutes: { type: Number, default: 0 },
});

const bookingSchema = new mongoose.Schema({
  room: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
  date: String,
  startTime: String,
  endTime: String,
  bookedBy: { name: String, email: String },
  title: String,
  status: String,
  version: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const slotLockSchema = new mongoose.Schema({
  room: mongoose.Schema.Types.ObjectId,
  date: String,
  slotStart: String,
  booking: mongoose.Schema.Types.ObjectId,
});

const quotaSchema = new mongoose.Schema({
  email: String,
  date: String,
  minutesUsed: Number,
});

const Room = mongoose.model("Room", roomSchema);
const Booking = mongoose.model("Booking", bookingSchema);
const SlotLock = mongoose.model("SlotLock", slotLockSchema);
const DailyQuota = mongoose.model("DailyQuota", quotaSchema);

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function addHours(n) {
  const d = new Date();
  d.setHours(d.getHours() + n);
  return d;
}

function pad(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function getSlotStarts(startTime, endTime) {
  const slots = [];
  for (let t = toMin(startTime); t < toMin(endTime); t += 30) {
    slots.push(pad(Math.floor(t / 60), t % 60));
  }
  return slots;
}

function durationMinutes(startTime, endTime) {
  return toMin(endTime) - toMin(startTime);
}

async function seedBooking(data) {
  const booking = await Booking.create({ ...data, version: 0 });
  if (data.status === "confirmed") {
    await SlotLock.insertMany(
      getSlotStarts(data.startTime, data.endTime).map((slotStart) => ({
        room: data.room,
        date: data.date,
        slotStart,
        booking: booking._id,
      }))
    );
    await DailyQuota.findOneAndUpdate(
      { email: data.bookedBy.email, date: data.date },
      { $inc: { minutesUsed: durationMinutes(data.startTime, data.endTime) } },
      { upsert: true }
    );
  }
  return booking;
}

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/roomit";
  await mongoose.connect(uri);

  await Promise.all([
    SlotLock.deleteMany({}),
    DailyQuota.deleteMany({}),
    Booking.deleteMany({}),
    Room.deleteMany({}),
  ]);
  console.log("Dropped all collections");

  const rooms = await Room.insertMany([
    { name: "Orion", location: "Floor 3 - East", capacity: 8, bufferMinutes: 10 },
    { name: "Nova", location: "Floor 3 - West", capacity: 12, bufferMinutes: 0 },
    { name: "Atlas", location: "Floor 5 - Boardroom", capacity: 20, bufferMinutes: 15 },
    { name: "Pulse", location: "Floor 2 - Huddle", capacity: 4, bufferMinutes: 5 },
  ]);

  const [orion, nova, atlas, pulse] = rooms;
  const today = fmt(new Date());
  const soon = addHours(1);
  const soonH = Math.max(soon.getHours(), 8);
  const soonM = soon.getMinutes() >= 30 ? 30 : 0;
  const later = addHours(5);
  const laterH = later.getHours();
  const laterM = later.getMinutes() >= 30 ? 30 : 0;

  const confirmed = [
    { room: orion._id, date: fmt(addDays(1)), startTime: "09:00", endTime: "10:00", bookedBy: { name: "Alice", email: "alice@roomit.com" }, title: "Sprint Planning", status: "confirmed" },
    { room: orion._id, date: fmt(addDays(1)), startTime: "14:00", endTime: "15:30", bookedBy: { name: "Bob", email: "bob@roomit.com" }, title: "Design Review", status: "confirmed" },
    { room: nova._id, date: fmt(addDays(2)), startTime: "10:00", endTime: "11:00", bookedBy: { name: "Carol", email: "carol@roomit.com" }, title: "Client Call", status: "confirmed" },
    { room: atlas._id, date: fmt(addDays(2)), startTime: "13:00", endTime: "15:00", bookedBy: { name: "Dan", email: "dan@roomit.com" }, title: "Board Meeting", status: "confirmed" },
    { room: pulse._id, date: fmt(addDays(3)), startTime: "11:00", endTime: "11:30", bookedBy: { name: "Eve", email: "eve@roomit.com" }, title: "Quick Sync", status: "confirmed" },
    { room: nova._id, date: fmt(addDays(5)), startTime: "16:00", endTime: "17:00", bookedBy: { name: "Frank", email: "frank@roomit.com" }, title: "Training", status: "confirmed" },
    { room: orion._id, date: fmt(later), startTime: pad(laterH, laterM), endTime: pad(laterM === 30 ? laterH + 1 : laterH, laterM === 30 ? 0 : 30), bookedBy: { name: "Grace", email: "grace@roomit.com" }, title: "Refundable Test", status: "confirmed" },
    { room: nova._id, date: fmt(soon), startTime: pad(soonH, soonM), endTime: pad(soonM === 30 ? soonH + 1 : soonH, soonM === 30 ? 0 : 30), bookedBy: { name: "Henry", email: "henry@roomit.com" }, title: "Non-Refundable Test", status: "confirmed" },
  ];

  for (const b of confirmed) await seedBooking(b);

  await Booking.insertMany([
    { room: pulse._id, date: today, startTime: "09:00", endTime: "10:00", bookedBy: { name: "Ivy", email: "ivy@roomit.com" }, title: "Old Cancelled", status: "cancelled-refundable", version: 1 },
    { room: atlas._id, date: today, startTime: "15:00", endTime: "16:00", bookedBy: { name: "Jack", email: "jack@roomit.com" }, title: "Late Cancelled", status: "cancelled-non-refundable", version: 1 },
  ]);

  console.log("Seeded 4 rooms, 10 bookings, slot locks + quotas");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
