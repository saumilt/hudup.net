import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Btn, inputCls } from "@/components/crm/kit";

export default function ClientServicesPanel({ lead, onSaved }) {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Not Started");
  const [services, setServices] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.get("/crm/client-services/meta").then(r => { if (live) setMeta(r.data); })
      .catch(e => { if (live) setError(formatApiError(e.response?.data?.detail)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    setStatus(lead.client_profile?.client_status || "Not Started");
    setServices(lead.client_profile?.services || []);
  }, [lead.id, lead.client_profile]);
  const toggle = (definition, checked) => setServices(prev => checked
    ? [...prev, { service_id: definition.id, status: "Not Started", partner: "" }]
    : prev.filter(s => s.service_id !== definition.id));
  const patch = (id, values) => setServices(prev => prev.map(s => s.service_id === id ? { ...s, ...values } : s));
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/crm/leads/" + lead.id + "/client-profile", {
        client_status: status,
        services: services.map(({ service_id, status, partner }) => ({ service_id, status, partner: partner || "" })),
      });
      toast.success("Client services saved");
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  return <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="client-services-panel">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-display font-bold text-slate-900">Client onboarding & services</h2>
        <p className="text-xs text-slate-500">Track post-conversion progress for each service.</p></div>
      <Link className="text-sm font-semibold text-primary underline" to={"/crm/service-referrals?lead_id=" + lead.id}>Track referrals</Link>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!meta ? <p className="text-sm text-slate-500">Loading service options…</p> : <>
      <label className="mb-4 block text-sm font-semibold text-slate-700">Client status
        <select data-testid="client-status" className={inputCls + " mt-1"} value={status} onChange={e => setStatus(e.target.value)}>
          {meta.client_statuses.map(s => <option key={s}>{s}</option>)}
        </select>
      </label>
      <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold text-slate-700">Services · select all that apply</legend>
        {meta.services.map(definition => {
          const enrolled = services.find(s => s.service_id === definition.id);
          return <div key={definition.id} className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" checked={!!enrolled} onChange={e => toggle(definition, e.target.checked)} />{definition.name}
            </label>
            {enrolled && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-500">Service status
                <select className={inputCls + " mt-1"} value={enrolled.status} onChange={e => patch(definition.id, {
                  status: e.target.value,
                  ...(e.target.value === "Started with Caregenix for RPM" && !enrolled.partner ? { partner: "Caregenix" } : {}),
                })}>{definition.statuses.map(s => <option key={s}>{s}</option>)}</select>
              </label>
              <label className="text-xs text-slate-500">Service partner
                <input className={inputCls + " mt-1"} maxLength={160} placeholder="Partner / fulfillment provider" value={enrolled.partner || ""}
                  onChange={e => patch(definition.id, { partner: e.target.value })} />
              </label>
            </div>}
          </div>;
        })}
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-sm text-xs text-slate-500">These are manually tracked milestones. Updating a status records progress in the CRM.</p>
        <Btn onClick={save} disabled={busy} data-testid="save-client-services">{busy ? "Saving…" : "Save client services"}</Btn>
      </div>
    </>}
  </section>;
}
