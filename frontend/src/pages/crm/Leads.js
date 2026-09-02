import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatusBadge, PriorityTag, TierPill, Btn, Field, inputCls, EmptyState, Modal, fmtDate } from "@/components/crm/kit";
import { Users2, Plus, UserCheck, Sparkles } from "lucide-react";

export default function Leads() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isManager = ["admin", "super_admin", "lead_manager"].includes(user?.role);
  const [meta, setMeta] = useState({ statuses: [], sources: [], priorities: [] });
  const [leads, setLeads] = useState([]);
  const [filters, setFilters] = useState({ status: "", priority: "", match: "", q: "", mine: false });
  const [sel, setSel] = useState({});
  const [ams, setAms] = useState([]);
  const [assignTo, setAssignTo] = useState("");
  const [enrollSeq, setEnrollSeq] = useState("");
  const [seqs, setSeqs] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [nl, setNl] = useState({ org_name: "", contact_first: "", contact_last: "", phone: "", email: "", source: "Manual Entry", priority: "Medium", collected_year: "" });

  useEffect(() => {
    api.get("/crm/meta").then((r) => setMeta(r.data)).catch(() => {});
    api.get("/users", { params: { role: "account_manager" } }).then((r) => setAms(r.data)).catch(() => {});
    api.get("/crm/sequences").then((r) => setSeqs(r.data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "" && v !== false));
    const r = await api.get("/crm/leads", { params });
    setLeads(r.data);
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const bulkAssign = async () => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length || !assignTo) return toast.error("Select leads and an Account Manager");
    await api.post("/crm/leads/bulk-assign", { lead_ids: ids, account_manager_id: assignTo });
    toast.success(`Assigned ${ids.length} lead(s)`);
    setSel({}); load();
  };
  const bulkEnrich = async () => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length) return toast.error("Select leads to enrich");
    try {
      const r = await api.post("/crm/enrichment/bulk", { lead_ids: ids });
      setSel({});
      toast.success(`Enriching ${r.data.total} lead(s) in the background…`);
      const jobId = r.data.job_id;
      const poll = setInterval(async () => {
        try {
          const s = await api.get(`/crm/enrichment/${jobId}`);
          const d = s.data;
          if (d.status !== "running") {
            clearInterval(poll);
            const c = d.counts || {};
            if (d.status === "stopped_credit_limit") toast.error("Enrichment stopped — PeopleDataLabs credit limit reached");
            else toast.success(`Enrichment done — ${c.enriched || 0} enriched, ${c.no_match || 0} no match`);
            load();
          }
        } catch { clearInterval(poll); }
      }, 3000);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const bulkEnroll = async () => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length || !enrollSeq) return toast.error("Select leads and a sequence");
    try {
      const r = await api.post(`/crm/sequences/${enrollSeq}/enroll`, { lead_ids: ids });
      toast.success(`Enrolled ${r.data.enrolled} lead(s)`);
      setSel({}); setEnrollSeq("");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const create = async () => {
    try {
      const r = await api.post("/crm/leads", { ...nl, collected_year: nl.collected_year ? Number(nl.collected_year) : null });
      toast.success(`Lead ${r.data.lead_number} created`);
      setShowCreate(false); setNl({ org_name: "", contact_first: "", contact_last: "", phone: "", email: "", source: "Manual Entry", priority: "Medium", collected_year: "" });
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const addSource = async () => {
    const name = window.prompt("New lead source name:");
    if (!name || !name.trim()) return;
    try {
      const rs = await api.post("/crm/lead-sources", { name: name.trim() });
      setMeta((m) => ({ ...m, sources: rs.data.sources })); setNl((v) => ({ ...v, source: name.trim() }));
      toast.success("Source added");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Leads" subtitle={`${leads.length} shown`}>
        <Btn onClick={() => setShowCreate(true)} data-testid="lead-create-btn"><Plus className="h-4 w-4" /> New Lead</Btn>
      </PageHeader>

      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input data-testid="lead-search" placeholder="Search name, org, #, NPI…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select data-testid="lead-filter-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">Status: all</option>{meta.statuses.map((s) => <option key={s}>{s}</option>)}</select>
          <select data-testid="lead-filter-priority" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">Priority: all</option>{meta.priorities.map((s) => <option key={s}>{s}</option>)}</select>
          <select data-testid="lead-filter-match" value={filters.match} onChange={(e) => setFilters({ ...filters, match: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">Match: all</option><option value="matched">Matched</option><option value="unmatched">Unmatched</option></select>
          {!isManager && <label className="flex items-center gap-1 text-sm text-slate-600"><input type="checkbox" checked={filters.mine} onChange={(e) => setFilters({ ...filters, mine: e.target.checked })} /> Mine</label>}
        </div>

        {isManager && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-white p-2 text-sm">
            <UserCheck className="h-4 w-4 text-slate-400" />
            <select data-testid="bulk-assign-am" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Assign selected to…</option>
              {ams.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <Btn variant="ghost" onClick={bulkAssign} data-testid="bulk-assign-btn">Assign</Btn>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <Btn variant="dark" onClick={bulkEnrich} data-testid="bulk-enrich-btn"><Sparkles className="h-4 w-4" /> Bulk Enrich</Btn>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <select data-testid="bulk-seq" value={enrollSeq} onChange={(e) => setEnrollSeq(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Enroll in sequence…</option>
              {seqs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Btn variant="ghost" onClick={bulkEnroll} data-testid="bulk-enroll-btn">Enroll</Btn>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                {isManager && <th className="p-3"></th>}
                <th className="p-3">Lead</th><th className="p-3">Contact / Org</th><th className="p-3">Status</th>
                <th className="p-3">Priority</th><th className="p-3">340B</th><th className="p-3">RPM</th>
                <th className="p-3">Source</th><th className="p-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 && <tr><td colSpan={9}><EmptyState icon={Users2} title="No leads yet" hint="Create one manually or from Medicare Search." /></td></tr>}
              {leads.map((l) => {
                const snap = l.medicare_snapshot || {};
                return (
                  <tr key={l.id} data-testid={`lead-row-${l.id}`} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => nav(`/crm/leads/${l.id}`)}>
                    {isManager && <td className="p-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!sel[l.id]} onChange={(e) => setSel({ ...sel, [l.id]: e.target.checked })} data-testid={`lead-select-${l.id}`} /></td>}
                    <td className="p-3 font-mono text-xs text-slate-500">{l.lead_number}</td>
                    <td className="p-3"><span className="font-semibold text-slate-800">{l.org_name || `${l.contact_first || ""} ${l.contact_last || ""}`.trim() || "—"}</span><br /><span className="text-xs text-slate-400">{l.email || l.phone || ""}</span></td>
                    <td className="p-3"><StatusBadge status={l.status} /></td>
                    <td className="p-3"><PriorityTag priority={l.priority} /></td>
                    <td className="p-3"><TierPill kind="" tier={snap.tier_340b} /></td>
                    <td className="p-3"><TierPill kind="" tier={snap.tier_rpm} /></td>
                    <td className="p-3 text-slate-500">{l.source}</td>
                    <td className="p-3 text-xs text-slate-400">{fmtDate(l.last_activity_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Lead">
        <Field label="Organization / practice"><input data-testid="nl-org" value={nl.org_name} onChange={(e) => setNl({ ...nl, org_name: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><input value={nl.contact_first} onChange={(e) => setNl({ ...nl, contact_first: e.target.value })} className={inputCls} /></Field>
          <Field label="Last name"><input value={nl.contact_last} onChange={(e) => setNl({ ...nl, contact_last: e.target.value })} className={inputCls} /></Field>
          <Field label="Phone"><input value={nl.phone} onChange={(e) => setNl({ ...nl, phone: e.target.value })} className={inputCls} /></Field>
          <Field label="Email"><input value={nl.email} onChange={(e) => setNl({ ...nl, email: e.target.value })} className={inputCls} /></Field>
          <Field label="Source">
            <div className="flex gap-2">
              <select data-testid="nl-source" value={nl.source} onChange={(e) => setNl({ ...nl, source: e.target.value })} className={inputCls}>{meta.sources.map((s) => <option key={s}>{s}</option>)}</select>
              <Btn variant="ghost" type="button" onClick={addSource} data-testid="nl-add-source">+ Add</Btn>
            </div>
          </Field>
          <Field label="Priority"><select value={nl.priority} onChange={(e) => setNl({ ...nl, priority: e.target.value })} className={inputCls}>{meta.priorities.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Data collected year"><input data-testid="nl-year" type="number" value={nl.collected_year} onChange={(e) => setNl({ ...nl, collected_year: e.target.value })} placeholder="e.g. 2026" className={inputCls} /></Field>
        </div>
        <Btn onClick={create} data-testid="nl-save" className="mt-2 w-full justify-center">Create Lead</Btn>
      </Modal>
    </div>
  );
}
