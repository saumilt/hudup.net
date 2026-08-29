import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatCard, money } from "@/components/crm/kit";

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
      </div>
    </div>
  );
}
