import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatCard, money, Btn } from "@/components/crm/kit";
import { Search, Users2, Target } from "lucide-react";

export default function CrmDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isAM = user?.role === "account_manager";
  const [rep, setRep] = useState(null);

  useEffect(() => {
    api.get("/crm/reports", { params: { type: isAM ? "account_manager" : "lead_manager" } })
      .then((r) => setRep(r.data)).catch(() => {});
  }, [isAM]);

  return (
    <div>
      <PageHeader title={`Welcome, ${user?.name?.split(" ")[0] || ""}`} subtitle={isAM ? "Your assigned book of business" : "Team lead pipeline overview"}>
        <Btn onClick={() => nav("/crm/medicare")} data-testid="dash-medicare"><Search className="h-4 w-4" /> Medicare Search</Btn>
        <Btn variant="ghost" onClick={() => nav("/crm/leads")} data-testid="dash-leads"><Users2 className="h-4 w-4" /> Leads</Btn>
      </PageHeader>

      <div className="p-6">
        {!rep && <p className="text-slate-400">Loading metrics…</p>}
        {rep && isAM && (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard testid="stat-my-leads" label="My Leads" value={rep.my_leads} />
              <StatCard testid="stat-open-opps" label="Open Opportunities" value={rep.my_open_opps} />
              <StatCard testid="stat-tasks-overdue" label="Tasks Overdue" value={rep.tasks_overdue} />
              <StatCard testid="stat-upcoming-meetings" label="Upcoming Meetings" value={rep.upcoming_meetings} />
            </div>
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><Target className="h-4 w-4 text-primary" /> Pipeline value by stage</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {Object.entries(rep.pipeline_value_by_stage || {}).length === 0 && <p className="text-sm text-slate-400">No open opportunities.</p>}
                {Object.entries(rep.pipeline_value_by_stage || {}).map(([stage, v]) => (
                  <div key={stage} className="rounded-lg bg-slate-50 p-3"><p className="text-xs uppercase text-slate-400">{stage}</p><p className="font-bold text-slate-800">{money(v)}</p></div>
                ))}
              </div>
            </div>
          </>
        )}
        {rep && !isAM && (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard testid="stat-total-leads" label="Total Leads" value={rep.total_leads} />
              <StatCard testid="stat-unassigned" label="Unassigned" value={rep.unassigned} />
              <StatCard testid="stat-needs-match" label="Needs Medicare Match" value={rep.needs_medicare_match} />
              <StatCard testid="stat-conversion" label="Lead → Opp" value={`${rep.conversion_rate}%`} />
              <StatCard label="Tasks Overdue" value={rep.tasks_overdue} />
              <StatCard label="Upcoming Meetings" value={rep.upcoming_meetings} />
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="mb-3 font-display font-bold text-slate-900">Leads by Status</h3>
                {Object.entries(rep.by_status || {}).map(([s, c]) => (
                  <div key={s} className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-600">{s}</span><span className="font-bold text-slate-800">{c}</span></div>
                ))}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="mb-3 font-display font-bold text-slate-900">Leads by Source</h3>
                {Object.entries(rep.by_source || {}).map(([s, c]) => (
                  <div key={s} className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-600">{s}</span><span className="font-bold text-slate-800">{c}</span></div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
