import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { TierPill, Btn, money, fmtDate, ProbabilityBadge } from "@/components/crm/kit";
import { ArrowLeft, Stethoscope, UserPlus, Activity } from "lucide-react";

export default function PhysicianWorkspace() {
  const { npi } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => api.get(`/crm/physicians/${npi}/workspace`).then((r) => setData(r.data)).catch((e) => setErr(formatApiError(e.response?.data?.detail)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [npi]);

  if (err) return <div className="p-10 text-slate-400">{err}</div>;
  if (!data) return <div className="p-10 text-slate-400">Loading…</div>;
  const p = data.physician;
  const snap = { tier_340b: p.tier_340b, tier_rpm: p.tier_rpm };

  const createLead = async () => {
    try {
      const r = await api.post("/crm/leads", { org_name: `${p.first_name} ${p.last_name} Practice`, source: "Medicare Search", matched_npi: p.npi, dataset_year: p.dataset_year, contact_first: p.first_name, contact_last: p.last_name });
      toast.success(`Lead ${r.data.lead_number} created`); nav(`/crm/leads/${r.data.id}`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const avg = p.avg_per_claim || (p.tot_clms ? p.tot_cost / p.tot_clms : 0);

  return (
    <div>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => nav(-1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></button>
            <div>
              <div className="flex items-center gap-2"><Stethoscope className="h-4 w-4 text-primary" /><span className="font-mono text-xs text-slate-400">NPI {p.npi}</span><ProbabilityBadge snapshot={snap} /></div>
              <h1 className="font-display text-xl font-bold text-slate-900">Dr. {p.first_name} {p.last_name}</h1>
              <p className="text-xs text-slate-400">{p.specialty} · {p.city}, {p.state}</p>
            </div>
          </div>
          {data.leads.length === 0 && <Btn data-testid="pw-create-lead" onClick={createLead}><UserPlus className="h-4 w-4" /> Create Lead</Btn>}
        </div>
      </header>

      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-display font-bold text-slate-900">Medicare Intelligence <span className="text-xs font-normal text-slate-400">(CMS {p.dataset_year})</span></h2>
            <div className="mb-3 flex gap-2"><TierPill kind="340B" tier={p.tier_340b} /><TierPill kind="RPM" tier={p.tier_rpm} /></div>
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-4 text-center">
              <div><p className="text-[10px] uppercase text-slate-400">Total Claims</p><p className="font-display text-lg font-bold text-slate-800">{Number(p.tot_clms || 0).toLocaleString()}</p></div>
              <div><p className="text-[10px] uppercase text-slate-400">Total Drug Cost</p><p className="font-display text-lg font-bold text-slate-800">{money(p.tot_cost)}</p></div>
              <div><p className="text-[10px] uppercase text-slate-400">Avg $/Claim</p><p className="font-display text-lg font-bold text-slate-800">{money(avg)}</p></div>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-display font-bold text-slate-900">CRM Leads</h2>
            {data.leads.length === 0 ? <p className="text-sm text-slate-400">No CRM leads yet for this physician.</p> :
              data.leads.map((l) => (
                <button key={l.id} onClick={() => nav(`/crm/leads/${l.id}`)} className="flex w-full items-center justify-between rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50">
                  <span><span className="font-semibold text-slate-800">{l.org_name || l.lead_number}</span><span className="block text-xs text-slate-400">{l.lead_number} · {l.status}</span></span>
                  <span className="text-xs text-primary">Open →</span>
                </button>
              ))}
          </section>
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><Activity className="h-4 w-4 text-primary" /> Activity</h2>
          {data.activities.length === 0 ? <p className="text-sm text-slate-400">No activity yet.</p> :
            <ol className="space-y-3">{data.activities.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm"><div className="mt-1 h-2 w-2 rounded-full bg-primary" /><div><p className="text-slate-700">{a.summary}</p><p className="text-xs text-slate-400">{a.by_name} · {fmtDate(a.at)}</p></div></li>
            ))}</ol>}
        </section>
      </div>
    </div>
  );
}
