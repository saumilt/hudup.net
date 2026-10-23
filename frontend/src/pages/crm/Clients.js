import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, inputCls, fmtDate, StatusBadge } from "@/components/crm/kit";
import { toast } from "sonner";

export default function Clients() {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState({ q: "", client_status: "", service_id: "" });
  const [newService, setNewService] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadMeta = () => api.get("/crm/client-services/meta").then(r => setMeta(r.data));
  useEffect(() => { loadMeta().catch(e => setError(formatApiError(e.response?.data?.detail))); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get("/crm/client-services/clients", { params: { ...filters, limit: 500 } })
        .then(r => { if (active) { setClients(r.data); setError(""); } })
        .catch(e => { if (active) setError(formatApiError(e.response?.data?.detail)); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [filters]);
  const addService = async e => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post("/crm/client-services/catalog", { name: newService });
      await loadMeta(); setNewService(""); toast.success("Service is available on client records");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  return <div>
    <PageHeader title="Clients & Services" subtitle="Onboarding, DTCM progress and service activation across your provider relationships.">
      <Link to="/crm/service-referrals" className="text-sm font-semibold text-primary underline">Referral tracking</Link>
      <Link to="/crm/leads" className="text-sm font-semibold text-primary underline">Add from leads</Link>
    </PageHeader>
    <div className="space-y-5 p-6">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3">
        <label className="text-xs text-slate-500">Search clients<input className={inputCls + " mt-1"} value={filters.q} placeholder="Practice, provider or email"
          onChange={e => setFilters({ ...filters, q: e.target.value })} /></label>
        <label className="text-xs text-slate-500">Client status<select className={inputCls + " mt-1"} value={filters.client_status}
          onChange={e => setFilters({ ...filters, client_status: e.target.value })}>
          <option value="">All statuses</option>{meta?.client_statuses.map(s => <option key={s}>{s}</option>)}
        </select></label>
        <label className="text-xs text-slate-500">Service<select className={inputCls + " mt-1"} value={filters.service_id}
          onChange={e => setFilters({ ...filters, service_id: e.target.value })}>
          <option value="">All services</option>{meta?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm"><caption className="px-4 py-3 text-left text-xs text-slate-500">
          {loading ? "Loading…" : clients.length + " client records shown (up to 500). Use filters to narrow results."}
        </caption><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
          {["Client", "Sales stage", "Client status", "Services & activity", "Updated"].map(h => <th key={h} className="px-4 py-3">{h}</th>)}
        </tr></thead><tbody className="divide-y divide-slate-100">{!loading && clients.map(client => <tr key={client.id}>
          <td className="px-4 py-4"><Link className="font-semibold text-primary underline" to={"/crm/leads/" + client.id}>
            {client.org_name || [client.contact_first, client.contact_last].filter(Boolean).join(" ") || client.lead_number}
          </Link><p className="text-xs text-slate-500">{client.email}</p>{client.source === "Website" && <span className="text-xs text-emerald-700">Website inquiry</span>}</td>
          <td className="px-4 py-4"><StatusBadge status={client.status} /></td>
          <td className="px-4 py-4">{client.client_profile.client_status}</td>
          <td className="space-y-2 px-4 py-4">{client.client_profile.services?.map(s => <div key={s.service_id}>
            <p className="font-semibold">{s.name}</p><p className="text-xs text-slate-500">{s.status}{s.partner ? " · " + s.partner : ""}</p>
          </div>)}</td>
          <td className="px-4 py-4 text-xs text-slate-500">{fmtDate(client.client_profile.updated_at)}</td>
        </tr>)}</tbody></table>
        {!loading && !clients.length && <div className="p-10 text-center text-sm text-slate-500">No matching clients. Open a lead and save its onboarding & services profile to begin.</div>}
      </div>
      {["admin", "super_admin"].includes(user?.role) && <form onSubmit={addService} className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Add a service</h2>
        <p className="mb-3 text-sm text-slate-500">Add another service to the catalog used across client records.</p>
        <div className="flex flex-wrap gap-2"><label className="flex-1"><span className="sr-only">Service name</span>
          <input className={inputCls} required minLength={2} maxLength={80} value={newService} onChange={e => setNewService(e.target.value)} placeholder="Service name" />
        </label><Btn type="submit" disabled={busy}>{busy ? "Adding…" : "Add service"}</Btn></div>
      </form>}
    </div>
  </div>;
}
