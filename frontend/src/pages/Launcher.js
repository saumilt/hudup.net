import React from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { APP_VERSION } from "@/version";
import {
  Activity, Loader2, Radio, LayoutGrid, Search, Users2, CheckSquare, Gift,
  Settings2, ArrowRight, Sparkles, Target, Stethoscope,
} from "lucide-react";

export default function Launcher() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [events, setEvents] = React.useState(null);
  const [eventId, setEventId] = React.useState(localStorage.getItem("boothiq_event_id") || "default");
  const role = user?.role;
  const canCrm = !user || ["admin", "lead_manager", "account_manager"].includes(role);
  const crmPrimary = ["admin", "lead_manager", "account_manager"].includes(role);
  const last = localStorage.getItem("boothiq_ws");

  React.useEffect(() => {
    api.get("/kiosk/events").then((r) => setEvents(r.data)).catch(() => setEvents([]));
  }, []);
  const launchKiosk = () => { localStorage.setItem("boothiq_event_id", eventId); nav("/kiosk"); };

  const crmQuick = [
    { label: "Find Physicians", icon: Stethoscope, to: "/crm/medicare" },
    { label: "Medicare Search", icon: Search, to: "/crm/medicare" },
    { label: "My Leads", icon: Users2, to: "/crm/leads" },
    { label: "My Tasks", icon: CheckSquare, to: "/crm/meetings" },
    { label: "Opportunities", icon: Target, to: "/crm/opportunities" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div data-testid="app-version" className="fixed right-3 top-3 z-50 rounded-full bg-black/20 px-2.5 py-1 text-[10px] font-semibold text-slate-600 backdrop-blur">v{APP_VERSION}</div>
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="mb-2 flex items-center gap-2 text-primary"><Activity className="h-6 w-6" /><span className="text-sm font-semibold uppercase tracking-widest">BoothIQ</span></div>
        <h1 className="mb-2 font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Physician Intelligence. Engagement. Growth.</h1>
        <p className="mb-3 max-w-2xl text-lg text-slate-500">Capture physician relationships at events or discover new opportunities through Medicare intelligence. Enrich, communicate, schedule, track and convert — all from one platform.</p>
        <p className="mb-10 font-display text-lg font-semibold text-slate-700">{user ? `Welcome back, ${user.name?.split(" ")[0]}. ` : ""}What would you like to work on?</p>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Events */}
          <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="inline-flex rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 p-3 text-white"><Radio className="h-6 w-6" /></div>
              <div><h2 className="font-display text-2xl font-bold text-slate-900">BoothIQ Events 🎪</h2><p className="text-sm text-slate-500">Capture and manage physicians at conferences and booths.</p></div>
              {last === "events" && <span className="ml-auto rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700">LAST USED</span>}
            </div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">Event</label>
            {events === null ? <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div> :
              <select data-testid="launcher-event" value={eventId} onChange={(e) => setEventId(e.target.value)} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>}
            <button data-testid="open-events" onClick={launchKiosk} className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 font-semibold text-white transition active:scale-95">Open BoothIQ Events <ArrowRight className="h-4 w-4" /></button>
            <div className="mt-3 flex flex-wrap gap-2">
              <QuickLink icon={Gift} label="Prize Wheel" onClick={launchKiosk} />
              <QuickLink icon={Radio} label="Event Dashboard" onClick={() => nav("/dashboard")} />
              <QuickLink icon={Users2} label="Booth Leads" onClick={() => nav("/leads")} />
            </div>
          </div>

          {/* CRM */}
          <div className={`group relative overflow-hidden rounded-2xl border p-7 shadow-sm ${canCrm ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-70"}`}>
            <div className="mb-4 flex items-center gap-3">
              <div className="inline-flex rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-3 text-white"><LayoutGrid className="h-6 w-6" /></div>
              <div><h2 className="font-display text-2xl font-bold text-slate-900">BoothIQ CRM 📊</h2><p className="text-sm text-slate-500">Search, enrich, communicate with and manage physicians.</p></div>
              {last === "crm" && <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">LAST USED</span>}
            </div>
            {canCrm ? (
              <>
                <button data-testid="open-crm" onClick={() => nav(user ? "/crm" : "/login")} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-semibold text-white transition active:scale-95">Open BoothIQ CRM <ArrowRight className="h-4 w-4" /></button>
                <div className="mt-3 flex flex-wrap gap-2">
                  {crmQuick.map((q) => <QuickLink key={q.label} icon={q.icon} label={q.label} onClick={() => nav(user ? q.to : "/login")} />)}
                </div>
              </>
            ) : <p className="rounded-lg bg-white p-4 text-sm text-slate-400">CRM access is limited to managers and admins.</p>}
          </div>
        </div>

        {/* Workflow strip */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold text-slate-400">
          {[["Events", "Capture"], ["Intelligence", "Understand"], ["CRM", "Build"], ["Outreach", "Email·Call·Text"], ["Opportunities", "Grow"]].map(([a, b], i, arr) => (
            <React.Fragment key={a}>
              <span className="rounded-full bg-white px-3 py-1.5 shadow-sm"><span className="text-slate-700">{a}</span> · {b}</span>
              {i < arr.length - 1 && <ArrowRight className="h-3 w-3" />}
            </React.Fragment>
          ))}
        </div>

        {(role === "admin" || crmPrimary) && (
          <div className="mt-8 flex flex-wrap gap-2">
            {role === "admin" && <QuickLink icon={Settings2} label="Admin Console" onClick={() => nav("/admin")} />}
            {role === "admin" && <QuickLink icon={Sparkles} label="Enrichment & Providers" onClick={() => nav("/crm/providers")} />}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickLink({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:-translate-y-0.5 hover:shadow-sm">
      <Icon className="h-3.5 w-3.5 text-primary" /> {label}
    </button>
  );
}
