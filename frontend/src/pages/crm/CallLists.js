import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Btn, Modal, Field, inputCls, TierPill, ProbabilityBadge, money } from "@/components/crm/kit";
import { PageHeader } from "@/components/crm/CrmShell";
import { PhoneCall, Plus, SkipForward, CheckCircle2 } from "lucide-react";

const DISPOS = ["Connected", "No Answer", "Left Voicemail", "Busy", "Interested", "Follow-Up", "Meeting Scheduled", "Not Interested", "Do Not Call"];

export default function CallLists() {
  const nav = useNavigate();
  const [lists, setLists] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("GREEN");
  const [active, setActive] = useState(null); // {id, current}
  const [dispo, setDispo] = useState("Connected");
  const [notes, setNotes] = useState("");

  const load = () => api.get("/crm/call-lists").then((r) => setLists(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return toast.error("Name required");
    try { await api.post("/crm/call-lists", { name, filter: { tier_340b: tier } }); toast.success("Call list created"); setOpen(false); setName(""); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const start = useCallback(async (id) => {
    const r = await api.get(`/crm/call-lists/${id}/current`);
    setActive({ id, ...r.data });
  }, []);
  const saveNext = async () => {
    const lead = active.lead;
    if (lead) {
      try { await api.post(`/crm/leads/${lead.id}/call`, { disposition: dispo, notes: notes || null }); } catch { /* ignore */ }
    }
    await api.post(`/crm/call-lists/${active.id}/advance`);
    setNotes(""); setDispo("Connected");
    const r = await api.get(`/crm/call-lists/${active.id}/current`);
    setActive({ id: active.id, ...r.data });
    load();
  };

  if (active) {
    const lead = active.lead;
    return (
      <div>
        <PageHeader title="Call Queue" subtitle={`Physician ${active.position || active.total} of ${active.total}`}>
          <Btn variant="ghost" onClick={() => { setActive(null); load(); }}>Exit queue</Btn>
        </PageHeader>
        <div className="mx-auto max-w-2xl p-6">
          {active.done ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-20 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><p className="mt-3 font-display text-lg font-bold text-slate-700">Queue complete!</p></div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6" data-testid="queue-card">
              <div className="flex items-center gap-2">
                {lead.medicare_match_status === "matched" && <ProbabilityBadge snapshot={lead.medicare_snapshot} />}
                <span className="font-mono text-xs text-slate-400">{lead.lead_number}</span>
              </div>
              <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">{lead.org_name || `${lead.contact_first || ""} ${lead.contact_last || ""}`}</h2>
              <p className="text-sm text-slate-500">{[(lead.medicare_snapshot || {}).specialty || lead.specialty, [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p>
              <p className="mt-1 text-lg font-bold text-primary">{lead.phone || "No phone"}</p>
              {lead.medicare_match_status === "matched" && (
                <div className="mt-3 flex gap-2"><TierPill kind="340B" tier={(lead.medicare_snapshot || {}).tier_340b} /><TierPill kind="RPM" tier={(lead.medicare_snapshot || {}).tier_rpm} /><span className="text-sm text-slate-500">{money((lead.medicare_snapshot || {}).tot_cost)} drug cost</span></div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Field label="Disposition"><select data-testid="queue-dispo" value={dispo} onChange={(e) => setDispo(e.target.value)} className={inputCls}>{DISPOS.map((d) => <option key={d}>{d}</option>)}</select></Field>
                <Field label="Notes"><input data-testid="queue-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
              </div>
              <div className="mt-3 flex gap-2">
                <Btn onClick={saveNext} data-testid="queue-save-next" className="flex-1 justify-center"><CheckCircle2 className="h-4 w-4" /> Save &amp; Next</Btn>
                <Btn variant="ghost" onClick={async () => { await api.post(`/crm/call-lists/${active.id}/advance`); const r = await api.get(`/crm/call-lists/${active.id}/current`); setActive({ id: active.id, ...r.data }); }} data-testid="queue-skip"><SkipForward className="h-4 w-4" /> Skip</Btn>
                <Btn variant="ghost" onClick={() => nav(`/crm/leads/${lead.id}`)}>Open</Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Smart Call Lists" subtitle="Focused calling queues that auto-advance">
        <Btn onClick={() => setOpen(true)} data-testid="cl-create-btn"><Plus className="h-4 w-4" /> New Call List</Btn>
      </PageHeader>
      <div className="space-y-3 p-6">
        {lists.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center"><PhoneCall className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-2 font-semibold text-slate-500">No call lists yet</p></div>}
        {lists.map((cl) => (
          <div key={cl.id} data-testid="cl-card" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
            <div><p className="font-display font-bold text-slate-900">{cl.name}</p><p className="text-sm text-slate-500">{cl.lead_ids.length} leads · {cl.remaining} remaining</p></div>
            <Btn onClick={() => start(cl.id)} data-testid="cl-start"><PhoneCall className="h-4 w-4" /> Start Calling</Btn>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New Call List">
        <Field label="Name"><input data-testid="cl-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="Build from 340B tier"><select data-testid="cl-tier" value={tier} onChange={(e) => setTier(e.target.value)} className={inputCls}>{["GREEN", "YELLOW", "BLUE", "RED"].map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Btn onClick={create} data-testid="cl-save" className="mt-2 w-full justify-center">Create</Btn>
      </Modal>
    </div>
  );
}
