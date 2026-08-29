import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { fmtDate, Btn } from "@/components/crm/kit";
import {
  Search, UserPlus, Upload, Phone, Mail, MessageSquare, CalendarPlus, Sparkles,
  Clock, CheckSquare, Users2, AlertTriangle, Lightbulb, ArrowRight, PhoneCall,
} from "lucide-react";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

function AttentionCard({ testid, icon: Icon, count, label, tone, onClick }) {
  const tones = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    slate: "border-slate-200 bg-white text-slate-700",
  };
  return (
    <button data-testid={testid} onClick={onClick} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${tones[tone]}`}>
      <Icon className="h-6 w-6 shrink-0" />
      <div>
        <p className="font-display text-2xl font-bold leading-none">{count}</p>
        <p className="mt-1 text-xs font-semibold">{label}</p>
      </div>
    </button>
  );
}

export default function CrmDashboard() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [att, setAtt] = useState(null);
  const [day, setDay] = useState(null);
  const [ins, setIns] = useState([]);

  useEffect(() => {
    api.get("/crm/home/attention").then((r) => setAtt(r.data)).catch(() => setAtt({}));
    api.get("/crm/home/my-day").then((r) => setDay(r.data)).catch(() => setDay({}));
    api.get("/crm/home/insights").then((r) => setIns(r.data.insights || [])).catch(() => setIns([]));
  }, []);

  const quick = [
    { label: "Find Physicians", icon: Search, to: "/crm/medicare", testid: "qa-find" },
    { label: "Add Lead", icon: UserPlus, to: "/crm/leads", testid: "qa-lead" },
    { label: "Medicare Search", icon: Search, to: "/crm/medicare", testid: "qa-medicare" },
    { label: "Meetings & Tasks", icon: CalendarPlus, to: "/crm/meetings", testid: "qa-meetings" },
    { label: "Opportunities", icon: ArrowRight, to: "/crm/opportunities", testid: "qa-opps" },
  ];
  const insAction = (a) => a === "medicare" ? "/crm/medicare" : a === "enrich" ? "/crm/leads" : "/crm/leads";

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-slate-900">{greeting()}, {user?.name?.split(" ")[0]}</h1>
        <p className="text-sm text-slate-500">Here's what needs your attention today.</p>
      </div>

      {/* Needs attention */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <AttentionCard testid="att-first-contact" icon={Users2} count={att?.needs_first_contact ?? "—"} label="Leads need first contact" tone="blue" onClick={() => nav("/crm/leads?status=New")} />
        <AttentionCard testid="att-overdue" icon={AlertTriangle} count={att?.overdue_tasks ?? "—"} label="Tasks overdue" tone="red" onClick={() => nav("/crm/meetings")} />
        <AttentionCard testid="att-meetings" icon={Clock} count={att?.meetings_today ?? "—"} label="Meetings today" tone="amber" onClick={() => nav("/crm/meetings")} />
        <AttentionCard testid="att-stale" icon={PhoneCall} count={att?.stale_high_value ?? "—"} label="High-value, stale 14d" tone="amber" onClick={() => nav("/crm/leads")} />
        <AttentionCard testid="att-unassigned" icon={Users2} count={att?.unassigned ?? 0} label="Unassigned leads" tone="slate" onClick={() => nav("/crm/leads")} />
      </div>

      {/* Quick actions */}
      <div className="mb-6 flex flex-wrap gap-2">
        {quick.map((q) => (
          <Btn key={q.label} data-testid={q.testid} variant="ghost" onClick={() => nav(q.to)}><q.icon className="h-4 w-4" /> {q.label}</Btn>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* My Day */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 font-display text-lg font-bold text-slate-900">My Day</h2>
          <div className="space-y-3">
            {day && day.meetings?.map((m) => (
              <Row key={m.id} testid="myday-meeting" icon={CalendarPlus} tone="violet" title={m.title} sub={`Meeting · ${fmtDate(m.start_at)}`} action="Open" onAction={() => nav("/crm/meetings")} />
            ))}
            {day && day.tasks?.map((t) => (
              <Row key={t.id} testid="myday-task" icon={CheckSquare} tone="blue" title={t.title} sub={`Task · due ${fmtDate(t.due_at)}`} action="View" onAction={() => nav("/crm/meetings")} />
            ))}
            {day && day.new_leads?.map((l) => (
              <Row key={l.id} testid="myday-lead" icon={UserPlus} tone="emerald" title={l.org_name || l.lead_number} sub={`New lead · ${l.lead_number}`} action="Open" onAction={() => nav(`/crm/leads/${l.id}`)} />
            ))}
            {day && day.followups?.map((l) => (
              <Row key={"f" + l.id} testid="myday-followup" icon={Clock} tone="amber" title={l.org_name || l.lead_number} sub="Follow-up due" action="Work" onAction={() => nav(`/crm/leads/${l.id}`)} />
            ))}
            {day && !day.meetings?.length && !day.tasks?.length && !day.new_leads?.length && !day.followups?.length && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">You're all caught up. Nice work! 🎉</div>
            )}
          </div>
        </div>

        {/* Insights */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-slate-900"><Lightbulb className="h-5 w-5 text-amber-500" /> Opportunities BoothIQ Found</h2>
          <div className="space-y-3">
            {ins.length === 0 && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">No insights right now.</div>}
            {ins.map((i) => (
              <div key={i.key} data-testid={`insight-${i.key}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-700">{i.text}</p>
                <button onClick={() => nav(insAction(i.action))} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Take action <ArrowRight className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ testid, icon: Icon, tone, title, sub, action, onAction }) {
  const tones = { violet: "bg-violet-100 text-violet-600", blue: "bg-blue-100 text-blue-600", emerald: "bg-emerald-100 text-emerald-600", amber: "bg-amber-100 text-amber-600" };
  return (
    <div data-testid={testid} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <span className={`inline-flex rounded-lg p-2 ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{title}</p><p className="truncate text-xs text-slate-400">{sub}</p></div>
      <Btn variant="ghost" onClick={onAction}>{action}</Btn>
    </div>
  );
}
