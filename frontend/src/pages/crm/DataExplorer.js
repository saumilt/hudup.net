import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Btn, StatCard, inputCls } from "@/components/crm/kit";
import { PageHeader } from "@/components/crm/CrmShell";
import { Compass } from "lucide-react";

export default function DataExplorer() {
  const nav = useNavigate();
  const [f, setF] = useState({ state: "", specialty: "", tier_340b: "", min_avg: "" });
  const [data, setData] = useState(null);

  const run = useCallback(async () => {
    const params = {};
    if (f.state) params.state = f.state;
    if (f.specialty) params.specialty = f.specialty;
    if (f.tier_340b) params.tier_340b = f.tier_340b;
    if (f.min_avg) params.min_avg = f.min_avg;
    const r = await api.get("/crm/explorer", { params });
    setData(r.data);
  }, [f]);
  useEffect(() => { run(); }, []); // eslint-disable-line

  const makeCallList = async () => {
    try {
      await api.post("/crm/call-lists", { name: `${f.state || "All"} ${f.specialty || ""} ${f.tier_340b || ""}`.trim(), filter: { tier_340b: f.tier_340b || undefined, state: f.state || undefined } });
      toast.success("Call list created from this segment"); nav("/crm/call-lists");
    } catch { toast.error("Could not create call list"); }
  };

  return (
    <div>
      <PageHeader title="Data Explorer" subtitle="Drill into the Medicare universe and act on any slice" />
      <div className="p-6">
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5">
          <input data-testid="dx-state" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} placeholder="State (e.g. TX)" className={inputCls} />
          <input data-testid="dx-specialty" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} placeholder="Specialty" className={inputCls} />
          <select data-testid="dx-tier" value={f.tier_340b} onChange={(e) => setF({ ...f, tier_340b: e.target.value })} className={inputCls}><option value="">Any 340B tier</option>{["GREEN", "YELLOW", "BLUE", "RED"].map((t) => <option key={t}>{t}</option>)}</select>
          <input data-testid="dx-minavg" type="number" value={f.min_avg} onChange={(e) => setF({ ...f, min_avg: e.target.value })} placeholder="Min $/claim" className={inputCls} />
          <Btn onClick={run} data-testid="dx-run"><Compass className="h-4 w-4" /> Explore</Btn>
        </div>
        {data && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard testid="dx-physicians" label="Physicians in slice" value={(data.physicians || 0).toLocaleString()} />
              <StatCard testid="dx-incrm" label="Already in CRM" value={(data.in_crm || 0).toLocaleString()} />
              <StatCard testid="dx-notincrm" label="Not yet in CRM" value={(data.not_in_crm || 0).toLocaleString()} />
            </div>
            <div className="mt-3 flex gap-2">
              <Btn onClick={makeCallList} data-testid="dx-make-calllist">Create Call List</Btn>
              <Btn variant="ghost" onClick={() => nav("/crm/medicare")}>Open in Medicare Search</Btn>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Facet title="Top states" items={data.states} onPick={(v) => setF({ ...f, state: v })} />
              <Facet title="Top specialties" items={data.specialties} onPick={(v) => setF({ ...f, specialty: v })} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Facet({ title, items, onPick }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 font-display font-bold text-slate-900">{title}</h3>
      <div className="space-y-1">
        {(items || []).map((it) => (
          <button key={it.value} onClick={() => onPick(it.value)} className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50">
            <span className="text-slate-700">{it.value}</span><span className="font-semibold text-slate-400">{it.count.toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
