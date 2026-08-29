import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/crm/CrmShell";
import { fmtDate, StatusBadge } from "@/components/crm/kit";
import { Inbox, Mail, MessageSquare, Phone, ArrowDownLeft, ArrowUpRight } from "lucide-react";

const TABS = [
  { v: "all", label: "All", icon: Inbox },
  { v: "email", label: "Email", icon: Mail },
  { v: "sms", label: "SMS", icon: MessageSquare },
  { v: "calls", label: "Calls", icon: Phone },
];
const chIcon = { email: Mail, sms: MessageSquare, call: Phone };

export default function Communications() {
  const nav = useNavigate();
  const [tab, setTab] = useState("all");
  const [scope, setScope] = useState("all");
  const [data, setData] = useState({ items: [], counts: {} });

  useEffect(() => {
    api.get("/crm/communications", { params: { channel: tab, scope } })
      .then((r) => setData(r.data)).catch(() => {});
  }, [tab, scope]);

  return (
    <div>
      <PageHeader title="Communications" subtitle="Every email, text and call in one inbox" />
      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {TABS.map((t) => {
            const Ic = t.icon; const active = tab === t.v;
            const n = t.v === "all" ? null : data.counts[t.v];
            return (
              <button key={t.v} data-testid={`comm-tab-${t.v}`} onClick={() => setTab(t.v)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${active ? "bg-primary text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                <Ic className="h-4 w-4" /> {t.label}{n != null && ` (${n})`}
              </button>
            );
          })}
          <label className="ml-auto flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" data-testid="comm-needs-response" checked={scope === "needs_response"} onChange={(e) => setScope(e.target.checked ? "needs_response" : "all")} className="h-4 w-4 accent-primary" />
            Needs response {data.counts.needs_response ? `(${data.counts.needs_response})` : ""}
          </label>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {data.items.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No messages.</p>
          ) : data.items.map((i, idx) => {
            const Ic = chIcon[i.channel] || Mail;
            return (
              <button key={idx} data-testid="comm-row" onClick={() => i.lead_id && nav(`/crm/leads/${i.lead_id}`)}
                className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50">
                <span className={`rounded-lg p-2 ${i.channel === "email" ? "bg-blue-100 text-blue-600" : i.channel === "sms" ? "bg-emerald-100 text-emerald-600" : "bg-violet-100 text-violet-600"}`}><Ic className="h-4 w-4" /></span>
                {i.direction === "inbound" ? <ArrowDownLeft className="h-4 w-4 text-emerald-500" /> : <ArrowUpRight className="h-4 w-4 text-slate-300" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{i.contact}</span>
                    {i.lead_status && <StatusBadge status={i.lead_status} />}
                  </div>
                  <p className="truncate text-sm text-slate-500">{i.preview}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{fmtDate(i.at)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
