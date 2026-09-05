import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/crm/CrmShell";
import { EmptyState, TierPill } from "@/components/crm/kit";
import { AlertTriangle } from "lucide-react";

export default function MismatchReport() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/crm/leads", { params: { claim_mismatch: true, limit: 1000 } })
      .then((r) => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Claim Mismatch Report" subtitle={`${rows.length} lead(s) where imported claims disagreed with Medicare`} />
      <div className="p-6">
        {loading ? (
          <div className="p-10 text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="No claim mismatches" hint="Imported claim counts all matched Medicare data." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-3">Lead</th><th className="p-3">Contact / Org</th><th className="p-3">NPI</th>
                  <th className="p-3">340B</th>
                  <th className="p-3 text-right">Imported claims</th>
                  <th className="p-3 text-right">Medicare claims</th>
                  <th className="p-3">Assigned to</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const d = l.claim_mismatch_detail || {};
                  const snap = l.medicare_snapshot || {};
                  return (
                    <tr key={l.id} data-testid={`mismatch-row-${l.id}`} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => nav(`/crm/leads/${l.id}`)}>
                      <td className="p-3 font-mono text-xs text-slate-500">{l.lead_number}</td>
                      <td className="p-3 font-semibold text-slate-800">{l.org_name || `${l.contact_first || ""} ${l.contact_last || ""}`.trim() || "—"}</td>
                      <td className="p-3 font-mono text-xs text-slate-500">{l.matched_npi || "—"}</td>
                      <td className="p-3"><TierPill kind="" tier={snap.tier_340b} /></td>
                      <td className="p-3 text-right font-semibold text-red-600">{d.imported ?? "—"}</td>
                      <td className="p-3 text-right font-semibold text-emerald-700">{d.medicare ?? Number(snap.tot_clms || 0).toLocaleString()}</td>
                      <td className="p-3 text-slate-500">{l.account_manager_name || "Unassigned"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
