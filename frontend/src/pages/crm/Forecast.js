import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatCard, money, Btn, inputCls } from "@/components/crm/kit";

function AttainBar({ label, value, target, fmt }) {
  const p = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const color = p >= 100 ? "bg-emerald-500" : p >= 60 ? "bg-primary" : "bg-amber-400";
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-500">{label}</span>
        <span className="font-mono text-slate-600">{fmt ? fmt(value) : value}<span className="text-slate-300"> / {target ? (fmt ? fmt(target) : target) : "—"}</span></span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${color}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function QuotaAttainment() {
  const [rows, setRows] = useState(null);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/crm/quotas/attainment").then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const startEdit = (r) => { setEditId(r.user_id); setForm({ leads_target: r.leads_target, meetings_target: r.meetings_target, opps_target: r.opps_target, revenue_target: r.revenue_target }); };
  const save = async (uid) => {
    setBusy(true);
    try {
      await api.put("/crm/quotas", { user_id: uid, leads_target: Number(form.leads_target) || 0, meetings_target: Number(form.meetings_target) || 0, opps_target: Number(form.opps_target) || 0, revenue_target: Number(form.revenue_target) || 0 });
      setEditId(null); await load(); toast.success("Targets saved");
    } catch { toast.error("Could not save targets"); } finally { setBusy(false); }
  };
  if (!rows) return null;
  return (
    <div data-testid="quota-attainment" className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-display font-bold text-slate-900">Monthly Quota Attainment</h2>
        <span className="text-xs text-slate-400">This month · leads &amp; meetings assigned to each rep</span>
      </div>
      {rows.length === 0 ? <p className="mt-3 text-sm text-slate-400">No reps yet.</p> : (
        <div className="mt-3 space-y-4">
          {rows.map((r) => (
            <div key={r.user_id} data-testid="quota-row" className="rounded-xl border border-slate-100 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800">{r.name}</span>
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">{r.role === "lead_manager" ? "Lead Mgr" : "Rep"}</span>
                </div>
                {editId === r.user_id ? null : (
                  <button data-testid={`quota-edit-${r.user_id}`} onClick={() => startEdit(r)} className="text-xs font-bold text-primary hover:underline">Edit targets</button>
                )}
              </div>
              {editId === r.user_id ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[["leads_target", "Leads"], ["meetings_target", "Meetings"], ["opps_target", "Opps"], ["revenue_target", "Revenue $"]].map(([k, lbl]) => (
                    <label key={k} className="block text-xs font-semibold text-slate-500">{lbl}
                      <input data-testid={`quota-input-${k}`} type="number" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={`${inputCls} mt-1`} />
                    </label>
                  ))}
                  <div className="col-span-2 flex gap-2 sm:col-span-4">
                    <Btn data-testid={`quota-save-${r.user_id}`} onClick={() => save(r.user_id)} disabled={busy}>Save</Btn>
                    <Btn variant="ghost" onClick={() => setEditId(null)}>Cancel</Btn>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
                  <AttainBar label="Leads" value={r.leads} target={r.leads_target} />
                  <AttainBar label="Meetings" value={r.meetings} target={r.meetings_target} />
                  <AttainBar label="Opps" value={r.opps} target={r.opps_target} />
                  <AttainBar label="Revenue" value={r.revenue} target={r.revenue_target} fmt={money} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Forecast() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/crm/forecast").then((r) => setD(r.data)).catch(() => {}); }, []);
  if (!d) return <div className="p-6 text-slate-400">Loading…</div>;
  return (
    <div>
      <PageHeader title="Sales Forecast" subtitle="Pipeline, weighted forecast and win rate" />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard testid="fc-pipeline" label="Open Pipeline" value={money(d.pipeline_value)} />
          <StatCard testid="fc-weighted" label="Weighted Forecast" value={money(d.weighted_forecast)} />
          <StatCard testid="fc-winrate" label="Win Rate" value={`${d.win_rate}%`} />
          <StatCard label="Avg Deal" value={money(d.avg_deal)} />
          <StatCard label="Won Revenue" value={money(d.won_value)} />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-display font-bold text-slate-900">Pipeline by Stage</h2>
          <div className="space-y-2">
            {d.by_stage.map((s) => (
              <div key={s.stage} className="flex items-center gap-3">
                <span className="w-32 text-sm font-semibold text-slate-700">{s.stage}</span>
                <span className="w-8 text-xs text-slate-400">{s.count}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, (s.value / (d.pipeline_value || 1)) * 100)}%` }} />
                </div>
                <span className="w-24 text-right font-mono text-sm text-slate-600">{money(s.value)}</span>
                <span className="w-12 text-right text-xs text-slate-400">{s.prob}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-display font-bold text-slate-900">By Account Manager</h2>
          {d.by_owner.length === 0 ? <p className="text-sm text-slate-400">No opportunities yet.</p> :
            d.by_owner.map((r) => (
              <div key={r.owner_id} data-testid="fc-owner" className="flex items-center justify-between border-b border-slate-50 py-2 text-sm">
                <span className="font-semibold text-slate-700">{r.name}</span>
                <span className="flex gap-6"><span className="text-slate-400">Weighted <b className="text-slate-700">{money(r.weighted)}</b></span><span className="text-slate-400">Won <b className="text-emerald-600">{money(r.won_value)}</b></span></span>
              </div>
            ))}
        </div>

        <QuotaAttainment />
      </div>
    </div>
  );
}
