import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, Field, inputCls, Modal, EmptyState } from "@/components/crm/kit";
import { Workflow, Plus, Trash2, Mail, MessageSquare, Phone, Clock, CheckSquare, Play } from "lucide-react";

const CHANNELS = [
  { v: "email", label: "Email", icon: Mail },
  { v: "sms", label: "SMS", icon: MessageSquare },
  { v: "call_task", label: "Call Task", icon: Phone },
  { v: "task", label: "Task", icon: CheckSquare },
  { v: "wait", label: "Wait", icon: Clock },
];
const chIcon = (v) => (CHANNELS.find((c) => c.v === v) || CHANNELS[0]).icon;

export default function Sequences() {
  const { user } = useAuth();
  const isManager = ["admin", "super_admin", "lead_manager"].includes(user?.role);
  const [seqs, setSeqs] = useState([]);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState([{ day: 0, channel: "email", subject: "", body: "" }]);

  const load = () => api.get("/crm/sequences").then((r) => setSeqs(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const addStep = () => setSteps([...steps, { day: (steps.at(-1)?.day || 0) + 2, channel: "email", subject: "", body: "" }]);
  const rmStep = (i) => setSteps(steps.filter((_, x) => x !== i));
  const upStep = (i, patch) => setSteps(steps.map((s, x) => (x === i ? { ...s, ...patch } : s)));

  const create = async () => {
    if (!name.trim() || !steps.length) return toast.error("Name and at least one step required");
    try {
      await api.post("/crm/sequences", { name, steps });
      toast.success("Sequence created"); setShow(false); setName("");
      setSteps([{ day: 0, channel: "email", subject: "", body: "" }]); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const runNow = async () => {
    try { await api.post("/crm/sequences/process/run"); toast.success("Processed due steps"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Sequences" subtitle="Multi-step outreach that auto-pauses when a physician replies">
        {isManager && <Btn variant="ghost" onClick={runNow} data-testid="seq-run"><Play className="h-4 w-4" /> Run due steps</Btn>}
        {isManager && <Btn onClick={() => setShow(true)} data-testid="seq-create-btn"><Plus className="h-4 w-4" /> New Sequence</Btn>}
      </PageHeader>

      <div className="p-6">
        {seqs.length === 0 ? (
          <EmptyState icon={Workflow} title="No sequences yet" hint="Build a cadence of emails, texts and call tasks. Enroll leads from the Leads page." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {seqs.map((s) => (
              <div key={s.id} data-testid="seq-card" className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-primary" />
                  <span className="font-display font-bold text-slate-900">{s.name}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{s.active ? "Active" : "Off"}</span>
                </div>
                <ol className="space-y-1.5">
                  {(s.steps || []).map((st, i) => { const Ic = chIcon(st.channel); return (
                    <li key={i} className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="w-10 shrink-0 text-xs font-semibold text-slate-400">Day {st.day}</span>
                      <Ic className="h-3.5 w-3.5 text-slate-400" />
                      <span className="truncate">{st.channel === "wait" ? "Wait" : (st.subject || st.note || st.body || st.channel)}</span>
                    </li>
                  ); })}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={show} onClose={() => setShow(false)} title="New Sequence" wide>
        <Field label="Sequence name"><input data-testid="seq-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. 340B Introduction" /></Field>
        <div className="space-y-3">
          {steps.map((st, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Step {i + 1}</span>
                <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">Day
                  <input type="number" min="0" data-testid={`seq-step-day-${i}`} value={st.day} onChange={(e) => upStep(i, { day: Number(e.target.value) })} className="w-16 rounded border border-slate-300 px-1 py-0.5" /></label>
                <select data-testid={`seq-step-channel-${i}`} value={st.channel} onChange={(e) => upStep(i, { channel: e.target.value })} className="rounded border border-slate-300 px-2 py-1 text-sm">
                  {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
                {steps.length > 1 && <button onClick={() => rmStep(i)} className="text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>}
              </div>
              {st.channel === "email" && <input placeholder="Subject" value={st.subject || ""} onChange={(e) => upStep(i, { subject: e.target.value })} className={`${inputCls} mb-1`} />}
              {(st.channel === "email" || st.channel === "sms") && <textarea placeholder="Message" rows={2} value={st.body || ""} onChange={(e) => upStep(i, { body: e.target.value })} className={inputCls} />}
              {(st.channel === "call_task" || st.channel === "task") && <input placeholder="Task note" value={st.note || ""} onChange={(e) => upStep(i, { note: e.target.value })} className={inputCls} />}
            </div>
          ))}
          <Btn variant="ghost" onClick={addStep} data-testid="seq-add-step"><Plus className="h-4 w-4" /> Add step</Btn>
        </div>
        <Btn onClick={create} data-testid="seq-save" className="mt-3 w-full justify-center">Create Sequence</Btn>
      </Modal>
    </div>
  );
}
