import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { money, TierPill } from "@/components/crm/kit";
import { Target } from "lucide-react";

const STAGES = ["Discovery", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

export default function Opportunities() {
  const [opps, setOpps] = useState([]);
  const load = useCallback(async () => { const r = await api.get("/crm/opportunities"); setOpps(r.data); }, []);
  useEffect(() => { load(); }, [load]);

  const move = async (opp, stage) => {
    await api.patch(`/crm/opportunities/${opp.id}`, { stage });
    toast.success(`${opp.opp_number} → ${stage}`); load();
  };

  const totalOpen = opps.filter((o) => o.status === "open").reduce((s, o) => s + (o.value || 0), 0);

  return (
    <div>
      <PageHeader title="Opportunities" subtitle={`${opps.length} total · ${money(totalOpen)} open pipeline`} />
      <div className="grid grid-cols-1 gap-3 overflow-x-auto p-6 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((stage) => {
          const inStage = opps.filter((o) => o.stage === stage);
          const val = inStage.reduce((s, o) => s + (o.value || 0), 0);
          return (
            <div key={stage} data-testid={`opp-col-${stage.replace(/\s/g, "-")}`} className="min-w-[220px] rounded-xl bg-white/60 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{stage}</span>
                <span className="text-xs text-slate-400">{money(val)}</span>
              </div>
              <div className="space-y-2">
                {inStage.length === 0 && <p className="px-1 py-6 text-center text-xs text-slate-300">Empty</p>}
                {inStage.map((o) => {
                  const snap = o.medicare_snapshot || {};
                  return (
                    <div key={o.id} data-testid={`opp-${o.id}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-slate-400">{o.opp_number}</span>
                        <span className="text-sm font-bold text-slate-800">{money(o.value)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-800">{o.name}</p>
                      <div className="mt-1 flex gap-1"><TierPill kind="" tier={snap.tier_340b} /><TierPill kind="" tier={snap.tier_rpm} /></div>
                      <select data-testid={`opp-stage-${o.id}`} value={o.stage} onChange={(e) => move(o, e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs">
                        {STAGES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {opps.length === 0 && <div className="px-6"><div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center"><Target className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="font-semibold text-slate-600">No opportunities yet</p><p className="mt-1 text-sm text-slate-400">Convert a qualified lead to create one.</p></div></div>}
    </div>
  );
}
