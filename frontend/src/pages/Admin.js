import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Activity, Database, SlidersHorizontal, Gift, MessageSquare, Users, CalendarDays, ArrowLeft, LogOut } from "lucide-react";
import IngestionPanel from "@/pages/admin/IngestionPanel";
import ScoringPanel from "@/pages/admin/ScoringPanel";
import PrizesPanel from "@/pages/admin/PrizesPanel";
import AlertsPanel from "@/pages/admin/AlertsPanel";
import RosterPanel from "@/pages/admin/RosterPanel";
import EventsPanel from "@/pages/admin/EventsPanel";
import { APP_VERSION } from "@/version";

const TABS = [
  { id: "events", label: "Events", icon: CalendarDays, C: EventsPanel },
  { id: "ingest", label: "Data Ingestion", icon: Database, C: IngestionPanel },
  { id: "scoring", label: "Scoring", icon: SlidersHorizontal, C: ScoringPanel },
  { id: "prizes", label: "Prize Wheel", icon: Gift, C: PrizesPanel },
  { id: "alerts", label: "SMS Alerts", icon: MessageSquare, C: AlertsPanel },
  { id: "roster", label: "Staff Roster", icon: Users, C: RosterPanel },
];

export default function Admin() {
  const [tab, setTab] = useState("events");
  const { logout } = useAuth();
  const nav = useNavigate();
  const Active = TABS.find((t) => t.id === tab).C;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            <span className="font-display text-lg font-bold">BoothIQ</span>
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Admin Console</span>
          </div>
          <div className="flex items-center gap-2">
            <span data-testid="app-version" className="mr-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-400">v{APP_VERSION}</span>
            <button data-testid="goto-dashboard" onClick={() => nav("/dashboard")} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><ArrowLeft className="h-3.5 w-3.5" /> Dashboard</button>
            <button data-testid="admin-logout" onClick={() => { logout(); nav("/login"); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-5">
          {TABS.map((t) => (
            <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition ${tab === t.id ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">
        <Active />
      </main>
    </div>
  );
}
