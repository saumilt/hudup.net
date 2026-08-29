import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatCard } from "@/components/crm/kit";

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);

  useEffect(() => {
    api.get("/crm/analytics/communications", { params: { days } }).then((r) => setD(r.data)).catch(() => {});
  }, [days]);

  return (
    <div>
      <PageHeader title="Communication Analytics" subtitle="Outcomes, not just volume">
        <select data-testid="analytics-range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </PageHeader>
      <div className="p-6">
        {!d ? <p className="text-slate-400">Loading…</p> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard testid="an-emails" label="Emails Sent" value={d.emails_sent} />
              <StatCard testid="an-sms" label="SMS Sent / Received" value={`${d.sms_sent} / ${d.sms_received}`} />
              <StatCard testid="an-calls" label="Calls" value={d.calls} sub={`${d.calls_connected} connected · ${d.connection_rate}%`} />
              <StatCard testid="an-meetings" label="Meetings Booked" value={d.meetings_booked} />
              <StatCard testid="an-opps" label="Opportunities" value={d.opportunities} />
              <StatCard testid="an-won" label="Won" value={d.won} />
              <StatCard label="Connection Rate" value={`${d.connection_rate}%`} />
              <StatCard label="Emails → Meetings" value={d.emails_sent ? `${Math.round(d.meetings_booked / d.emails_sent * 100)}%` : "—"} />
            </div>
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-display font-bold text-slate-900">Call Dispositions</h2>
              {Object.keys(d.dispositions || {}).length === 0 ? <p className="text-sm text-slate-400">No calls logged in this window.</p> : (
                <div className="space-y-2">
                  {Object.entries(d.dispositions).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-3">
                      <span className="w-40 text-sm text-slate-600">{k}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, v / d.calls * 100)}%` }} />
                      </div>
                      <span className="w-8 text-right text-sm font-semibold text-slate-700">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
