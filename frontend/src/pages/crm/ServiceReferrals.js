import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, inputCls, fmtDate, Modal } from "@/components/crm/kit";
import { toast } from "sonner";

export default function ServiceReferrals() {
  const [params] = useSearchParams();
  const leadId = params.get("lead_id") || "";
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [client, setClient] = useState(null);
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState({ service_id: "", status: "" });
  const [form, setForm] = useState({ lead_id: leadId, service_id: "", destination: "", reference: "", status: "Submitted" });
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get("/crm/client-services/meta").then(r => setMeta(r.data)).catch(e => setError(formatApiError(e.response?.data?.detail)));
    api.get("/crm/client-services/clients", { params: { limit: 500 } }).then(r => setClients(r.data)).catch(e => setError(formatApiError(e.response?.data?.detail)));
  }, []);
  useEffect(() => {
    setForm(prev => ({ ...prev, lead_id: leadId }));
    setClient(null);
    if (leadId) api.get("/crm/leads/" + leadId).then(r => setClient(r.data)).catch(e => setError(formatApiError(e.response?.data?.detail)));
  }, [leadId]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const r = await api.get("/crm/service-referrals", { params: { ...filters, lead_id: leadId, limit: 500 } }); setRows(r.data); }
    catch (e) { setError(formatApiError(e.response?.data?.detail)); }
    finally { setLoading(false); }
  }, [filters, leadId]);
  useEffect(() => { load(); }, [load]);
  const create = async e => {
    e.preventDefault(); setBusy(true);
    try {
      const { lead_id, ...payload } = form;
      await api.post("/crm/leads/" + lead_id + "/service-referrals", payload);
      setOpen(false); setForm({ lead_id: leadId, service_id: "", destination: "", reference: "", status: "Submitted" });
      toast.success("Referral recorded"); await load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const changeStatus = async (id, status) => {
    setBusy(true);
    try { await api.patch("/crm/service-referrals/" + id, { status }); toast.success("Referral status updated"); await load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const options = client && !clients.some(c => c.id === client.id) ? [client, ...clients] : clients;
  const name = c => c.org_name || [c.contact_first, c.contact_last].filter(Boolean).join(" ") || c.lead_number;
  return <div>
    <PageHeader title="Referral Tracking" subtitle="Track 340B, RPM and infusion referrals from submission through completion.">
      {leadId ? <Link className="text-sm font-semibold text-primary underline" to={"/crm/leads/" + leadId}>Back to client</Link>
        : <Link className="text-sm font-semibold text-primary underline" to="/crm/clients">Clients & services</Link>}
      <Btn onClick={() => setOpen(true)} disabled={!meta}>Record referral</Btn>
    </PageHeader>
    <div className="space-y-4 p-6">
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Record operational progress using an internal reference. Keep patient names, dates of birth, prescriptions and clinical documents in your approved clinical system.
      </p>
      {leadId && <div className="flex flex-wrap justify-between text-sm"><span>Client: {client ? name(client) : "Loading…"}</span><Link className="text-primary underline" to="/crm/service-referrals">Show all visible referrals</Link></div>}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="text-xs text-slate-500">Service<select className={inputCls + " mt-1"} value={filters.service_id} onChange={e => setFilters({ ...filters, service_id: e.target.value })}>
          <option value="">All services</option>{meta?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label className="text-xs text-slate-500">Referral status<select className={inputCls + " mt-1"} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>{meta?.referral_statuses.map(s => <option key={s}>{s}</option>)}
        </select></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm"><caption className="px-4 py-3 text-left text-xs text-slate-500">{loading ? "Loading…" : rows.length + " referrals shown (up to 500)."}</caption>
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Client / reference", "Service", "Destination", "Status", "Updated", "History"].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{!loading && rows.map(r => <tr key={r.id}>
            <td className="px-4 py-4"><Link className="font-semibold text-primary underline" to={"/crm/leads/" + r.lead_id}>{r.client_name}</Link><p className="font-mono text-xs text-slate-500">{r.reference}</p></td>
            <td className="px-4 py-4">{r.service_name}</td><td className="px-4 py-4">{r.destination}</td>
            <td className="px-4 py-4"><select aria-label={"Referral status for " + r.reference} className={inputCls} disabled={busy} value={r.status} onChange={e => changeStatus(r.id, e.target.value)}>
              {meta?.referral_statuses.map(s => <option key={s}>{s}</option>)}</select></td>
            <td className="px-4 py-4 text-xs text-slate-500">{fmtDate(r.updated_at)}</td><td className="px-4 py-4"><button className="text-primary underline" onClick={() => setHistory(r)}>View</button></td>
          </tr>)}</tbody>
        </table>
        {!loading && !rows.length && <p className="p-10 text-center text-sm text-slate-500">No referrals match these filters. Record a referral to begin tracking.</p>}
      </div>
    </div>
    <Modal open={open} onClose={() => setOpen(false)} title="Record referral">
      <form onSubmit={create} className="space-y-4">
        <p className="text-xs text-slate-500">This records CRM activity. Send clinical referrals through your existing care system.</p>
        <label className="block text-sm font-semibold">Client<select required className={inputCls + " mt-1"} value={form.lead_id} onChange={e => setForm({ ...form, lead_id: e.target.value })}>
          <option value="">Select client</option>{options.map(c => <option key={c.id} value={c.id}>{name(c)}</option>)}
        </select></label>
        <label className="block text-sm font-semibold">Service<select required className={inputCls + " mt-1"} value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })}>
          <option value="">Select service</option>{meta?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label className="block text-sm font-semibold">Receiving provider / partner<input required minLength={2} maxLength={160} className={inputCls + " mt-1"} value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="Provider or partner organization" /></label>
        <label className="block text-sm font-semibold">Internal reference<input required maxLength={100} className={inputCls + " mt-1"} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="e.g. REF-2026-1042 · no patient information" /></label>
        <label className="block text-sm font-semibold">Status<select className={inputCls + " mt-1"} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
          {meta?.referral_statuses.map(s => <option key={s}>{s}</option>)}
        </select></label><Btn type="submit" disabled={busy}>{busy ? "Saving…" : "Record referral"}</Btn>
      </form>
    </Modal>
    <Modal open={!!history} onClose={() => setHistory(null)} title="Referral status history">
      <ol className="space-y-3">{history?.history.map((h, i) => <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
        <p>{h.from ? h.from + " → " : ""}{h.to}</p><p className="text-xs text-slate-500">{fmtDate(h.at)}</p>
      </li>)}</ol>
    </Modal>
  </div>;
}
