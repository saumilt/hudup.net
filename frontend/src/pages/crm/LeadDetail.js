import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { StatusBadge, TierPill, Btn, Field, inputCls, money, fmtDate, Modal, ProbabilityBadge, CompletenessBadge, leadCompleteness } from "@/components/crm/kit";
import Softphone from "@/components/crm/Softphone";
import ClientServicesPanel from "@/components/crm/ClientServicesPanel";
import { ArrowLeft, Activity, Target, StickyNote, History, UserCheck, Link2, Stethoscope,
  Mail, Phone, MessageSquare, CalendarPlus, Sparkles, ShieldCheck, Check, RefreshCw, Bot, Shuffle, Pencil, AlertTriangle, FileText } from "lucide-react";

export default function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const isManager = ["admin", "super_admin", "lead_manager"].includes(user?.role);
  const isAdmin = ["admin", "super_admin"].includes(user?.role);
  const [lead, setLead] = useState(null);
  const [meta, setMeta] = useState({ statuses: [], opp_stages: [] });
  const [ams, setAms] = useState([]);
  const [note, setNote] = useState("");
  const [npi, setNpi] = useState("");
  const [showConvert, setShowConvert] = useState(false);
  const [conv, setConv] = useState({ value: "", stage: "Discovery" });
  const [modal, setModal] = useState(null); // email | call | text
  const [email, setEmail] = useState({ subject: "", html: "" });
  const [call, setCall] = useState({ disposition: "Connected", notes: "", follow_up_task: "" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState({ busy: false, prep: null, brief: null, open: false, text: "", file: null, result: null, pick: [] });
  const [agent, setAgent] = useState({ busy: false, plan: null, picked: {} });
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState({});
  const [histFilter, setHistFilter] = useState("all");
  const [terrs, setTerrs] = useState([]);
  const [refGens, setRefGens] = useState([]);

  const runAiEnrich = async () => {
    setAi((s) => ({ ...s, busy: true, result: null }));
    try {
      const fd = new FormData();
      if (ai.text) fd.append("text", ai.text);
      if (ai.file) fd.append("file", ai.file);
      const r = await api.post(`/crm/leads/${id}/ai-enrich`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      const found = r.data.found || {};
      setAi((s) => ({ ...s, busy: false, result: r.data, pick: Object.keys(found) }));
    } catch (e) {
      setAi((s) => ({ ...s, busy: false }));
      toast.error(formatApiError(e.response?.data?.detail) || "AI enrichment failed");
    }
  };
  const applyAiEnrich = async () => {
    try {
      const r = await api.post(`/crm/leads/${id}/ai-enrich/accept`, { job_id: ai.result.job_id, fields: ai.pick, save_note: true });
      toast.success(`Applied ${r.data.applied.length} field(s)` + (r.data.note_added ? " + AI note" : ""));
      setAi({ ...ai, open: false, text: "", file: null, busy: false, result: null, pick: [] });
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const runAiResearch = async () => {
    setAi((s) => ({ ...s, busy: true, result: null }));
    try {
      const start = await api.post(`/crm/leads/${id}/ai-enrich/research`);
      const jobId = start.data.job_id;
      const poll = async (tries) => {
        try {
          const r = await api.get(`/crm/leads/${id}/ai-enrich/jobs/${jobId}`);
          const st = r.data.status;
          if (st === "running") {
            if (tries <= 0) { setAi((s) => ({ ...s, busy: false })); toast.error("AI research is taking too long — please try again"); return; }
            setTimeout(() => poll(tries - 1), 3000);
            return;
          }
          if (st === "error") { setAi((s) => ({ ...s, busy: false })); toast.error(r.data.error || "AI research failed"); return; }
          const found = r.data.found || {};
          setAi((s) => ({ ...s, busy: false, result: r.data, pick: Object.keys(found) }));
        } catch (e) { setAi((s) => ({ ...s, busy: false })); toast.error(formatApiError(e.response?.data?.detail) || "AI research failed"); }
      };
      poll(40);
    } catch (e) {
      setAi((s) => ({ ...s, busy: false }));
      toast.error(formatApiError(e.response?.data?.detail) || "AI research failed");
    }
  };


  const load = useCallback(async () => {
    const r = await api.get(`/crm/leads/${id}`);
    setLead(r.data);
  }, [id]);
  useEffect(() => {
    load();
    api.get("/crm/meta").then((r) => setMeta(r.data)).catch(() => {});
    api.get("/users", { params: { roles: "account_manager,lead_manager,admin,super_admin" } }).then((r) => setAms(r.data)).catch(() => {});
    api.get("/crm/territories").then((r) => setTerrs(r.data)).catch(() => {});
    api.get("/crm/saved-searches", { params: { entity: "referral" } }).then((r) => setRefGens(r.data)).catch(() => {});
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
    toast.success("Updated"); load();
  };
  const setCloser = async (val) => {
    await api.post(`/crm/leads/${id}/closer`, { closer_id: val || null });
    toast.success(val ? "Closer set" : "Closer removed"); load();
  };
  const toggleCollaborator = async (uid) => {
    const cur = lead.collaborator_ids || [];
    const next = cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid];
    await api.post(`/crm/leads/${id}/assign`, { collaborator_ids: next });
    toast.success("Collaborators updated"); load();
  };
  const setMode = async (val) => { await assign("collaboration_mode", val); };
  const setReferralSource = async (gid) => {
    const g = refGens.find((x) => x.id === gid);
    try {
      await api.patch(`/crm/leads/${id}`, { referral_generator_id: gid || "", referral_generator_name: gid ? (g?.name || null) : "" });
      toast.success(gid ? "Referral source set" : "Referral source cleared"); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };  const setTerritory = async (val) => {
    await api.post(`/crm/leads/${id}/assign`, { territory_id: val });
    toast.success("Territory updated");
    if (isAdmin && val && window.confirm("Reassign this lead to that territory's team automatically?")) {
      try {
        const r = await api.post(`/crm/leads/${id}/route-to-territory`);
        toast.success(`Assigned to ${r.data.account_manager_name || "a rep"}${r.data.team_name ? ` (${r.data.team_name})` : ""}`);
      } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    }
    load();
  };
  const archiveLead = async () => {
    if (!window.confirm(lead.archived ? "Unarchive this lead?" : "Archive this lead? It will be hidden from the leads list.")) return;
    try { await api.post(`/crm/leads/${id}/archive`, { archived: !lead.archived }); toast.success(lead.archived ? "Unarchived" : "Archived"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const openEdit = () => {
    setEdit({
      org_name: lead.org_name || "", contact_first: lead.contact_first || "",
      contact_last: lead.contact_last || "", phone: lead.phone || "", email: lead.email || "",
      priority: lead.priority || "Medium", est_value: lead.est_value ?? "",
      specialty: lead.specialty || "", city: lead.city || "", state: lead.state || "",
    });
    setEditOpen(true);
  };
  const saveEdit = async () => {
    try {
      const payload = { ...edit, est_value: edit.est_value === "" ? null : Number(edit.est_value) };
      await api.patch(`/crm/leads/${id}`, payload);
      toast.success("Lead updated"); setEditOpen(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const convert = async () => {
    try {
      const r = await api.post(`/crm/leads/${id}/convert`, { value: conv.value ? Number(conv.value) : null, stage: conv.stage });
      toast.success(`Converted → ${r.data.opp_number}`); setShowConvert(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const comm = lead.comm || {};
  const HIST_TABS = [["all", "All"], ["updated", "Edits"], ["assigned", "Reassignments"], ["status", "Status"]];
  const editHistory = (lead.activity || [])
    .filter((a) => ["updated", "assigned", "status"].includes(a.kind))
    .filter((a) => histFilter === "all" || a.kind === histFilter);
  const sendEmail = async () => {
    if (!email.subject.trim() || !email.html.trim()) return toast.error("Subject and body required");
    setBusy(true);
    try {
      await api.post(`/crm/leads/${id}/email`, { subject: email.subject, html: `<p>${email.html.replace(/\n/g, "<br/>")}</p>` });
      toast.success("Email sent"); setModal(null); setEmail({ subject: "", html: "" }); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setBusy(false); }
  };
  const logCall = async () => {
    setBusy(true);
    try {
      await api.post(`/crm/leads/${id}/call`, { disposition: call.disposition, notes: call.notes || null, follow_up_task: call.follow_up_task || null });
      toast.success("Call logged"); setModal(null); setCall({ disposition: "Connected", notes: "", follow_up_task: "" }); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setBusy(false); }
  };
  const sendText = async () => {
    if (!text.trim()) return;
    try {
      const r = await api.post(`/crm/leads/${id}/text`, { body: text });
      toast.success(r.data.note || "Message logged"); setModal(null); setText(""); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const openAiJob = async (jobId) => {
    setAi((s) => ({ ...s, open: true, busy: true, result: null, pick: [] }));
    try {
      const r = await api.get(`/crm/leads/${id}/ai-enrich/jobs/${jobId}`);
      if (r.data.status === "preview") {
        const found = r.data.found || {};
        setAi((s) => ({ ...s, busy: false, result: r.data, pick: Object.keys(found) }));
      } else if (r.data.status === "running") {
        setAi((s) => ({ ...s, busy: false }));
        toast.message("AI research is still running — try again in a moment");
      } else {
        setAi((s) => ({ ...s, busy: false }));
        toast.error(r.data.error || "AI research failed");
      }
    } catch (e) { setAi((s) => ({ ...s, busy: false })); toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const reResearch = () => {
    setAi((s) => ({ ...s, open: true, text: "", file: null, busy: false, result: null, pick: [] }));
    runAiResearch();
  };
  const setPref = async (patch) => {
    try { await api.patch(`/crm/leads/${id}/preferences`, patch); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const aiDraftEmail = async () => {
    setAi({ ...ai, busy: true });
    try { const r = await api.post(`/crm/leads/${id}/ai/draft-email`, { goal: email.subject || undefined }); setEmail({ subject: r.data.subject, html: r.data.body }); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setAi((a) => ({ ...a, busy: false })); }
  };
  const aiDraftText = async () => {
    setAi({ ...ai, busy: true });
    try { const r = await api.post(`/crm/leads/${id}/ai/draft-text`, {}); setText(r.data.body); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setAi((a) => ({ ...a, busy: false })); }
  };
  const aiPrep = async () => {
    setAi({ ...ai, busy: true, prep: null });
    try { const r = await api.post(`/crm/leads/${id}/ai/prep-call`); setAi((a) => ({ ...a, busy: false, prep: r.data })); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); setAi((a) => ({ ...a, busy: false })); }
  };
  const aiResearch = async () => {
    setModal("research"); setAi({ ...ai, busy: true, brief: null });
    try { const r = await api.post(`/crm/leads/${id}/ai/research`); setAi((a) => ({ ...a, busy: false, brief: r.data.brief })); }
    catch (e) { setAi((a) => ({ ...a, busy: false, brief: formatApiError(e.response?.data?.detail) })); }
  };
  const runAgent = async () => {
    setModal("agent"); setAgent({ busy: true, plan: null, picked: {} });
    try {
      const r = await api.post(`/crm/leads/${id}/agent/plan`);
      const picked = {};
      (r.data.next_actions || []).forEach((_, i) => { picked[i] = true; });
      setAgent({ busy: false, plan: r.data, picked });
    } catch (e) { setAgent({ busy: false, plan: { error: formatApiError(e.response?.data?.detail) }, picked: {} }); }
  };
  const runAgentExecute = async () => {
    const acts = (agent.plan.next_actions || []).filter((_, i) => agent.picked[i]);
    if (!acts.length) return toast.error("Select at least one action");
    const payload = { actions: acts.map((a) => ({ type: a.type, value: a.value, label: a.label })) };
    if (acts.some((a) => a.type === "email")) payload.email = agent.plan.draft_email;
    if (acts.some((a) => a.type === "sms")) payload.sms = agent.plan.draft_sms;
    try {
      const r = await api.post(`/crm/leads/${id}/agent/execute`, payload);
      toast.success(`AI Agent ran: ${r.data.executed.join(", ") || "nothing"}`);
      setModal(null); load();
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
                {lead.medicare_match_status === "matched" && <ProbabilityBadge snapshot={snap} testid="ld-probability" />}
              </div>
              <h1 className="font-display text-xl font-bold text-slate-900">{lead.org_name || `${lead.contact_first || ""} ${lead.contact_last || ""}`.trim() || "Lead"}</h1>
              <p className="text-xs text-slate-400">{[snap.specialty || lead.specialty, [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select data-testid="ld-status" value={lead.status} onChange={(e) => changeStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
              {meta.statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
            <Btn variant="ghost" data-testid="ld-edit" onClick={openEdit}><Pencil className="h-4 w-4" /> Edit</Btn>
            {isAdmin && <Btn variant="ghost" data-testid="ld-archive" onClick={archiveLead}>{lead.archived ? "Unarchive" : "Archive"}</Btn>}
            {!lead.opportunity_id && <Btn onClick={() => setShowConvert(true)} data-testid="ld-convert"><Target className="h-4 w-4" /> Convert</Btn>}
            {lead.opportunity_id && <Btn variant="ghost" onClick={() => nav("/crm/opportunities")}><Link2 className="h-4 w-4" /> View opportunity</Btn>}
          </div>
        </div>
        {/* Sales action bar */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn data-testid="action-email" variant="ghost" onClick={() => setModal("email")}><Mail className="h-4 w-4" /> Email</Btn>
          <Btn data-testid="action-call" variant="ghost" onClick={() => setModal("call")}><Phone className="h-4 w-4" /> Call</Btn>
          <Btn data-testid="action-text" variant="ghost" onClick={() => setModal("text")}><MessageSquare className="h-4 w-4" /> Text</Btn>
          <Btn data-testid="action-schedule" variant="ghost" onClick={() => nav("/crm/meetings")}><CalendarPlus className="h-4 w-4" /> Schedule</Btn>
          <Btn data-testid="action-research" variant="ghost" onClick={aiResearch}><Sparkles className="h-4 w-4" /> Research</Btn>
          <Btn data-testid="action-agent" variant="dark" onClick={runAgent}><Bot className="h-4 w-4" /> AI Agent</Btn>
          {lead.ai_research_ready && lead.ai_research_job_id && (
            <Btn data-testid="action-review-research" onClick={() => openAiJob(lead.ai_research_job_id)}><Sparkles className="h-4 w-4" /> AI research ready — review</Btn>
          )}
          <Btn data-testid="action-ai-enrich" variant="dark" onClick={() => setAi((s) => ({ ...s, open: true, text: "", file: null, busy: false, result: null, pick: [] }))}><FileText className="h-4 w-4" /> AI Enrich</Btn>
          <Btn data-testid="action-reresearch" variant="ghost" onClick={reResearch}><RefreshCw className="h-4 w-4" /> Refresh from web</Btn>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        {/* Left: details */}
        <div className="space-y-6 lg:col-span-2">
          <ClientServicesPanel key={lead.id} lead={lead} onSaved={load} />
          {/* Medicare snapshot */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2"><Stethoscope className="h-4 w-4 text-primary" /><h2 className="font-display font-bold text-slate-900">Medicare Match</h2>
              {lead.claim_mismatch && (
                <span data-testid="ld-claim-mismatch" title={lead.claim_mismatch_detail ? `Imported ${lead.claim_mismatch_detail.imported} · Medicare ${lead.claim_mismatch_detail.medicare}` : "Imported claim count differed from Medicare"} className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700"><AlertTriangle className="h-3 w-3" /> Claim mismatch{lead.claim_mismatch_detail ? `: imported ${lead.claim_mismatch_detail.imported} → ${lead.claim_mismatch_detail.medicare}` : ""}</span>
              )}
            </div>
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
            <Field label="Assigned to (owner)">
              <select data-testid="ld-assign-am" disabled={!isManager} value={lead.account_manager_id || ""} onChange={(e) => assign("account_manager_id", e.target.value)} className={inputCls}>
                <option value="">Unassigned</option>
                {ams.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role && a.role !== "account_manager" ? ` (${a.role.replace("_", " ")})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Closer (Lead Manager)">
              <select data-testid="ld-closer" value={lead.closer_id || ""} onChange={(e) => setCloser(e.target.value)} className={inputCls}>
                <option value="">No closer</option>
                {ams.filter((a) => a.role === "lead_manager").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            {isManager && (
              <Field label="Collaborators (also work this lead)">
                <div data-testid="ld-collaborators" className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {ams.filter((a) => a.role === "account_manager" && a.id !== lead.account_manager_id).map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" data-testid={`ld-collab-${a.id}`} checked={(lead.collaborator_ids || []).includes(a.id)} onChange={() => toggleCollaborator(a.id)} className="h-4 w-4 accent-primary" />
                      {a.name}
                    </label>
                  ))}
                </div>
                {(lead.collaborator_ids || []).length > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <span className="text-xs uppercase text-slate-400">Mode</span>
                    <select data-testid="ld-collab-mode" value={lead.collaboration_mode || "both"} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                      <option value="both">Both work it</option>
                      <option value="owner_only">Owner only</option>
                    </select>
                  </div>
                )}
              </Field>
            )}
            {isManager && (
              <Field label="Territory">
                <select data-testid="ld-territory" value={lead.territory_id || ""} onChange={(e) => setTerritory(e.target.value)} className={inputCls}>
                  <option value="">No territory</option>
                  {terrs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-500">
              <div><p className="text-xs uppercase text-slate-400">Source</p>{lead.source}</div>
              {lead.collected_year ? <div data-testid="ld-collected-year"><p className="text-xs uppercase text-slate-400">Data year</p>{lead.collected_year}</div> : null}
              <div><p className="text-xs uppercase text-slate-400">Priority</p>{lead.priority}</div>
              <div><p className="text-xs uppercase text-slate-400">Created by</p>{lead.created_by_name}</div>
              <div><p className="text-xs uppercase text-slate-400">Created</p>{fmtDate(lead.created_at)}</div>
            </div>
            {lead.routing_reason && (
              <div data-testid="ld-routing-reason" className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400"><Shuffle className="h-3 w-3" /> Why assigned</p>
                <p className="text-sm text-slate-600">{lead.routing_reason}</p>
              </div>
            )}
            <div className="mt-3" data-testid="ld-referral-source">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400"><Link2 className="h-3 w-3" /> Referral source</p>
              <select data-testid="ld-referral-select" value={lead.referral_generator_id || ""} onChange={(e) => setReferralSource(e.target.value)} className={`${inputCls} mt-1`}>
                <option value="">No referral source</option>
                {refGens.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                {lead.referral_generator_id && !refGens.some((g) => g.id === lead.referral_generator_id) && (
                  <option value={lead.referral_generator_id}>{lead.referral_generator_name || "Linked source"}</option>
                )}
              </select>
            </div>
            {lead.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{lead.tags.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t}</span>)}</div>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="ld-edit-history">
            <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><History className="h-4 w-4 text-primary" /> Change History</h2>
            <div className="mb-3 flex flex-wrap gap-1">
              {HIST_TABS.map(([k, lbl]) => (
                <button key={k} data-testid={`hist-tab-${k}`} onClick={() => setHistFilter(k)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${histFilter === k ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{lbl}</button>
              ))}
            </div>
            {editHistory.length === 0 ? (
              <p className="text-sm text-slate-400">No changes yet.</p>
            ) : (
              <ol className="space-y-3">
                {editHistory.map((a, i) => (
                  <li key={i} className="border-l-2 border-slate-100 pl-3 text-sm">
                    <p className="text-slate-700">{a.summary}</p>
                    {(a.meta?.changes || []).map((c, j) => (
                      <p key={j} className="text-xs text-slate-500">
                        <span className="capitalize text-slate-600">{c.field.replace(/_/g, " ")}</span>: <span className="text-slate-400 line-through">{String(c.from ?? "—")}</span> → <span className="font-semibold text-slate-700">{String(c.to ?? "—")}</span>
                      </p>
                    ))}
                    <p className="mt-0.5 text-xs text-slate-400">{a.by_name} · {fmtDate(a.at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="ld-completeness">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display font-bold text-slate-900">Data Completeness</h2>
              <CompletenessBadge lead={lead} />
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {leadCompleteness(lead).checks.map(([label, v]) => (
                <span key={label} className={`flex items-center gap-1 ${v ? "text-slate-600" : "text-slate-300"}`}>{v ? "✓" : "○"} {label}</span>
              ))}
            </div>
            <div className="mt-3 border-t border-slate-100 pt-2">
              <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Relationships</p>
              <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
                {(lead.medicare_snapshot?.specialty || lead.specialty) && <span className="rounded bg-slate-100 px-1.5 py-0.5">{lead.medicare_snapshot?.specialty || lead.specialty}</span>}
                {lead.org_name && <><span className="text-slate-300">→</span><span className="rounded bg-slate-100 px-1.5 py-0.5">{lead.org_name}</span></>}
                {lead.matched_npi && <><span className="text-slate-300">→</span><span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">Medicare {lead.dataset_year || 2024}</span></>}
                {lead.opportunity_id && <><span className="text-slate-300">→</span><span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">Opportunity</span></>}
                {lead.account_manager_name && <><span className="text-slate-300">→</span><span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{lead.account_manager_name}</span></>}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-primary" /> Communication Preferences</h2>
            <div className="space-y-2 text-sm">
              {[["do_not_call", "Do Not Call"], ["do_not_text", "Do Not Text"], ["email_suppressed", "Email Suppressed"], ["sms_consent", "SMS Consent"]].map(([k, lbl]) => (
                <label key={k} className="flex items-center justify-between">
                  <span className="text-slate-600">{lbl}</span>
                  <input data-testid={`pref-${k}`} type="checkbox" checked={!!comm[k]} onChange={(e) => setPref({ [k]: e.target.checked })} className="h-4 w-4 accent-primary" />
                </label>
              ))}
              <Field label="Preferred method">
                <select data-testid="pref-method" value={comm.preferred_method || ""} onChange={(e) => setPref({ preferred_method: e.target.value })} className={inputCls}>
                  <option value="">No preference</option><option value="email">Email</option><option value="phone">Phone</option><option value="sms">SMS</option>
                </select>
              </Field>
            </div>
          </section>

          {lead.enrichment && Object.keys(lead.enrichment).length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><Sparkles className="h-4 w-4 text-primary" /> Professional & Social</h2>
              <div className="space-y-2 text-sm">
                {Object.entries(lead.enrichment).map(([k, v]) => (
                  <div key={k} data-testid={`enr-${k}`} className="rounded-lg bg-slate-50 p-2">
                    <p className="text-[10px] uppercase text-slate-400">{k.replace(/_/g, " ")}</p>
                    <p className="break-words font-semibold text-slate-700">{Array.isArray(v.value) ? v.value.join(", ") : String(v.value)}</p>
                    <p className="text-[10px] text-slate-400">{v.source} · {v.confidence} confidence</p>
                  </div>
                ))}
              </div>
            </section>
          )}

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

      <Modal open={ai.open} onClose={() => setAi({ ...ai, open: false })} title="AI Enrich — web research or PDF" wide>
        {!ai.result ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="mb-2 text-sm text-slate-600">Let <b>AI search the web</b> for this practice &amp; physician using what's already on the record — no paste needed. Findings are shown for review before anything is saved.</p>
              <Btn onClick={runAiResearch} data-testid="ai-research-run" disabled={ai.busy} className="w-full justify-center"><Sparkles className="h-4 w-4" /> {ai.busy ? "Researching the web…" : "Research the web with AI"}</Btn>
            </div>
            <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase text-slate-400"><span className="h-px flex-1 bg-slate-200" /> or paste / upload <span className="h-px flex-1 bg-slate-200" /></div>
            <p className="text-sm text-slate-500">Paste research (e.g. from ChatGPT) and/or upload a PDF profile. AI extracts contact &amp; practice details; everything else is saved as an <b>AI update</b> note. This mode only uses what's in the material — it won't invent data.</p>
            <Field label="Research text (optional)">
              <textarea data-testid="ai-enrich-text" value={ai.text} onChange={(e) => setAi({ ...ai, text: e.target.value })} rows={6} className={inputCls} placeholder="Paste the physician's profile / research here…" />
            </Field>
            <Field label="Or upload a PDF / text file">
              <input data-testid="ai-enrich-file" type="file" accept=".pdf,.txt,.md" onChange={(e) => setAi({ ...ai, file: e.target.files?.[0] || null })} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold" />
            </Field>
            <Btn onClick={runAiEnrich} data-testid="ai-enrich-run" disabled={ai.busy || (!ai.text && !ai.file)} variant="ghost" className="w-full justify-center">{ai.busy ? "Analyzing…" : "Extract from pasted text / PDF"}</Btn>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.keys(ai.result.found || {}).length === 0 ? (
              <p className="text-sm text-amber-600">No contact fields were found in the material.</p>
            ) : (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Contact / practice fields found — pick what to apply</p>
                <div className="space-y-1 rounded-lg border border-slate-200 p-2">
                  {Object.entries(ai.result.found).map(([k, v]) => {
                    const m = (ai.result.field_meta || {})[k] || {};
                    const conf = (m.confidence || "").toUpperCase();
                    const confCls = conf === "HIGH" ? "bg-emerald-100 text-emerald-700" : conf === "LOW" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700";
                    let host = "";
                    try { host = m.source ? new URL(m.source).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
                    return (
                      <label key={k} data-testid={`ai-pick-row-${k}`} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" data-testid={`ai-pick-${k}`} checked={ai.pick.includes(k)} onChange={(e) => setAi((s) => ({ ...s, pick: e.target.checked ? [...s.pick, k] : s.pick.filter((x) => x !== k) }))} className="mt-1 h-4 w-4 accent-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="capitalize text-slate-500">{k.replace(/_/g, " ")}:</span> <span className="font-semibold text-slate-800">{String(v)}</span>
                          {conf && <span data-testid={`ai-conf-${k}`} className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold ${confCls}`}>{conf}</span>}
                          {host && <a href={m.source} target="_blank" rel="noreferrer" data-testid={`ai-src-${k}`} className="ml-2 align-middle text-[11px] text-primary underline hover:opacity-80">{host}</a>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {ai.result.summary && <div><p className="mb-1 text-xs font-semibold uppercase text-slate-400">Summary (saved as AI note)</p><p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700">{ai.result.summary}</p></div>}
            {(ai.result.notes || []).length > 0 && <div><p className="mb-1 text-xs font-semibold uppercase text-slate-400">Also saved to the AI note</p><ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-600">{ai.result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => setAi({ ...ai, result: null, pick: [] })}>Back</Btn>
              <Btn onClick={applyAiEnrich} data-testid="ai-enrich-apply" className="flex-1 justify-center">Apply + save AI note</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Lead" wide>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Organization / practice"><input data-testid="edit-org" value={edit.org_name} onChange={(e) => setEdit({ ...edit, org_name: e.target.value })} className={inputCls} /></Field>
          <Field label="Priority"><select data-testid="edit-priority" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} className={inputCls}>{(meta.priorities || ["Low", "Medium", "High", "Urgent"]).map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="First name"><input data-testid="edit-first" value={edit.contact_first} onChange={(e) => setEdit({ ...edit, contact_first: e.target.value })} className={inputCls} /></Field>
          <Field label="Last name"><input data-testid="edit-last" value={edit.contact_last} onChange={(e) => setEdit({ ...edit, contact_last: e.target.value })} className={inputCls} /></Field>
          <Field label="Phone"><input data-testid="edit-phone" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} className={inputCls} /></Field>
          <Field label="Email"><input data-testid="edit-email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className={inputCls} /></Field>
          <Field label="Specialty"><input data-testid="edit-specialty" value={edit.specialty} onChange={(e) => setEdit({ ...edit, specialty: e.target.value })} className={inputCls} /></Field>
          <Field label="Est. value ($)"><input data-testid="edit-value" type="number" value={edit.est_value} onChange={(e) => setEdit({ ...edit, est_value: e.target.value })} className={inputCls} /></Field>
          <Field label="City"><input data-testid="edit-city" value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} className={inputCls} /></Field>
          <Field label="State"><input data-testid="edit-state" value={edit.state} onChange={(e) => setEdit({ ...edit, state: e.target.value })} className={inputCls} maxLength={2} placeholder="e.g. CA" /></Field>
        </div>
        <Btn onClick={saveEdit} data-testid="edit-save" className="mt-3 w-full justify-center">Save Changes</Btn>
      </Modal>

      <Modal open={showConvert} onClose={() => setShowConvert(false)} title="Convert to Opportunity">
        <Field label="Opportunity value ($)"><input data-testid="conv-value" type="number" value={conv.value} onChange={(e) => setConv({ ...conv, value: e.target.value })} className={inputCls} /></Field>
        <Field label="Starting stage"><select data-testid="conv-stage" value={conv.stage} onChange={(e) => setConv({ ...conv, stage: e.target.value })} className={inputCls}>{meta.opp_stages.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Btn onClick={convert} data-testid="conv-save" className="mt-2 w-full justify-center">Create Opportunity</Btn>
      </Modal>

      <Modal open={modal === "email"} onClose={() => setModal(null)} title="Send Email" wide>
        <p className="mb-3 text-sm text-slate-500">To: <b>{lead.email || "no email on file"}</b></p>
        <div className="mb-2"><Btn variant="dark" data-testid="email-ai-draft" onClick={aiDraftEmail} disabled={ai.busy}><Sparkles className="h-4 w-4" /> {ai.busy ? "Drafting…" : "AI Draft"}</Btn></div>
        <Field label="Subject"><input data-testid="email-subject" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} className={inputCls} /></Field>
        <Field label="Message"><textarea data-testid="email-body" rows={7} value={email.html} onChange={(e) => setEmail({ ...email, html: e.target.value })} className={inputCls} /></Field>
        <Btn onClick={sendEmail} disabled={busy || !lead.email} data-testid="email-send" className="mt-1 w-full justify-center">{busy ? "Sending…" : "Send Email"}</Btn>
      </Modal>

      <Modal open={modal === "call"} onClose={() => setModal(null)} title="Log Call" wide>
        <Softphone lead={lead} user={user} />
        <div className="mb-3"><Btn variant="dark" data-testid="call-ai-prep" onClick={aiPrep} disabled={ai.busy}><Sparkles className="h-4 w-4" /> {ai.busy ? "Preparing…" : "AI Prep Call"}</Btn></div>
        {ai.prep && (
          <div data-testid="call-prep" className="mb-3 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
            {ai.prep.overview && <p className="text-slate-700"><b>Overview:</b> {ai.prep.overview}</p>}
            {ai.prep.talking_points?.length > 0 && <div><b className="text-slate-700">Talking points</b><ul className="ml-4 list-disc text-slate-600">{ai.prep.talking_points.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
            {ai.prep.questions?.length > 0 && <div><b className="text-slate-700">Questions</b><ul className="ml-4 list-disc text-slate-600">{ai.prep.questions.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
            {ai.prep.objections?.length > 0 && <div><b className="text-slate-700">Objections</b><ul className="ml-4 list-disc text-slate-600">{ai.prep.objections.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          </div>
        )}
        <Field label="Disposition">
          <select data-testid="call-disposition" value={call.disposition} onChange={(e) => setCall({ ...call, disposition: e.target.value })} className={inputCls}>
            {["Connected", "No Answer", "Left Voicemail", "Busy", "Wrong Number", "Interested", "Follow-Up", "Meeting Scheduled", "Not Interested", "Do Not Call"].map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Notes"><textarea data-testid="call-notes" rows={3} value={call.notes} onChange={(e) => setCall({ ...call, notes: e.target.value })} className={inputCls} /></Field>
        <Field label="Follow-up task (optional)"><input data-testid="call-followup" value={call.follow_up_task} onChange={(e) => setCall({ ...call, follow_up_task: e.target.value })} className={inputCls} /></Field>
        <Btn onClick={logCall} disabled={busy} data-testid="call-save" className="mt-1 w-full justify-center">Save Call</Btn>
      </Modal>

      <Modal open={modal === "text"} onClose={() => setModal(null)} title="Send Text">
        <p className="mb-2 text-sm text-slate-500">To: <b>{lead.phone || "no phone on file"}</b></p>
        <div className="mb-2"><Btn variant="dark" data-testid="text-ai-draft" onClick={aiDraftText} disabled={ai.busy}><Sparkles className="h-4 w-4" /> {ai.busy ? "Drafting…" : "AI Draft"}</Btn></div>
        <Field label="Message"><textarea data-testid="text-body" rows={4} value={text} onChange={(e) => setText(e.target.value)} className={inputCls} /></Field>
        <p className="mb-2 text-xs text-amber-600">SMS delivery activates when Twilio messaging is enabled; the message is logged to the timeline now.</p>
        <Btn onClick={sendText} data-testid="text-send" className="w-full justify-center">Send</Btn>
      </Modal>

      <Modal open={modal === "research"} onClose={() => setModal(null)} title="✨ AI Practice Research" wide>
        {ai.busy && <p className="py-6 text-center text-slate-400">Researching…</p>}
        {!ai.busy && ai.brief && <div data-testid="research-brief" className="whitespace-pre-wrap text-sm text-slate-700">{ai.brief}</div>}
      </Modal>

      <Modal open={modal === "agent"} onClose={() => setModal(null)} title="🤖 AI Agent — Review & Approve" wide>
        {agent.busy && <p className="py-6 text-center text-slate-400">Agent is analyzing this lead…</p>}
        {agent.plan?.error && <p className="py-4 text-center text-red-600">{agent.plan.error}</p>}
        {agent.plan && !agent.plan.error && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-400">AI Summary</p>
              <p className="text-sm text-slate-700">{agent.plan.summary}</p>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase text-slate-400">Recommended actions — approve what runs</p>
              <div className="space-y-2">
                {(agent.plan.next_actions || []).map((a, i) => (
                  <label key={i} data-testid={`agent-action-${i}`} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2">
                    <input type="checkbox" checked={!!agent.picked[i]} onChange={(e) => setAgent({ ...agent, picked: { ...agent.picked, [i]: e.target.checked } })} className="mt-1 h-4 w-4 accent-primary" />
                    <span className="min-w-0"><span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">{a.type}</span> <span className="text-sm text-slate-700">{a.value || a.label}</span></span>
                  </label>
                ))}
              </div>
            </div>
            {agent.plan.draft_email && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Draft email (sends only if the email action is approved)</p>
                <p className="text-sm font-semibold text-slate-800">{agent.plan.draft_email.subject}</p>
                <p className="whitespace-pre-wrap text-sm text-slate-600">{agent.plan.draft_email.body}</p>
              </div>
            )}
            {agent.plan.draft_sms && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Draft SMS</p>
                <p className="text-sm text-slate-600">{agent.plan.draft_sms}</p>
              </div>
            )}
            <Btn onClick={runAgentExecute} data-testid="agent-run" className="w-full justify-center"><Check className="h-4 w-4" /> Approve & Run</Btn>
          </div>
        )}
      </Modal>
    </div>
  );
}
