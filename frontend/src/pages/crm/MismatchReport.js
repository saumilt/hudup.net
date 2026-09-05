import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { EmptyState, TierPill, Btn, Modal } from "@/components/crm/kit";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export default function MismatchReport() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/crm/leads", { params: { claim_mismatch: true, limit: 1000 } })
      .then((r) => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const acceptAll = async () => {
    setBusy(true);
    try {
      const r = await api.post("/crm/leads/claim-mismatch/resolve", {});
      toast.success(`Accepted Medicare's number on ${r.data.resolved} lead(s)`);
      setConfirmAll(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setBusy(false); }
  };
  const acceptOne = async (id) => {
    try {
      await api.post("/crm/leads/claim-mismatch/resolve", { lead_ids: [id] });
      toast.success("Accepted Medicare's number"); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Claim Mismatch Report" subtitle={`${rows.length} lead(s) where imported claims disagreed with Medicare`}>
        {rows.length > 0 && (
          <Btn onClick={() => setConfirmAll(true)} data-testid="accept-all-btn"><CheckCircle2 className="h-4 w-4" /> Accept Medicare's numbers ({rows.length})</Btn>
        )}
      </PageHeader>
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
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const d = l.claim_mismatch_detail || {};
                  const snap = l.medicare_snapshot || {};
                  return (
                    <tr key={l.id} data-testid={`mismatch-row-${l.id}`} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="cursor-pointer p-3 font-mono text-xs text-slate-500" onClick={() => nav(`/crm/leads/${l.id}`)}>{l.lead_number}</td>
                      <td className="cursor-pointer p-3 font-semibold text-slate-800" onClick={() => nav(`/crm/leads/${l.id}`)}>{l.org_name || `${l.contact_first || ""} ${l.contact_last || ""}`.trim() || "—"}</td>
                      <td className="p-3 font-mono text-xs text-slate-500">{l.matched_npi || "—"}</td>
                      <td className="p-3"><TierPill kind="" tier={snap.tier_340b} /></td>
                      <td className="p-3 text-right font-semibold text-red-600">{d.imported ?? "—"}</td>
                      <td className="p-3 text-right font-semibold text-emerald-700">{d.medicare ?? Number(snap.tot_clms || 0).toLocaleString()}</td>
                      <td className="p-3 text-slate-500">{l.account_manager_name || "Unassigned"}</td>
                      <td className="p-3 text-right"><Btn variant="ghost" onClick={() => acceptOne(l.id)} data-testid={`accept-one-${l.id}`}>Accept</Btn></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={confirmAll} onClose={() => setConfirmAll(false)} title="Accept Medicare's numbers">
        <p className="text-sm text-slate-600" data-testid="accept-all-text">
          Accept Medicare's claim count on all <b>{rows.length}</b> flagged lead{rows.length === 1 ? "" : "s"}? Their notes already show the Medicare value; this clears the mismatch flag.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setConfirmAll(false)}>Cancel</Btn>
          <Btn onClick={acceptAll} disabled={busy} data-testid="accept-all-confirm">{busy ? "Accepting…" : "Accept all"}</Btn>
        </div>
      </Modal>
    </div>
  );
}
