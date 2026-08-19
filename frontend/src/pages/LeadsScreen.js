import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, money } from "@/lib/api";
import { TIER_STYLES } from "@/components/TierBadge";
import { ArrowLeft, Download, Filter, Search } from "lucide-react";

const TIERS = ["GREEN", "YELLOW", "BLUE", "RED", "GREY"];

export default function LeadsScreen() {
  const nav = useNavigate();
  const [leads, setLeads] = useState([]);
  const [events, setEvents] = useState([]);
  const [roster, setRoster] = useState([]);
  const [f, setF] = useState({ event_id: "", tier_340b: "", tier_rpm: "", state: "", specialty: "", interest: "", match_status: "", associate_id: "", sort: "created_at" });

  const load = useCallback(async () => {
    const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    const r = await api.get("/dashboard/leads", { params: { ...params, limit: 500 } });
    setLeads(r.data);
  }, [f]);

  useEffect(() => {
    api.get("/kiosk/events").then((r) => setEvents(r.data)).catch(() => {});
    api.get("/admin/roster").then((r) => setRoster(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const exportFile = async (fmt) => {
    const res = await api.get("/dashboard/export", { params: { fmt, ...(f.event_id ? { event_id: f.event_id } : {}) }, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a"); a.href = url; a.download = `boothiq_leads.${fmt}`; a.click(); URL.revokeObjectURL(url);
  };

  const sel = "rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs";

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <button data-testid="leads-back" onClick={() => nav("/dashboard")} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-5 w-5" /></button>
          <h1 className="font-display text-lg font-bold">Filter &amp; Select Leads</h1>
        </div>
        <div className="flex gap-2">
          <button data-testid="leads-export-csv" onClick={() => exportFile("csv")} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"><Download className="h-3.5 w-3.5" /> CSV</button>
          <button data-testid="leads-export-xlsx" onClick={() => exportFile("xlsx")} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"><Download className="h-3.5 w-3.5" /> XLSX</button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <Filter className="h-4 w-4 text-slate-400" />
        <select data-testid="lf-event" className={sel} value={f.event_id} onChange={(e) => setF({ ...f, event_id: e.target.value })}>
          <option value="">All events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select data-testid="lf-340b" className={sel} value={f.tier_340b} onChange={(e) => setF({ ...f, tier_340b: e.target.value })}>
          <option value="">340B: all</option>{TIERS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select data-testid="lf-rpm" className={sel} value={f.tier_rpm} onChange={(e) => setF({ ...f, tier_rpm: e.target.value })}>
          <option value="">RPM: all</option>{TIERS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select data-testid="lf-match" className={sel} value={f.match_status} onChange={(e) => setF({ ...f, match_status: e.target.value })}>
          <option value="">Match: all</option>{["confirmed", "probable", "unresolved"].map((m) => <option key={m}>{m}</option>)}
        </select>
        <select data-testid="lf-associate" className={sel} value={f.associate_id} onChange={(e) => setF({ ...f, associate_id: e.target.value })}>
          <option value="">Associate: all</option>{roster.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input data-testid="lf-state" className={`${sel} w-20`} placeholder="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
        <input data-testid="lf-specialty" className={`${sel} w-36`} placeholder="Specialty" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} />
        <input data-testid="lf-interest" className={`${sel} w-40`} placeholder="Interest" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} />
        <select data-testid="lf-sort" className={sel} value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
          <option value="created_at">Newest</option><option value="tot_cost">Drug cost</option><option value="avg_per_claim">Per claim</option><option value="tot_clms">Claim volume</option>
        </select>
        <span className="ml-auto flex items-center gap-1 text-xs text-slate-400"><Search className="h-3.5 w-3.5" /> {leads.length} results</span>
      </div>

      <div className="overflow-x-auto px-5 py-4">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              <th className="p-2">Physician</th><th className="p-2">Specialty</th><th className="p-2">Loc</th>
              <th className="p-2">340B</th><th className="p-2">RPM</th><th className="p-2">Match</th>
              <th className="p-2">Claims</th><th className="p-2">Drug Cost</th><th className="p-2">Per Claim</th>
              <th className="p-2">Associate</th><th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const med = l.medicare || {};
              return (
                <tr key={l.id} data-testid={`leadrow-${l.id}`} className="border-b border-slate-100 hover:bg-white">
                  <td className="p-2 font-semibold text-slate-800">Dr. {l.first_name} {l.last_name}</td>
                  <td className="p-2 text-slate-600">{l.specialty || "—"}</td>
                  <td className="p-2 text-slate-600">{l.city || "?"} {l.state || ""}</td>
                  <td className="p-2"><span className="inline-flex items-center gap-1 text-xs font-bold"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color_340b || "#cbd5e1" }} />{l.shade_340b || l.tier_340b}</span></td>
                  <td className="p-2"><span className="inline-flex items-center gap-1 text-xs font-bold"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color_rpm || "#cbd5e1" }} />{l.tier_rpm}</span></td>
                  <td className="p-2 text-xs text-slate-500">{l.match_status}</td>
                  <td className="p-2">{med.tot_clms != null ? Number(med.tot_clms).toLocaleString() : "—"}</td>
                  <td className="p-2">{money(med.tot_cost)}</td>
                  <td className="p-2">{money(med.avg_per_claim)}</td>
                  <td className="p-2 text-slate-600">{l.associate_name || "—"}</td>
                  <td className="p-2"><button data-testid={`open-${l.id}`} onClick={() => nav(`/lead/${l.id}`)} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white">Open</button></td>
                </tr>
              );
            })}
            {leads.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-slate-400">No leads match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
