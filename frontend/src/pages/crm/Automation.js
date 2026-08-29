import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Btn, Modal, Field, inputCls } from "@/components/crm/kit";
import { PageHeader } from "@/components/crm/CrmShell";
import { Zap, Plus, Trash2, Power } from "lucide-react";

export default function Automation() {
  const [rules, setRules] = useState([]);
  const [meta, setMeta] = useState({ events: [], fields: [], actions: [], sequences: [] });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", event: "status_changed", cond_field: "status", cond_op: "eq", cond_value: "", action_type: "create_task", action_value: "" });

  const load = () => api.get("/crm/automation").then((r) => setRules(r.data)).catch(() => {});
  useEffect(() => { load(); api.get("/crm/automation/meta").then((r) => setMeta(r.data)).catch(() => {}); }, []);

  const create = async () => {
    if (!f.name.trim()) return toast.error("Name required");
    const body = {
      name: f.name, event: f.event,
      conditions: f.cond_value ? [{ field: f.cond_field, op: f.cond_op, value: f.cond_value }] : [],
      actions: [{ type: f.action_type, value: f.action_value }],
    };
    try { await api.post("/crm/automation", body); toast.success("Rule created"); setOpen(false); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const toggle = async (r) => { await api.patch(`/crm/automation/${r.id}`, { active: !r.active }); load(); };
  const remove = async (r) => { await api.delete(`/crm/automation/${r.id}`); load(); };

  return (
    <div>
      <PageHeader title="Automation Rules" subtitle="When something happens, do something — automatically">
        <Btn onClick={() => setOpen(true)} data-testid="rule-create-btn"><Plus className="h-4 w-4" /> New Rule</Btn>
      </PageHeader>
      <div className="space-y-3 p-6">
        {rules.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center"><Zap className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-2 font-semibold text-slate-500">No rules yet</p><p className="text-sm text-slate-400">e.g. when a lead becomes Qualified, auto-start a sequence.</p></div>}
        {rules.map((r) => (
          <div key={r.id} data-testid="rule-card" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <p className="font-display font-bold text-slate-900">{r.name}</p>
              <p className="text-sm text-slate-500"><b className="text-primary">WHEN</b> {r.event}{(r.conditions || []).map((c, i) => <span key={i}> · <b className="text-slate-600">IF</b> {c.field} {c.op} “{c.value}”</span>)} · <b className="text-emerald-600">THEN</b> {(r.actions || []).map((a) => a.type + (a.value ? `(${a.value})` : "")).join(", ")}</p>
            </div>
            <div className="flex items-center gap-2">
              <button data-testid="rule-toggle" onClick={() => toggle(r)} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold ${r.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}><Power className="h-3.5 w-3.5" /> {r.active ? "Active" : "Off"}</button>
              <button data-testid="rule-delete" onClick={() => remove(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New Automation Rule" wide>
        <Field label="Rule name"><input data-testid="rule-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field>
        <Field label="WHEN (event)"><select data-testid="rule-event" value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })} className={inputCls}>{meta.events.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="IF field"><select value={f.cond_field} onChange={(e) => setF({ ...f, cond_field: e.target.value })} className={inputCls}>{meta.fields.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
          <Field label="op"><select value={f.cond_op} onChange={(e) => setF({ ...f, cond_op: e.target.value })} className={inputCls}>{["eq", "ne", "contains", "in"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="value"><input data-testid="rule-cond-value" value={f.cond_value} onChange={(e) => setF({ ...f, cond_value: e.target.value })} className={inputCls} placeholder="e.g. Qualified" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="THEN (action)"><select data-testid="rule-action" value={f.action_type} onChange={(e) => setF({ ...f, action_type: e.target.value })} className={inputCls}>{meta.actions.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
          <Field label={f.action_type === "start_sequence" ? "Sequence" : "Value"}>
            {f.action_type === "start_sequence"
              ? <select data-testid="rule-action-value" value={f.action_value} onChange={(e) => setF({ ...f, action_value: e.target.value })} className={inputCls}><option value="">Select…</option>{meta.sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              : <input data-testid="rule-action-value" value={f.action_value} onChange={(e) => setF({ ...f, action_value: e.target.value })} className={inputCls} placeholder="task title / status / days / tag" />}
          </Field>
        </div>
        <Btn onClick={create} data-testid="rule-save" className="mt-2 w-full justify-center">Create Rule</Btn>
      </Modal>
    </div>
  );
}
