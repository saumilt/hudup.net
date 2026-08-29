import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { APP_VERSION } from "@/version";
import { Activity, Radio, Gift, Users2, LayoutDashboard, ArrowRight, Grid3x3, ChevronDown, LayoutGrid } from "lucide-react";

export default function EventsHome() {
  const nav = useNavigate();
  const [events, setEvents] = useState(null);
  const [sw, setSw] = useState(false);
  useEffect(() => {
    localStorage.setItem("boothiq_ws", "events");
    api.get("/kiosk/events").then((r) => setEvents(r.data)).catch(() => setEvents([]));
  }, []);
  const openKiosk = (id) => { if (id) localStorage.setItem("boothiq_event_id", id); nav("/kiosk"); };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-5 py-2.5 backdrop-blur">
        <div className="relative">
          <button data-testid="workspace-switcher" onClick={() => setSw((s) => !s)} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-800 hover:bg-slate-50"><Grid3x3 className="h-4 w-4 text-fuchsia-600" /> BoothIQ Events <ChevronDown className="h-3.5 w-3.5 text-slate-400" /></button>
          {sw && (
            <div className="absolute left-0 top-full z-40 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-xl" onMouseLeave={() => setSw(false)}>
              <button data-testid="switch-crm" onClick={() => nav("/crm")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><LayoutGrid className="h-4 w-4" /> CRM</button>
              <div className="flex items-center gap-2 rounded-lg bg-fuchsia-50 px-3 py-2 text-sm font-semibold text-fuchsia-700"><span className="h-2 w-2 rounded-full bg-fuchsia-600" /> Events</div>
              <button onClick={() => nav("/home")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><LayoutDashboard className="h-4 w-4" /> Home</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-primary"><Activity className="h-5 w-5" /><span className="font-display font-bold">BoothIQ</span></div>
        <span className="ml-auto rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-400">v{APP_VERSION}</span>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="mb-1 font-display text-2xl font-bold text-slate-900">BoothIQ Events</h1>
        <p className="mb-6 text-sm text-slate-500">Run events, capture physicians and move booth leads into the CRM.</p>
        <div className="mb-6 flex flex-wrap gap-2">
          <Quick icon={Radio} label="Event Dashboard" onClick={() => nav("/dashboard")} />
          <Quick icon={Gift} label="Prize Wheel" onClick={() => openKiosk()} />
          <Quick icon={Users2} label="Booth Leads" onClick={() => nav("/leads")} />
        </div>
        <h2 className="mb-3 font-display text-lg font-bold text-slate-900">Events</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(events || []).map((ev) => (
            <div key={ev.id} data-testid="event-card" className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="font-display font-bold text-slate-900">{ev.name}</p>
              <p className="text-xs text-slate-400">{ev.state || "—"}</p>
              <button onClick={() => openKiosk(ev.id)} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">Open Event <ArrowRight className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {events && events.length === 0 && <p className="text-sm text-slate-400">No events configured yet.</p>}
        </div>
      </div>
    </div>
  );
}
function Quick({ icon: Icon, label, onClick }) {
  return <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Icon className="h-4 w-4 text-primary" /> {label}</button>;
}
