import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { StatusBadge, PriorityTag, TierPill, Btn, Field, inputCls, EmptyState, Modal, fmtDate } from "@/components/crm/kit";
import { Users2, Plus, UserCheck, Sparkles, Bookmark, Trash2, AlertTriangle } from "lucide-react";

const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
const EMPTY_FILTERS = { status: "", priority: "", match: "", q: "", mine: false, state: "", tier: "", source: "", claim_mismatch: false, city: "", account_manager_id: "", origin: "", radius_mi: 0 };

// Free-text origin -> backend geocode fields for radius search.
const parseOrigin = (text) => {
  const t = (text || "").trim();
  if (!t) return {};
  if (/^\d{5}$/.test(t)) return { origin_zip: t };
  const m = t.match(/^(.+),\s*([A-Za-z]{2})$/);
  if (m) return { origin_city: m[1].trim(), origin_state: m[2].trim() };
  return { origin_address: t };
};

export default function Leads() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isManager = ["admin", "super_admin", "lead_manager"].includes(user?.role);
  const [meta, setMeta] = useState({ statuses: [], sources: [], priorities: [] });
  const [leads, setLeads] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [savedFilters, setSavedFilters] = useState([]);
  const [reassign, setReassign] = useState({ open: false, ids: [] });
  const [sel, setSel] = useState({});
  const [ams, setAms] = useState([]);
  const [assignTo, setAssignTo] = useState("");
  const [enrollSeq, setEnrollSeq] = useState("");
  const [seqs, setSeqs] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [nl, setNl] = useState({ org_name: "", contact_first: "", contact_last: "", phone: "", email: "", source: "Manual Entry", priority: "Medium", collected_year: "" });

  useEffect(() => {
    api.get("/crm/meta").then((r) => setMeta(r.data)).catch(() => {});
    api.get("/users", { params: { roles: "account_manager,lead_manager,admin,super_admin" } }).then((r) => setAms(r.data)).catch(() => {});
    api.get("/crm/sequences").then((r) => setSeqs(r.data)).catch(() => {});
  }, []);

  const loadSaved = useCallback(() => {
    api.get("/crm/saved-searches", { params: { entity: "leads" } }).then((r) => setSavedFilters(r.data)).catch(() => {});
  }, []);
  useEffect(() => { if (isManager) loadSaved(); }, [isManager, loadSaved]);

  const saveFilter = async () => {
    const name = window.prompt("Name this filter (e.g. CA · GREEN · Website):");
    if (!name || !name.trim()) return;
    try {
      await api.post("/crm/saved-searches", { name: name.trim(), entity: "leads", query: filters });
      toast.success("Filter saved");
      loadSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const applySaved = (sid) => {
    const f = savedFilters.find((s) => s.id === sid);
    if (f) setFilters({ ...EMPTY_FILTERS, ...(f.query || {}) });
  };
  const deleteSaved = async (sid) => {
    try { await api.delete(`/crm/saved-searches/${sid}`); toast.success("Filter removed"); loadSaved(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const load = useCallback(async () => {
    const { origin, radius_mi, ...rest } = filters;
    const params = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== "" && v !== false && v !== 0));
    if (radius_mi && origin) Object.assign(params, { radius_mi, ...parseOrigin(origin) });
    const r = await api.get("/crm/leads", { params });
    setLeads(r.data);
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const bulkAssign = async () => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length || !assignTo) return toast.error("Select leads and a person to assign to");
    setReassign({ open: true, ids });
  };
  const doReassign = async () => {
    const ids = reassign.ids;
    const r = await api.post("/crm/leads/bulk-assign", { lead_ids: ids, account_manager_id: assignTo });
    const who = ams.find((a) => a.id === assignTo)?.name || "the selected person";
    const prev = r.data?.prev || [];
    setReassign({ open: false, ids: [] }); setSel({}); load();
    toast.success(`Reassigned ${ids.length} lead(s) to ${who}`, {
      duration: 10000,
      action: {
        label: "Undo",
        onClick: async () => {
          try { const u = await api.post("/crm/leads/restore-assign", { assignments: prev }); toast.success(`Undone — restored ${u.data.restored} lead(s)`); load(); }
          catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
        },
      },
    });
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
          <select data-testid="lead-filter-tier" value={filters.tier} onChange={(e) => setFilters({ ...filters, tier: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">340B: all</option>{["GREEN", "YELLOW", "BLUE", "RED"].map((t) => <option key={t}>{t}</option>)}</select>
          <select data-testid="lead-filter-state" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">State: all</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}</select>
          <input data-testid="lead-filter-city" placeholder="City" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input data-testid="lead-filter-origin" placeholder="Near: ZIP / City, ST / address" value={filters.origin} onChange={(e) => setFilters({ ...filters, origin: e.target.value })} className="w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm" title="Radius search — leave City above blank" />
          <input data-testid="lead-filter-radius" type="number" min={0} placeholder="mi" value={filters.radius_mi || ""} onChange={(e) => setFilters({ ...filters, radius_mi: Number(e.target.value) })} className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-sm" title="Radius in miles" />
          <select data-testid="lead-filter-assigned" value={filters.account_manager_id} onChange={(e) => setFilters({ ...filters, account_manager_id: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">Assigned: all</option>{ams.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select data-testid="lead-filter-source" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">Source: all</option>{meta.sources.map((s) => <option key={s}>{s}</option>)}</select>
          <select data-testid="lead-filter-match" value={filters.match} onChange={(e) => setFilters({ ...filters, match: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">Match: all</option><option value="matched">Matched</option><option value="unmatched">Unmatched</option></select>
          <label className="flex items-center gap-1 text-sm text-slate-600" title="Leads whose imported claim count differed from Medicare"><input type="checkbox" data-testid="lead-filter-mismatch" checked={filters.claim_mismatch} onChange={(e) => setFilters({ ...filters, claim_mismatch: e.target.checked })} /> Claim mismatch</label>
          <Btn variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)} data-testid="lead-filter-clear">Clear</Btn>
          {!isManager && <label className="flex items-center gap-1 text-sm text-slate-600"><input type="checkbox" checked={filters.mine} onChange={(e) => setFilters({ ...filters, mine: e.target.checked })} /> Mine</label>}
        </div>

        {isManager && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm">
            <Bookmark className="h-4 w-4 text-slate-400" />
            <span className="text-slate-500">Saved filters</span>
            <select data-testid="saved-filter-select" value="" onChange={(e) => { if (e.target.value) applySaved(e.target.value); }} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Load a saved filter…</option>
              {savedFilters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Btn variant="ghost" onClick={saveFilter} data-testid="saved-filter-save"><Bookmark className="h-4 w-4" /> Save current</Btn>
            {savedFilters.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                <button type="button" onClick={() => applySaved(s.id)} data-testid={`saved-filter-chip-${s.id}`} className="hover:text-primary">{s.name}</button>
                <button type="button" onClick={() => deleteSaved(s.id)} data-testid={`saved-filter-del-${s.id}`} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}

        {isManager && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-white p-2 text-sm">
            <UserCheck className="h-4 w-4 text-slate-400" />
            <select data-testid="bulk-assign-am" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Assign selected to…</option>
              {ams.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role && a.role !== "account_manager" ? ` (${a.role.replace("_", " ")})` : ""}</option>)}
            </select>
            <Btn variant="ghost" onClick={bulkAssign} data-testid="bulk-assign-btn">Reassign</Btn>
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
                    <td className="p-3"><span className="font-semibold text-slate-800">{l.org_name || `${l.contact_first || ""} ${l.contact_last || ""}`.trim() || "—"}</span>{l.claim_mismatch && <span data-testid={`claim-mismatch-${l.id}`} title={l.claim_mismatch_detail ? `Imported ${l.claim_mismatch_detail.imported} · Medicare ${l.claim_mismatch_detail.medicare}` : "Imported claim count differed from Medicare"} className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"><AlertTriangle className="h-3 w-3" /> Claim mismatch</span>}<br /><span className="text-xs text-slate-400">{l.email || l.phone || ""}</span></td>
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

      <Modal open={reassign.open} onClose={() => setReassign({ open: false, ids: [] })} title="Reassign leads">
        <p className="text-sm text-slate-600" data-testid="reassign-confirm-text">
          Reassign <b>{reassign.ids.length}</b> lead{reassign.ids.length === 1 ? "" : "s"} to <b>{ams.find((a) => a.id === assignTo)?.name || "—"}</b>? They'll be notified by email and push.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setReassign({ open: false, ids: [] })}>Cancel</Btn>
          <Btn onClick={doReassign} data-testid="reassign-confirm-btn">Reassign</Btn>
        </div>
      </Modal>

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
