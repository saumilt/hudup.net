import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatusBadge, TierPill, Btn, EmptyState, money, fmtDate } from "@/components/crm/kit";
import { Archive, RotateCcw, Users2, Target } from "lucide-react";

export default function ArchiveBin() {
  const nav = useNavigate();
  const [leads, setLeads] = useState([]);
  const [opps, setOpps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, o] = await Promise.all([
        api.get("/crm/leads", { params: { archived: true, limit: 500 } }),
        api.get("/crm/opportunities", { params: { archived: true, limit: 500 } }),
      ]);
      setLeads(l.data); setOpps(o.data);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const restoreLead = async (id) => {
    try { await api.post(`/crm/leads/${id}/archive`, { archived: false }); toast.success("Lead restored"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const restoreOpp = async (id) => {
    try { await api.post(`/crm/opportunities/${id}/archive`, { archived: false }); toast.success("Opportunity restored"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Archive Bin" subtitle={`${leads.length} lead(s) · ${opps.length} opportunity(ies) archived`} />
      <div className="space-y-6 p-6">
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white" data-testid="arch-leads-section">
          <div className="flex items-center gap-2 border-b border-slate-100 p-4"><Users2 className="h-4 w-4 text-primary" /><h2 className="font-display font-bold text-slate-900">Archived Leads</h2></div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr>
              <th className="p-3">Lead</th><th className="p-3">Contact / Org</th><th className="p-3">Status</th><th className="p-3">340B</th><th className="p-3">Owner</th><th className="p-3"></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="p-8 text-center text-slate-400">Loading…</td></tr>}
              {!loading && leads.length === 0 && <tr><td colSpan={6}><EmptyState icon={Archive} title="No archived leads" hint="Leads you archive will appear here." /></td></tr>}
              {!loading && leads.map((l) => { const snap = l.medicare_snapshot || {}; return (
                <tr key={l.id} data-testid={`arch-lead-${l.id}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="cursor-pointer p-3 font-mono text-xs text-slate-500" onClick={() => nav(`/crm/leads/${l.id}`)}>{l.lead_number}</td>
                  <td className="cursor-pointer p-3 font-semibold text-slate-800" onClick={() => nav(`/crm/leads/${l.id}`)}>{l.org_name || `${l.contact_first || ""} ${l.contact_last || ""}`.trim() || "—"}</td>
                  <td className="p-3"><StatusBadge status={l.status} /></td>
                  <td className="p-3"><TierPill kind="" tier={snap.tier_340b} /></td>
                  <td className="p-3 text-slate-500">{l.account_manager_name || "Unassigned"}</td>
                  <td className="p-3 text-right"><Btn variant="ghost" onClick={() => restoreLead(l.id)} data-testid={`arch-lead-restore-${l.id}`}><RotateCcw className="h-4 w-4" /> Restore</Btn></td>
                </tr>
              ); })}
            </tbody>
          </table>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white" data-testid="arch-opps-section">
          <div className="flex items-center gap-2 border-b border-slate-100 p-4"><Target className="h-4 w-4 text-primary" /><h2 className="font-display font-bold text-slate-900">Archived Opportunities</h2></div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr>
              <th className="p-3">Opp</th><th className="p-3">Name</th><th className="p-3">Stage</th><th className="p-3">Value</th><th className="p-3"></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="p-8 text-center text-slate-400">Loading…</td></tr>}
              {!loading && opps.length === 0 && <tr><td colSpan={5}><EmptyState icon={Archive} title="No archived opportunities" hint="Opportunities you archive will appear here." /></td></tr>}
              {!loading && opps.map((o) => (
                <tr key={o.id} data-testid={`arch-opp-${o.id}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-mono text-xs text-slate-500">{o.opp_number}</td>
                  <td className="p-3 font-semibold text-slate-800">{o.name}</td>
                  <td className="p-3 text-slate-500">{o.stage}</td>
                  <td className="p-3 font-bold text-slate-800">{money(o.value)}</td>
                  <td className="p-3 text-right"><Btn variant="ghost" onClick={() => restoreOpp(o.id)} data-testid={`arch-opp-restore-${o.id}`}><RotateCcw className="h-4 w-4" /> Restore</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
