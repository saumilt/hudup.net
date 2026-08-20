import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, wsUrl, money } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { TIER_STYLES } from "@/components/TierBadge";
import {
  Activity, WifiOff, Bell, Download, Filter, UserPlus, StickyNote, ExternalLink,
  LogOut, Settings2, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";
import { toast } from "sonner";

const TIERS = ["GREEN", "YELLOW", "BLUE", "RED", "GREY"];

function beepGreen() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    o.type = "sine";
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.5);
  } catch { /* noop */ }
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
}

function LeadCard({ lead, onAssign, onNote, onOpen }) {
  const grey = lead.match_status === "unresolved" || (lead.tier_340b === "GREY" && lead.tier_rpm === "GREY");
  const s340 = TIER_STYLES[lead.tier_340b] || TIER_STYLES.GREY;
  const srpm = TIER_STYLES[lead.tier_rpm] || TIER_STYLES.GREY;
  const med = lead.medicare || {};
  return (
    <div
      data-testid={`lead-card-${lead.id}`}
      className={`relative flex overflow-hidden rounded-xl border transition-all ${grey ? "border-slate-200 bg-slate-50 shadow-none" : "border-slate-200 bg-white shadow-sm hover:-translate-y-1 hover:shadow-lg"}`}
    >
      {/* dual tier bands — green-shaded 340B on top, RPM below */}
      <div className="flex w-3 flex-shrink-0 flex-col">
        <div className="flex-1" style={{ backgroundColor: lead.color_340b || "#cbd5e1" }} title={`340B ${lead.shade_340b || lead.tier_340b}`} />
        <div className="flex-1" style={{ backgroundColor: lead.color_rpm || "#cbd5e1" }} title={`RPM ${lead.tier_rpm}`} />
      </div>
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className={`font-display text-lg font-bold ${grey ? "text-slate-500" : "text-slate-900"}`}>
              Dr. {lead.first_name} {lead.last_name}
            </h3>
            <p className="text-sm text-slate-500">{lead.specialty || "Unknown specialty"} · {lead.city || "?"} {lead.state || ""}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${s340.chip}`}>340B {lead.tier_340b}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${srpm.chip}`}>RPM {lead.tier_rpm}</span>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="font-mono text-slate-500">NPI {lead.npi || "—"}</span>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${lead.match_status === "confirmed" ? "bg-emerald-100 text-emerald-700" : lead.match_status === "probable" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>
            {lead.match_status}
          </span>
          {grey && <span className="text-slate-400">· unknown, not low-value</span>}
        </div>

        {!grey && (
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2 text-center">
            <div><p className="text-[10px] uppercase text-slate-400">Claims</p><p className="text-sm font-bold text-slate-800">{med.tot_clms != null ? Number(med.tot_clms).toLocaleString() : "—"}</p></div>
            <div><p className="text-[10px] uppercase text-slate-400">Drug Cost</p><p className="text-sm font-bold text-slate-800">{money(med.tot_cost)}</p></div>
            <div><p className="text-[10px] uppercase text-slate-400">Per Claim</p><p className="text-sm font-bold text-slate-800">{money(med.avg_per_claim)}</p></div>
          </div>
        )}

        {lead.interests?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {lead.interests.map((i) => <span key={i} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{i}</span>)}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          {lead.phone && <span>{lead.phone}</span>}
          {lead.email && <span>{lead.email}</span>}
          {lead.assigned_to && <span className="font-semibold text-primary">· {lead.assigned_to}</span>}
        </div>

        <div className="mt-3 flex gap-2">
          <button data-testid={`open-${lead.id}`} onClick={() => onOpen(lead)} className="flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white"><ExternalLink className="h-3.5 w-3.5" /> Open</button>
          <button data-testid={`assign-${lead.id}`} onClick={() => onAssign(lead)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><UserPlus className="h-3.5 w-3.5" /> Assign to me</button>
          <button data-testid={`note-${lead.id}`} onClick={() => onNote(lead)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><StickyNote className="h-3.5 w-3.5" /> Note</button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [leads, setLeads] = useState([]);
  const [counters, setCounters] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [filters, setFilters] = useState({ tier_340b: "", tier_rpm: "", state: "", match_status: "", sort: "created_at" });
  const [showAlerts, setShowAlerts] = useState(false);
  const wsRef = useRef(null);

  const load = useCallback(async () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    const [l, c] = await Promise.all([
      api.get("/dashboard/leads", { params }),
      api.get("/dashboard/counters"),
    ]);
    setLeads(l.data);
    setCounters(c.data);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get("/dashboard/alerts").then((r) => setAlerts(r.data)).catch(() => {});
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    const connect = () => {
      const ws = new WebSocket(wsUrl("dashboard"));
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "new_lead") {
          setLeads((prev) => [msg.lead, ...prev.filter((x) => x.id !== msg.lead.id)]);
          if (msg.lead.tier_340b === "GREEN" || msg.lead.tier_rpm === "GREEN") {
            beepGreen();
            toast.success(`🟢 GREEN lead: Dr. ${msg.lead.first_name} ${msg.lead.last_name}`, { duration: 8000 });
          }
          api.get("/dashboard/counters").then((r) => setCounters(r.data)).catch(() => {});
        } else if (msg.type === "alert") {
          setAlerts((prev) => [msg.log, ...prev]);
        } else if (msg.type === "alert_update") {
          setAlerts((prev) => prev.map((a) => (a.sid === msg.sid ? { ...a, status: msg.status, error: msg.error || a.error } : a)));
        } else if (msg.type === "spin") {
          setLeads((prev) => prev.map((l) => (l.id === msg.lead_id ? { ...l, spun: true, prize: msg.prize } : l)));
        }
      };
      ws.onclose = () => setTimeout(connect, 3000); // polling-style reconnect
    };
    connect();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      wsRef.current?.close();
    };
  }, []);

  const assign = async (lead) => {
    await api.post(`/dashboard/leads/${lead.id}/assign`, { assigned_to: user.name });
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, assigned_to: user.name } : l)));
    toast.success("Assigned to you");
  };
  const addNote = async (lead) => {
    const text = window.prompt("Add a note");
    if (!text) return;
    await api.post(`/dashboard/leads/${lead.id}/note`, { text });
    toast.success("Note added");
  };
  const fetchExport = async (fmt) => {
    const res = await api.get(`/dashboard/export`, { params: { fmt }, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boothiq_leads.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const failedAlerts = alerts.filter((a) => ["failed", "undelivered", "unknown", "undelivered "].includes(a.status) || (a.error && a.status !== "digest" && a.status !== "sent" && a.status !== "delivered"));
  const delayedAlerts = alerts.filter((a) => a.delayed);
  const topError = (() => {
    const counts = {};
    failedAlerts.forEach((a) => { if (a.error) counts[a.error] = (counts[a.error] || 0) + 1; });
    const sorted = Object.entries(counts).sort((x, y) => y[1] - x[1]);
    return sorted.length ? sorted[0][0] : null;
  })();

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            <span className="font-display text-lg font-bold">BoothIQ</span>
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Live Dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <button data-testid="refresh-btn" onClick={load} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><RefreshCw className="h-4 w-4" /></button>
            <button data-testid="alerts-toggle" onClick={() => setShowAlerts(!showAlerts)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100">
              <Bell className="h-4 w-4" />
              {failedAlerts.length > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
            </button>
            <button data-testid="nav-leads" onClick={() => nav("/leads")} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Filter className="h-3.5 w-3.5" /> Leads</button>
            <button data-testid="export-csv" onClick={() => fetchExport("csv")} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> CSV</button>
            <button data-testid="export-xlsx" onClick={() => fetchExport("xlsx")} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> XLSX</button>
            {user?.role === "admin" && <button onClick={() => nav("/admin")} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Settings2 className="h-4 w-4" /></button>}
            <button data-testid="logout-btn" onClick={() => { logout(); nav("/login"); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        {!online && (
          <div data-testid="offline-banner" className="flex items-center gap-2 bg-red-500 px-5 py-2 text-sm font-semibold text-white">
            <WifiOff className="h-4 w-4" /> You are OFFLINE. Instant SMS alerts require connectivity — use a cellular iPad or dedicated hotspot.
          </div>
        )}
        {online && delayedAlerts.length > 0 && (
          <div className="flex items-center gap-2 bg-amber-500 px-5 py-2 text-sm font-semibold text-white">
            <AlertTriangle className="h-4 w-4" /> {delayedAlerts.length} alert(s) were delayed due to a connectivity gap.
          </div>
        )}
        {failedAlerts.length > 0 && (
          <div data-testid="sms-health-banner" className="flex items-center gap-2 bg-red-600 px-5 py-2 text-sm font-semibold text-white">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            SMS delivery problem — {failedAlerts.length} alert(s) not delivered{topError ? ` (${topError})` : ""}. Check roster numbers and Twilio A2P 10DLC registration.
          </div>
        )}
      </header>

      {/* Counters */}
      {counters && (
        <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4 lg:grid-cols-7">
          {TIERS.map((t) => (
            <div key={t} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
              <div className={`mx-auto mb-1 h-2 w-8 rounded-full ${TIER_STYLES[t].band}`} />
              <p className="text-xl font-bold text-slate-900">{(counters.by_340b[t] || 0)}<span className="text-sm text-slate-400">/{counters.by_rpm[t] || 0}</span></p>
              <p className="text-[10px] uppercase text-slate-400">{t} 340B/RPM</p>
            </div>
          ))}
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center"><p className="text-xl font-bold text-slate-900">{counters.spins_today}</p><p className="text-[10px] uppercase text-slate-400">Spins</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center"><p className="text-xl font-bold text-slate-900">{counters.prizes_remaining}</p><p className="text-[10px] uppercase text-slate-400">Prizes left</p></div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <Filter className="h-4 w-4 text-slate-400" />
        {[["tier_340b", "340B tier"], ["tier_rpm", "RPM tier"]].map(([k, label]) => (
          <select key={k} data-testid={`filter-${k}`} value={filters[k]} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
            <option value="">{label}: all</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ))}
        <select data-testid="filter-match" value={filters.match_status} onChange={(e) => setFilters({ ...filters, match_status: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
          <option value="">Match: all</option>
          {["confirmed", "probable", "unresolved"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input data-testid="filter-state" placeholder="State" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" />
        <select data-testid="filter-sort" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
          <option value="created_at">Newest</option>
          <option value="tot_cost">Drug cost</option>
          <option value="avg_per_claim">Per claim</option>
          <option value="tot_clms">Claim volume</option>
        </select>
      </div>

      {/* Feed */}
      <div className="grid grid-cols-1 gap-4 px-5 pb-10 md:grid-cols-2 xl:grid-cols-3">
        {leads.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
            No leads captured yet. Ensure the kiosk is online.
          </div>
        )}
        {leads.map((lead) => <LeadCard key={lead.id} lead={lead} onAssign={assign} onNote={addNote} onOpen={() => nav(`/lead/${lead.id}`)} />)}
      </div>

      {/* Alerts drawer */}
      {showAlerts && (
        <div className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <h3 className="font-display font-bold">SMS Alert Log</h3>
            <button onClick={() => setShowAlerts(false)} className="text-slate-400">✕</button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {alerts.length === 0 && <p className="text-sm text-slate-400">No alerts yet.</p>}
            {alerts.map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{a.staff_name} · {a.to}</span>
                  {a.status === "sent" || a.status === "queued" || a.status === "delivered" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : a.status === "digest" ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                </div>
                <p className="mt-1 text-xs text-slate-500">{a.body}</p>
                <div className="mt-1 flex gap-2 text-[10px] uppercase text-slate-400">
                  <span>{a.status}</span>
                  {a.delayed && <span className="text-amber-600">delayed</span>}
                  {a.error && <span className="text-red-500">{a.error}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
