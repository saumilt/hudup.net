import React from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { LayoutDashboard, Settings2, Activity, Loader2 } from "lucide-react";

export default function Launcher() {
  const nav = useNavigate();
  const [events, setEvents] = React.useState(null);
  const [eventId, setEventId] = React.useState(localStorage.getItem("boothiq_event_id") || "default");

  React.useEffect(() => {
    api.get("/kiosk/events").then((r) => setEvents(r.data)).catch(() => setEvents([]));
  }, []);

  const launchKiosk = () => {
    localStorage.setItem("boothiq_event_id", eventId);
    nav("/kiosk");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-2 flex items-center gap-2 text-primary">
          <Activity className="h-6 w-6" />
          <span className="text-sm font-semibold uppercase tracking-widest">BoothIQ</span>
        </div>
        <h1 className="mb-2 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Convention Booth Lead Intelligence</h1>
        <p className="mb-12 max-w-2xl text-lg text-slate-500">
          Score physicians in real time against Medicare data, launch the prize wheel, and text your team the moment a high-value lead walks up.
        </p>
        <div className="grid gap-6 sm:grid-cols-3">
          {/* Kiosk setup card with event selection */}
          <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 h-32 w-full overflow-hidden rounded-xl">
              <img src="https://images.unsplash.com/photo-1573788583106-acf6c8f3f0b5?crop=entropy&cs=srgb&fm=jpg&q=85&w=800" alt="Register & Win" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900">Register &amp; Win</h3>
            <p className="mt-1 text-sm text-slate-500">Doctor-facing lead capture &amp; prize wheel</p>
            <label className="mb-1 mt-4 block text-xs font-semibold uppercase tracking-wider text-slate-400">Event</label>
            {events === null ? (
              <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading events…</div>
            ) : (
              <select data-testid="launcher-event" value={eventId} onChange={(e) => setEventId(e.target.value)} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            )}
            <button data-testid="launch-kiosk" onClick={launchKiosk} className="w-full rounded-lg bg-primary py-2.5 font-semibold text-white transition active:scale-95">
              Launch Kiosk
            </button>
          </div>

          <button data-testid="launch-dashboard" onClick={() => nav("/dashboard")} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
            <div className="mb-4 inline-flex rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 p-3 text-white"><LayoutDashboard className="h-6 w-6" /></div>
            <h3 className="text-xl font-semibold text-slate-900">Staff Dashboard</h3>
            <p className="mt-1 text-sm text-slate-500">Live lead feed, tiers &amp; alerts</p>
          </button>

          <button data-testid="launch-admin" onClick={() => nav("/admin")} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
            <div className="mb-4 inline-flex rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 p-3 text-white"><Settings2 className="h-6 w-6" /></div>
            <h3 className="text-xl font-semibold text-slate-900">Admin Console</h3>
            <p className="mt-1 text-sm text-slate-500">Events, data upload, scoring, prizes &amp; SMS rules</p>
          </button>
        </div>
      </div>
    </div>
  );
}
