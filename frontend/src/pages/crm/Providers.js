import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { Sparkles, Mail, MessageSquare, Phone, Inbox } from "lucide-react";

const ICON = { enrichment: Sparkles, professional_profile: Sparkles, email: Mail, mailbox_oauth: Inbox, messaging: MessageSquare, voice: Phone };

export default function Providers() {
  const [rows, setRows] = useState(null);
  const load = () => api.get("/admin/providers").then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const toggle = async (slot, enabled) => {
    await api.put(`/admin/providers/${slot}`, { enabled });
    toast.success("Provider updated"); load();
  };
  const setAuto = async (slot, auto) => { await api.put(`/admin/providers/${slot}`, { auto }); load(); };

  return (
    <div>
      <PageHeader title="Enrichment & Communication Providers" subtitle="Vendor slots — credentials live server-side in environment config." />
      <div className="grid gap-4 p-6 md:grid-cols-2">
        {(rows || []).map((p) => {
          const Icon = ICON[p.slot] || Sparkles;
          return (
            <div key={p.slot} data-testid={`provider-${p.slot}`} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-3">
                <span className="inline-flex rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-bold text-slate-900">{p.label}</p>
                  <p className="text-xs text-slate-500">{p.vendor}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.configured ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{p.configured ? "CONFIGURED" : "NO KEY"}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-slate-600">
                  <input data-testid={`provider-${p.slot}-enabled`} type="checkbox" checked={!!p.enabled} onChange={(e) => toggle(p.slot, e.target.checked)} className="h-4 w-4 accent-primary" /> Enabled
                </label>
                {p.kind === "manual_or_auto" && (
                  <label className="flex items-center gap-2 text-slate-600">
                    <input type="checkbox" checked={!!p.auto} onChange={(e) => setAuto(p.slot, e.target.checked)} className="h-4 w-4 accent-primary" /> Auto-run
                  </label>
                )}
                {p.usage_count != null && <span className="text-xs text-slate-400">Usage: {p.usage_count} {p.usage_month ? `(${p.usage_month})` : ""}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
