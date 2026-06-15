"use client";

import { useState } from "react";
import { BASE_URL } from "../../global.js";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function statusBadge(status) {
  if (status === "confirmed")
    return { label: "Confirmed", cls: "bg-green-100 text-green-700" };
  if (status === "cancelled-refundable")
    return { label: "Cancelled (refundable)", cls: "bg-amber-100 text-amber-700" };
  return { label: "Cancelled (non-refundable)", cls: "bg-red-100 text-red-700" };
}

export default function BookingsPage() {
  const [email, setEmail] = useState("");
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [rescheduleId, setRescheduleId] = useState(null);
  const [rescheduleForm, setRescheduleForm] = useState({ date: "", startTime: "", endTime: "" });
  const [resultMsg, setResultMsg] = useState({});

  async function handleLookup(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResultMsg({});
    setConfirmId(null);
    setRescheduleId(null);

    try {
      const res = await fetch(`${BASE_URL}/api/bookings?email=${encodeURIComponent(email)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load bookings");
      }
      setBookings(await res.json());
    } catch (err) {
      setError(err.message);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(id) {
    try {
      const res = await fetch(`${BASE_URL}/api/bookings/${id}/cancel`, { method: "PATCH" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setResultMsg((prev) => ({ ...prev, [id]: data.error || "Cancel failed" }));
        return;
      }

      setBookings((prev) =>
        prev.map((b) => (b._id === id ? { ...b, status: data.status, version: data.version } : b))
      );

      const refund = data.status === "cancelled-refundable" ? "Yes" : "No";
      setResultMsg((prev) => ({ ...prev, [id]: `Cancelled. Refund: ${refund}` }));
    } catch {
      setResultMsg((prev) => ({ ...prev, [id]: "Something went wrong" }));
    } finally {
      setConfirmId(null);
    }
  }

  function openReschedule(b) {
    setRescheduleId(b._id);
    setConfirmId(null);
    setRescheduleForm({ date: b.date, startTime: b.startTime, endTime: b.endTime });
    setResultMsg((prev) => ({ ...prev, [b._id]: "" }));
  }

  async function handleReschedule(id) {
    const booking = bookings.find((b) => b._id === id);
    if (!booking) return;

    try {
      const res = await fetch(`${BASE_URL}/api/bookings/${id}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rescheduleForm,
          version: booking.version ?? 0,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.details?.days?.length
          ? `${data.error} (${data.details.days.join(", ")})`
          : data.error || "Reschedule failed";
        setResultMsg((prev) => ({ ...prev, [id]: msg }));
        return;
      }

      setBookings((prev) =>
        prev.map((b) => (b._id === id ? { ...b, ...data, room: data.room || b.room } : b))
      );
      sessionStorage.setItem("roomit-updated", "1");
      setResultMsg((prev) => ({
        ...prev,
        [id]: `Rescheduled to ${data.startTime}–${data.endTime}. Refresh the room page to see updated slots.`,
      }));
      setRescheduleId(null);
    } catch {
      setResultMsg((prev) => ({ ...prev, [id]: "Something went wrong" }));
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">My Bookings</h1>

      <form onSubmit={handleLookup} className="mb-6 flex gap-2">
        <input
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Look up
        </button>
      </form>

      {loading && <p className="text-slate-500">Loading…</p>}
      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {bookings.map((b) => {
          const badge = statusBadge(b.status);
          const canManage = b.status === "confirmed" && b.date >= todayStr();

          return (
            <div
              key={b._id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{b.room?.name || "Room"}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {b.date} · {b.startTime} – {b.endTime}
                  </p>
                  <p className="mt-1 text-sm">{b.title}</p>
                  {b.room?.bufferMinutes > 0 && (
                    <p className="mt-1 text-xs text-amber-600">
                      Room buffer: {b.room.bufferMinutes} min
                    </p>
                  )}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>

              {resultMsg[b._id] && (
                <p
                  className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                    resultMsg[b._id].startsWith("Cancelled") ||
                    resultMsg[b._id].startsWith("Rescheduled")
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-600"
                  }`}
                >
                  {resultMsg[b._id]}
                </p>
              )}

              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {confirmId !== b._id && rescheduleId !== b._id && (
                    <>
                      <button
                        type="button"
                        onClick={() => openReschedule(b)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                      >
                        Reschedule
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmId(b._id);
                          setRescheduleId(null);
                        }}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}

              {rescheduleId === b._id && (
                <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
                  <p className="mb-2 font-medium">Reschedule booking</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      type="date"
                      value={rescheduleForm.date}
                      min={todayStr()}
                      onChange={(e) =>
                        setRescheduleForm({ ...rescheduleForm, date: e.target.value })
                      }
                      className="rounded-lg border border-slate-300 px-2 py-1.5"
                    />
                    <input
                      type="time"
                      step="1800"
                      value={rescheduleForm.startTime}
                      onChange={(e) =>
                        setRescheduleForm({ ...rescheduleForm, startTime: e.target.value })
                      }
                      className="rounded-lg border border-slate-300 px-2 py-1.5"
                    />
                    <input
                      type="time"
                      step="1800"
                      value={rescheduleForm.endTime}
                      onChange={(e) =>
                        setRescheduleForm({ ...rescheduleForm, endTime: e.target.value })
                      }
                      className="rounded-lg border border-slate-300 px-2 py-1.5"
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleReschedule(b._id)}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRescheduleId(null)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}

              {confirmId === b._id && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                  Cancel this booking?
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleCancel(b._id)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      No
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
