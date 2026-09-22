import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatusBadge, PriorityTag, TierPill, EmptyState, fmtDate } from "@/components/crm/kit";
import { Handshake } from "lucide-react";

export default function CloserQueue() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isAdmin = ["admin", "super_admin"].includes(user?.role);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = isAdmin ? { has_closer: true, limit: 500 } : { closer_id: user?.id, limit: 500 };
      const r = await api.get("/crm/leads", { params });
      setLeads(r.data);
    } finally { setLoading(false); }
  }, [isAdmin, user?.id]);
  useEffect(() => { load(); }, [load]);

  const cols = isAdmin ? 8 : 7;
  return (
    <div>
      <PageHeader
        title="Closer Queue"
        subtitle={isAdmin ? `${leads.length} lead(s) with a closer assigned` : `${leads.length} deal(s) you're closing`}
      />
      <div className="p-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="p-3">Lead</th><th className="p-3">Contact / Org</th><th className="p-3">Status</th>
                <th className="p-3">Priority</th><th className="p-3">340B</th>
                <th className="p-3">Owner</th>{isAdmin && <th className="p-3">Closer</th>}<th className="p-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={cols} className="p-8 text-center text-slate-400">Loading…</td></tr>}
              {!loading && leads.length === 0 && <tr><td colSpan={cols}><EmptyState icon={Handshake} title="No deals to close" hint={isAdmin ? "No leads have a closer assigned yet." : "You haven't been added as a closer on any lead yet."} /></td></tr>}
              {!loading && leads.map((l) => {
                const snap = l.medicare_snapshot || {};
                return (
                  <tr key={l.id} data-testid={`closer-row-${l.id}`} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => nav(`/crm/leads/${l.id}`)}>
                    <td className="p-3 font-mono text-xs text-slate-500">{l.lead_number}</td>
                    <td className="p-3 font-semibold text-slate-800">{l.org_name || `${l.contact_first || ""} ${l.contact_last || ""}`.trim() || "—"}</td>
                    <td className="p-3"><StatusBadge status={l.status} /></td>
                    <td className="p-3"><PriorityTag priority={l.priority} /></td>
                    <td className="p-3"><TierPill kind="" tier={snap.tier_340b} /></td>
                    <td className="p-3 text-slate-500">{l.account_manager_name || "Unassigned"}</td>
                    {isAdmin && <td className="p-3 text-slate-500">{l.closer_name || "—"}</td>}
                    <td className="p-3 text-xs text-slate-400">{fmtDate(l.last_activity_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
