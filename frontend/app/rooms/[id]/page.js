"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function toMin(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function isPastSlot(date, slotStart) {
  if (date !== todayStr()) return false;
  const now = new Date();
  const [h, m] = slotStart.split(":").map(Number);
  const slotTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  return slotTime <= now;
}

function isSlotSelected(slot, start, end) {
  if (!start) return false;
  if (!end) return slot.slotStart === start;
  return toMin(slot.slotStart) >= toMin(start) && toMin(slot.slotEnd) <= toMin(end);
}

export default function RoomPage() {
  const { id } = useParams();
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [slots, setSlots] = useState([]);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", title: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [bufferMinutes, setBufferMinutes] = useState(0);

  function resetSelection() {
    setSelectionStart(null);
    setSelectionEnd(null);
    setShowForm(false);
  }

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API}/api/rooms/${id}/availability?date=${selectedDate}&_=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Failed to load availability");
      const data = await res.json();
      setRoomName(data.room);
      setBufferMinutes(data.bufferMinutes || 0);
      setSlots(data.slots);
    } catch (err) {
      setError(err.message);
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [id, selectedDate]);

  useEffect(() => {
    fetchSlots();
    resetSelection();
    setFormError("");
  }, [fetchSlots]);

  useEffect(() => {
    function refreshIfNeeded() {
      if (sessionStorage.getItem("roomit-updated")) {
        sessionStorage.removeItem("roomit-updated");
        fetchSlots();
      }
    }
    refreshIfNeeded();
    window.addEventListener("focus", refreshIfNeeded);
    document.addEventListener("visibilitychange", refreshIfNeeded);
    return () => {
      window.removeEventListener("focus", refreshIfNeeded);
      document.removeEventListener("visibilitychange", refreshIfNeeded);
    };
  }, [fetchSlots]);

  function handleSlotClick(slot) {
    if (!slot.available || isPastSlot(selectedDate, slot.slotStart)) return;

    if (
      selectionStart === slot.slotStart &&
      selectionEnd === slot.slotEnd
    ) {
      resetSelection();
      setFormError("");
      return;
    }

    if (!selectionStart) {
      setSelectionStart(slot.slotStart);
      setSelectionEnd(slot.slotEnd);
      setShowForm(true);
      setFormError("");
      return;
    }

    const startMin = toMin(selectionStart);
    const clickMin = toMin(slot.slotStart);

    if (clickMin < startMin) {
      setSelectionStart(slot.slotStart);
      setSelectionEnd(slot.slotEnd);
      setShowForm(true);
      setFormError("");
      return;
    }

    const endTime = slot.slotEnd;
    const rangeInvalid = slots.some((s) => {
      const inRange =
        toMin(s.slotStart) >= startMin && toMin(s.slotEnd) <= toMin(endTime);
      return inRange && (!s.available || isPastSlot(selectedDate, s.slotStart));
    });

    if (rangeInvalid) {
      setFormError("Range contains unavailable slots — please reselect");
      resetSelection();
      return;
    }

    setSelectionEnd(endTime);
    setShowForm(true);
    setFormError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);

    try {
      const res = await fetch(`${API}/api/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: id,
          date: selectedDate,
          startTime: selectionStart,
          endTime: selectionEnd,
          bookedBy: { name: formData.name, email: formData.email },
          title: formData.title,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        setFormError("That slot was just taken — please pick another");
        resetSelection();
        await fetchSlots();
        return;
      }

      if (!res.ok) {
        const msg = data.details?.days?.length
          ? `${data.error} (${data.details.days.join(", ")})`
          : data.error || "Booking failed";
        setFormError(msg);
        return;
      }

      resetSelection();
      setFormData({ name: "", email: "", title: "" });
      await fetchSlots();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Link href="/" className="mb-4 inline-block text-sm text-indigo-600 hover:underline">
        ← All rooms
      </Link>
      <h1 className="mb-2 text-2xl font-bold">{roomName || "Room"}</h1>
      {bufferMinutes > 0 && (
        <p className="mb-4 text-sm text-amber-600">
          Includes {bufferMinutes}-minute cleanup buffer after each booking (amber slots)
        </p>
      )}

      <div className="mb-6 flex items-center gap-3">
        <label htmlFor="date" className="text-sm font-medium">
          Date
        </label>
        <input
          id="date"
          type="date"
          value={selectedDate}
          min={todayStr()}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {loading && <p className="text-slate-500">Loading…</p>}
      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {!loading && !error && (
        <>
          {formError && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {formError}
            </p>
          )}

          <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {slots.map((slot) => {
              const past = isPastSlot(selectedDate, slot.slotStart);
              const unavailable = !slot.available || past;
              const isBuffer = slot.reason === "buffer";
              const selected = isSlotSelected(
                slot,
                selectionStart,
                selectionEnd
              );

              let cls =
                "rounded-lg border px-2 py-3 text-center text-sm font-medium transition ";
              if (unavailable) {
                cls += past
                  ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                  : isBuffer
                    ? "cursor-not-allowed border-amber-200 bg-amber-50 text-amber-600"
                    : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through";
              } else if (selected) {
                cls += "border-indigo-500 bg-indigo-100 text-indigo-800";
              } else {
                cls += "cursor-pointer border-slate-200 bg-white hover:border-indigo-400";
              }

              return (
                <button
                  key={slot.slotStart}
                  type="button"
                  className={cls}
                  disabled={unavailable}
                  title={isBuffer ? "Cleanup buffer after previous booking" : undefined}
                  onClick={() => handleSlotClick(slot)}
                >
                  {slot.slotStart} – {slot.slotEnd}
                  {isBuffer && <span className="block text-xs">buffer</span>}
                </button>
              );
            })}
          </div>

          {showForm && selectionStart && selectionEnd && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">
                Booking {selectionStart} – {selectionEnd}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="mb-1 block text-sm font-medium">
                    Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="mb-1 block text-sm font-medium">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="title" className="mb-1 block text-sm font-medium">
                    Title
                  </label>
                  <input
                    id="title"
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? "Booking…" : "Book"}
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
