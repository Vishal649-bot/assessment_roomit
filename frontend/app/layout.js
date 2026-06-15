import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "RoomIt",
  description: "Meeting room booking",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold text-indigo-600">
              RoomIt
            </Link>
            <nav className="flex gap-4 text-sm font-medium">
              <Link href="/" className="text-slate-600 hover:text-indigo-600">
                Rooms
              </Link>
              <Link href="/bookings" className="text-slate-600 hover:text-indigo-600">
                My Bookings
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
