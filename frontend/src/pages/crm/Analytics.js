import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatCard } from "@/components/crm/kit";
import { Stethoscope } from "lucide-react";

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [perf, setPerf] = useState(null);

  useEffect(() => {
    api.get("/crm/analytics/communications", { params: { days } }).then((r) => setD(r.data)).catch(() => {});
  }, [days]);

  useEffect(() => {
    api.get("/crm/referral-performance").then((r) => setPerf(r.data)).catch(() => {});
  }, []);

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

            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5" data-testid="an-referral-performance">
              <h2 className="mb-1 flex items-center gap-2 font-display font-bold text-slate-900"><Stethoscope className="h-4 w-4 text-primary" /> Referral Performance</h2>
              <p className="mb-3 text-xs text-slate-400">Which referral sources actually produce — and convert — business.</p>
              {!perf || perf.rows.length === 0 ? (
                <p className="text-sm text-slate-400">No referral sources with leads yet. Save a source in Referral Search and add leads from it.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Leads</th><th className="py-2 pr-3">Opps</th><th className="py-2 pr-3">Won/Acct</th><th className="py-2 pr-3">Conversion</th></tr>
                    </thead>
                    <tbody>
                      {perf.rows.slice(0, 15).map((r) => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="py-2 pr-3 font-semibold text-slate-800">{r.name}</td>
                          <td className="py-2 pr-3 text-slate-500">{r.source_type === "doctor" ? "Doctor" : (r.profession || "Other")}</td>
                          <td className="py-2 pr-3 font-bold text-slate-800">{r.leads}</td>
                          <td className="py-2 pr-3 text-slate-600">{r.opportunities}</td>
                          <td className="py-2 pr-3 text-slate-600">{r.won}{r.accounts ? ` · ${r.accounts}` : ""}</td>
                          <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.conversion_rate >= 25 ? "bg-emerald-100 text-emerald-700" : r.conversion_rate > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>{r.conversion_rate}%</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
