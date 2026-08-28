import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { StatusBadge, TierPill, Btn, Field, inputCls, money, fmtDate, Modal } from "@/components/crm/kit";
import { ArrowLeft, Activity, Target, StickyNote, History, UserCheck, Link2, Stethoscope } from "lucide-react";

export default function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const isManager = ["admin", "lead_manager"].includes(user?.role);
  const [lead, setLead] = useState(null);
  const [meta, setMeta] = useState({ statuses: [], opp_stages: [] });
  const [ams, setAms] = useState([]);
  const [note, setNote] = useState("");
  const [npi, setNpi] = useState("");
  const [showConvert, setShowConvert] = useState(false);
  const [conv, setConv] = useState({ value: "", stage: "Discovery" });

  const load = useCallback(async () => {
    const r = await api.get(`/crm/leads/${id}`);
    setLead(r.data);
  }, [id]);
  useEffect(() => {
    load();
    api.get("/crm/meta").then((r) => setMeta(r.data)).catch(() => {});
    api.get("/users", { params: { role: "account_manager" } }).then((r) => setAms(r.data)).catch(() => {});
  }, [id, load]);

  if (!lead) return <div className="p-10 text-slate-400">Loading…</div>;
  const snap = lead.medicare_snapshot || {};

  const changeStatus = async (status) => {
    await api.post(`/crm/leads/${id}/status`, { status });
    toast.success(`Status → ${status}`); load();
  };
  const addNote = async () => {
    if (!note.trim()) return;
    await api.post(`/crm/leads/${id}/notes`, { text: note });
    setNote(""); toast.success("Note added"); load();
  };
  const matchMed = async () => {
    try {
      await api.post(`/crm/leads/${id}/match-medicare`, { matched_npi: npi.trim(), dataset_year: lead.dataset_year || 2024 });
      toast.success("Matched to Medicare record"); setNpi(""); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const assign = async (field, val) => {
    await api.post(`/crm/leads/${id}/assign`, { [field]: val });
    toast.success("Assigned"); load();
  };
  const convert = async () => {
    try {
      const r = await api.post(`/crm/leads/${id}/convert`, { value: conv.value ? Number(conv.value) : null, stage: conv.stage });
      toast.success(`Converted → ${r.data.opp_number}`); setShowConvert(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => nav("/crm/leads")} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /></button>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{lead.lead_number}</span>
                <StatusBadge status={lead.status} />
              </div>
              <h1 className="font-display text-xl font-bold text-slate-900">{lead.org_name || `${lead.contact_first || ""} ${lead.contact_last || ""}`.trim() || "Lead"}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select data-testid="ld-status" value={lead.status} onChange={(e) => changeStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
              {meta.statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
            {!lead.opportunity_id && <Btn onClick={() => setShowConvert(true)} data-testid="ld-convert"><Target className="h-4 w-4" /> Convert</Btn>}
            {lead.opportunity_id && <Btn variant="ghost" onClick={() => nav("/crm/opportunities")}><Link2 className="h-4 w-4" /> View opportunity</Btn>}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        {/* Left: details */}
        <div className="space-y-6 lg:col-span-2">
          {/* Medicare snapshot */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2"><Stethoscope className="h-4 w-4 text-primary" /><h2 className="font-display font-bold text-slate-900">Medicare Match</h2></div>
            {lead.medicare_match_status === "matched" ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <TierPill kind="340B" tier={snap.tier_340b} /><TierPill kind="RPM" tier={snap.tier_rpm} />
                  <span className="font-mono text-xs text-slate-500">NPI {lead.matched_npi} · {snap.dataset_year}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-center">
                  <div><p className="text-[10px] uppercase text-slate-400">Claims</p><p className="font-bold text-slate-800">{Number(snap.tot_clms || 0).toLocaleString()}</p></div>
                  <div><p className="text-[10px] uppercase text-slate-400">Drug Cost</p><p className="font-bold text-slate-800">{money(snap.tot_cost)}</p></div>
                  <div><p className="text-[10px] uppercase text-slate-400">$/Claim</p><p className="font-bold text-slate-800">{money(snap.avg_per_claim)}</p></div>
                </div>
                <p className="mt-2 text-sm text-slate-500">{snap.specialty} · {snap.city}, {snap.state}</p>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <input data-testid="ld-npi" placeholder="Enter NPI to match" value={npi} onChange={(e) => setNpi(e.target.value)} className={inputCls} />
                <Btn onClick={matchMed} data-testid="ld-match">Match</Btn>
              </div>
            )}
          </section>

          {/* Notes */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2"><StickyNote className="h-4 w-4 text-primary" /><h2 className="font-display font-bold text-slate-900">Notes</h2></div>
            <div className="mb-3 flex gap-2">
              <input data-testid="ld-note-input" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} onKeyDown={(e) => e.key === "Enter" && addNote()} />
              <Btn onClick={addNote} data-testid="ld-note-add">Add</Btn>
            </div>
            <div className="space-y-2">
              {(lead.notes || []).slice().reverse().map((n) => (
                <div key={n.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                  <p className="text-slate-700">{n.text}</p>
                  <p className="mt-1 text-xs text-slate-400">{n.author_name} · {fmtDate(n.created_at)}</p>
                </div>
              ))}
              {(!lead.notes || lead.notes.length === 0) && <p className="text-sm text-slate-400">No notes yet.</p>}
            </div>
          </section>

          {/* Activity timeline */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /><h2 className="font-display font-bold text-slate-900">Activity Timeline</h2></div>
            <ol className="space-y-3">
              {(lead.activity || []).slice().reverse().map((a, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                  <div><p className="text-slate-700">{a.summary}</p><p className="text-xs text-slate-400">{a.by_name} · {fmtDate(a.at)}</p></div>
                </li>
              ))}
              {(!lead.activity || lead.activity.length === 0) && <p className="text-sm text-slate-400">No activity recorded.</p>}
            </ol>
          </section>
        </div>

        {/* Right: meta */}
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><UserCheck className="h-4 w-4 text-primary" /> Ownership</h2>
            <Field label="Account Manager">
              <select data-testid="ld-assign-am" disabled={!isManager} value={lead.account_manager_id || ""} onChange={(e) => assign("account_manager_id", e.target.value)} className={inputCls}>
                <option value="">Unassigned</option>
                {ams.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-500">
              <div><p className="text-xs uppercase text-slate-400">Source</p>{lead.source}</div>
              <div><p className="text-xs uppercase text-slate-400">Priority</p>{lead.priority}</div>
              <div><p className="text-xs uppercase text-slate-400">Created by</p>{lead.created_by_name}</div>
              <div><p className="text-xs uppercase text-slate-400">Created</p>{fmtDate(lead.created_at)}</div>
            </div>
            {lead.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{lead.tags.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t}</span>)}</div>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><History className="h-4 w-4 text-primary" /> Status History</h2>
            <ol className="space-y-2 text-sm">
              {(lead.status_history || []).slice().reverse().map((h, i) => (
                <li key={i} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-slate-700">{h.from ? `${h.from} → ` : ""}<b>{h.to}</b></p>
                  <p className="text-xs text-slate-400">{h.by_name} · {fmtDate(h.at)}{h.reason ? ` · ${h.reason}` : ""}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <Modal open={showConvert} onClose={() => setShowConvert(false)} title="Convert to Opportunity">
        <Field label="Opportunity value ($)"><input data-testid="conv-value" type="number" value={conv.value} onChange={(e) => setConv({ ...conv, value: e.target.value })} className={inputCls} /></Field>
        <Field label="Starting stage"><select data-testid="conv-stage" value={conv.stage} onChange={(e) => setConv({ ...conv, stage: e.target.value })} className={inputCls}>{meta.opp_stages.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Btn onClick={convert} data-testid="conv-save" className="mt-2 w-full justify-center">Create Opportunity</Btn>
      </Modal>
    </div>
  );
}
