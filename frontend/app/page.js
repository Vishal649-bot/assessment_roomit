"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function HomePage() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  useEffect(() => {
    fetch(`${API}/api/rooms`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load rooms");
        return res.json();
      })
      .then(setRooms)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Meeting Rooms</h1>
      {loading && <p className="text-slate-500">Loading…</p>}
      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {rooms.map((room) => (
          <Link
            key={room._id}
            href={`/rooms/${room._id}`}
            className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
          >
            <h2 className="text-lg font-semibold">{room.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{room.location}</p>
            <p className="mt-2 text-sm text-slate-600">Capacity: {room.capacity}</p>
            {room.bufferMinutes > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                {room.bufferMinutes} min cleanup buffer after each booking
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
