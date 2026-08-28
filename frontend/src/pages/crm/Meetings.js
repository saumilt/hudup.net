import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError, API } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, Field, inputCls, EmptyState, Modal, fmtDate } from "@/components/crm/kit";
import { CalendarClock, Plus, CheckSquare, Download, X, Check, RefreshCw } from "lucide-react";

function MeetingsTab() {
  const [meetings, setMeetings] = useState([]);
  const [show, setShow] = useState(false);
  const [m, setM] = useState({ title: "", start_at: "", end_at: "", type: "Video Call", location: "", agenda: "", ext_name: "", ext_email: "", ext_mobile: "" });
  const load = useCallback(async () => { const r = await api.get("/crm/meetings", { params: { upcoming: false } }); setMeetings(r.data); }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      await api.post("/crm/meetings", {
        title: m.title, start_at: new Date(m.start_at).toISOString(), end_at: m.end_at ? new Date(m.end_at).toISOString() : null,
        type: m.type, location: m.location, agenda: m.agenda,
        external_attendee: { name: m.ext_name, email: m.ext_email, mobile: m.ext_mobile },
      });
      toast.success("Meeting scheduled"); setShow(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const cancel = async (id) => { await api.post(`/crm/meetings/${id}/cancel`); toast.success("Cancelled"); load(); };
  const complete = async (id) => { const outcome = window.prompt("Outcome?") || ""; await api.post(`/crm/meetings/${id}/complete`, { outcome }); toast.success("Completed"); load(); };
  const reschedule = async (id) => { const s = window.prompt("New start (YYYY-MM-DDTHH:MM)"); if (!s) return; await api.post(`/crm/meetings/${id}/reschedule`, { start_at: new Date(s).toISOString() }); toast.success("Rescheduled"); load(); };
  const ics = (id) => { const a = document.createElement("a"); a.href = `${API}/crm/meetings/${id}/ics`; a.click(); };

  return (
    <>
      <div className="mb-3 flex justify-end"><Btn onClick={() => setShow(true)} data-testid="mt-new-meeting"><Plus className="h-4 w-4" /> Schedule Meeting</Btn></div>
      <div className="space-y-2">
        {meetings.length === 0 && <EmptyState icon={CalendarClock} title="No meetings" hint="Schedule one with a prospect." />}
        {meetings.map((mt) => (
          <div key={mt.id} data-testid={`meeting-${mt.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-400">{mt.meeting_number}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${mt.status === "Cancelled" ? "bg-red-100 text-red-700" : mt.status === "Completed" ? "bg-green-100 text-green-700" : "bg-violet-100 text-violet-700"}`}>{mt.status}</span></div>
              <p className="font-semibold text-slate-800">{mt.title}</p>
              <p className="text-sm text-slate-500">{fmtDate(mt.start_at)} · {mt.type}{mt.external_attendee?.name ? ` · ${mt.external_attendee.name}` : ""}</p>
            </div>
            <div className="flex gap-1">
              <button title="ICS" onClick={() => ics(mt.id)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><Download className="h-4 w-4" /></button>
              <button title="Reschedule" onClick={() => reschedule(mt.id)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /></button>
              <button title="Complete" onClick={() => complete(mt.id)} className="rounded-lg border border-slate-200 p-2 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
              <button title="Cancel" onClick={() => cancel(mt.id)} className="rounded-lg border border-slate-200 p-2 text-red-500 hover:bg-red-50"><X className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={show} onClose={() => setShow(false)} title="Schedule Meeting" wide>
        <Field label="Title"><input data-testid="mt-title" value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><input data-testid="mt-start" type="datetime-local" value={m.start_at} onChange={(e) => setM({ ...m, start_at: e.target.value })} className={inputCls} /></Field>
          <Field label="End"><input type="datetime-local" value={m.end_at} onChange={(e) => setM({ ...m, end_at: e.target.value })} className={inputCls} /></Field>
          <Field label="Type"><select value={m.type} onChange={(e) => setM({ ...m, type: e.target.value })} className={inputCls}><option>Video Call</option><option>In Person</option><option>Phone Call</option></select></Field>
          <Field label="Location / link"><input value={m.location} onChange={(e) => setM({ ...m, location: e.target.value })} className={inputCls} /></Field>
          <Field label="Attendee name"><input value={m.ext_name} onChange={(e) => setM({ ...m, ext_name: e.target.value })} className={inputCls} /></Field>
          <Field label="Attendee email"><input value={m.ext_email} onChange={(e) => setM({ ...m, ext_email: e.target.value })} className={inputCls} /></Field>
          <Field label="Attendee mobile"><input value={m.ext_mobile} onChange={(e) => setM({ ...m, ext_mobile: e.target.value })} className={inputCls} /></Field>
        </div>
        <Field label="Agenda"><textarea value={m.agenda} onChange={(e) => setM({ ...m, agenda: e.target.value })} className={inputCls} rows={2} /></Field>
        <p className="mb-2 text-xs text-slate-400">SMS reminder sends via Twilio. Email invite & Google Calendar activate once their keys are configured.</p>
        <Btn onClick={create} data-testid="mt-save" className="w-full justify-center">Schedule</Btn>
      </Modal>
    </>
  );
}

function Tasks() {
  const [scope, setScope] = useState("my");
  const [tasks, setTasks] = useState([]);
  const [show, setShow] = useState(false);
  const [t, setT] = useState({ title: "", due_at: "", priority: "Medium" });
  const load = useCallback(async () => { const r = await api.get("/crm/tasks", { params: { scope } }); setTasks(r.data); }, [scope]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    await api.post("/crm/tasks", { title: t.title, due_at: t.due_at ? new Date(t.due_at).toISOString() : null, priority: t.priority });
    toast.success("Task created"); setShow(false); setT({ title: "", due_at: "", priority: "Medium" }); load();
  };
  const done = async (id) => { await api.patch(`/crm/tasks/${id}`, { status: "Completed" }); toast.success("Completed"); load(); };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1">
          {["my", "team", "overdue", "upcoming"].map((s) => (
            <button key={s} data-testid={`task-scope-${s}`} onClick={() => setScope(s)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${scope === s ? "bg-primary text-white" : "border border-slate-200 text-slate-600"}`}>{s}</button>
          ))}
        </div>
        <Btn onClick={() => setShow(true)} data-testid="task-new"><Plus className="h-4 w-4" /> New Task</Btn>
      </div>
      <div className="space-y-2">
        {tasks.length === 0 && <EmptyState icon={CheckSquare} title="No tasks" hint="Nothing in this view." />}
        {tasks.map((tk) => (
          <div key={tk.id} data-testid={`task-${tk.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <p className={`font-semibold ${tk.status === "Completed" ? "text-slate-400 line-through" : "text-slate-800"}`}>{tk.title}</p>
              <p className="text-xs text-slate-400">{tk.priority} · due {fmtDate(tk.due_at)}</p>
            </div>
            {tk.status !== "Completed" && <button onClick={() => done(tk.id)} data-testid={`task-done-${tk.id}`} className="rounded-lg border border-slate-200 p-2 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>}
          </div>
        ))}
      </div>
      <Modal open={show} onClose={() => setShow(false)} title="New Task">
        <Field label="Title"><input data-testid="task-title" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} className={inputCls} /></Field>
        <Field label="Due"><input type="datetime-local" value={t.due_at} onChange={(e) => setT({ ...t, due_at: e.target.value })} className={inputCls} /></Field>
        <Field label="Priority"><select value={t.priority} onChange={(e) => setT({ ...t, priority: e.target.value })} className={inputCls}><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></Field>
        <Btn onClick={create} data-testid="task-save" className="w-full justify-center">Create Task</Btn>
      </Modal>
    </>
  );
}

export default function Meetings() {
  const [tab, setTab] = useState("meetings");
  return (
    <div>
      <PageHeader title="Meetings & Tasks">
        <div className="flex gap-1">
          <button data-testid="tab-meetings" onClick={() => setTab("meetings")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "meetings" ? "bg-primary text-white" : "border border-slate-200 text-slate-600"}`}>Meetings</button>
          <button data-testid="tab-tasks" onClick={() => setTab("tasks")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "tasks" ? "bg-primary text-white" : "border border-slate-200 text-slate-600"}`}>Tasks</button>
        </div>
      </PageHeader>
      <div className="p-6">{tab === "meetings" ? <MeetingsTab /> : <Tasks />}</div>
    </div>
  );
}
