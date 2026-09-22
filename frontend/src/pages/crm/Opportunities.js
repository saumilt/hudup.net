import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/crm/CrmShell";
import { money, TierPill, Btn, Field, inputCls, Modal } from "@/components/crm/kit";
import { Target, Pencil, Archive } from "lucide-react";

const STAGES = ["Discovery", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

export default function Opportunities() {
  const { user } = useAuth();
  const isAdmin = ["admin", "super_admin"].includes(user?.role);
  const [opps, setOpps] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState(null); // opp being edited
  const load = useCallback(async () => {
    const r = await api.get("/crm/opportunities", { params: showArchived ? { archived: true } : {} });
    setOpps(r.data);
  }, [showArchived]);
  useEffect(() => { load(); }, [load]);

  const move = async (opp, stage) => {
    await api.patch(`/crm/opportunities/${opp.id}`, { stage });
    toast.success(`${opp.opp_number} → ${stage}`); load();
  };
  const saveEdit = async () => {
    try {
      await api.patch(`/crm/opportunities/${edit.id}`, {
        name: edit.name, value: edit.value === "" ? null : Number(edit.value),
        stage: edit.stage, close_date: edit.close_date || null,
      });
      toast.success("Opportunity updated"); setEdit(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const archive = async (opp) => {
    if (!window.confirm(showArchived ? "Unarchive this opportunity?" : `Archive ${opp.opp_number}?`)) return;
    try { await api.post(`/crm/opportunities/${opp.id}/archive`, { archived: !showArchived }); toast.success(showArchived ? "Unarchived" : "Archived"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const totalOpen = opps.filter((o) => o.status === "open").reduce((s, o) => s + (o.value || 0), 0);

  return (
    <div>
      <PageHeader title="Opportunities" subtitle={`${opps.length} total · ${money(totalOpen)} open pipeline`}>
        {isAdmin && <Btn variant="ghost" onClick={() => setShowArchived((s) => !s)} data-testid="opp-toggle-archived"><Archive className="h-4 w-4" /> {showArchived ? "Show active" : "Show archived"}</Btn>}
      </PageHeader>
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
                      {isAdmin && (
                        <div className="mt-2 flex gap-1">
                          <Btn variant="ghost" onClick={() => setEdit({ id: o.id, name: o.name, value: o.value ?? "", stage: o.stage, close_date: o.close_date || "" })} data-testid={`opp-edit-${o.id}`} className="flex-1 justify-center py-1 text-xs"><Pencil className="h-3.5 w-3.5" /> Edit</Btn>
                          <Btn variant="ghost" onClick={() => archive(o)} data-testid={`opp-archive-${o.id}`} className="py-1 text-xs"><Archive className="h-3.5 w-3.5" /></Btn>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {opps.length === 0 && <div className="px-6"><div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center"><Target className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="font-semibold text-slate-600">{showArchived ? "No archived opportunities" : "No opportunities yet"}</p><p className="mt-1 text-sm text-slate-400">Convert a qualified lead to create one.</p></div></div>}

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit Opportunity">
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><input data-testid="opp-edit-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Value ($)"><input data-testid="opp-edit-value" type="number" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} className={inputCls} /></Field>
            <Field label="Stage"><select data-testid="opp-edit-stage" value={edit.stage} onChange={(e) => setEdit({ ...edit, stage: e.target.value })} className={inputCls}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Expected close date"><input data-testid="opp-edit-close" type="date" value={edit.close_date ? String(edit.close_date).slice(0, 10) : ""} onChange={(e) => setEdit({ ...edit, close_date: e.target.value })} className={inputCls} /></Field>
            <Btn onClick={saveEdit} data-testid="opp-edit-save" className="w-full justify-center">Save Changes</Btn>
          </div>
        )}
      </Modal>
    </div>
  );
}
