import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, money } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { TIER_STYLES } from "@/components/TierBadge";
import { ArrowLeft, Loader2, UserPlus, CalendarClock, PhoneCall, Save, StickyNote, Layers } from "lucide-react";
import { APP_VERSION } from "@/version";
import { toast } from "sonner";

export default function LeadDetail() {
  const { leadId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [lead, setLead] = useState(null);
  const [note, setNote] = useState("");
  const [callback, setCallback] = useState("");
  const [appt, setAppt] = useState("");

  const load = async () => {
    const r = await api.get(`/dashboard/leads/${leadId}`);
    if (r.data.error) return;
    setLead(r.data);
    setCallback(r.data.callback_date || "");
    setAppt(r.data.appointment_at || "");
  };
  useEffect(() => { load(); }, [leadId]);

  if (!lead)
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const med = lead.medicare || {};
  const s340 = TIER_STYLES[lead.tier_340b] || TIER_STYLES.GREY;
  const srpm = TIER_STYLES[lead.tier_rpm] || TIER_STYLES.GREY;

  const assign = async () => { await api.post(`/dashboard/leads/${lead.id}/assign`, { assigned_to: user.name }); toast.success("Assigned to you"); load(); };
  const addNote = async () => { if (!note.trim()) return; await api.post(`/dashboard/leads/${lead.id}/note`, { text: note }); setNote(""); toast.success("Note added"); load(); };
  const saveSchedule = async () => { await api.post(`/dashboard/leads/${lead.id}/schedule`, { callback_date: callback || null, appointment_at: appt || null }); toast.success("Schedule saved"); load(); };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <button data-testid="lead-back" onClick={() => nav("/dashboard")} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="font-display text-lg font-bold">Lead Detail</h1>
        <span data-testid="app-version" className="ml-auto rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-400">v{APP_VERSION}</span>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        {/* tier bands */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex h-3">
            <div className="flex-1" style={{ backgroundColor: lead.color_340b || "#cbd5e1" }} />
            <div className="flex-1" style={{ backgroundColor: lead.color_rpm || "#cbd5e1" }} />
          </div>
          <div className="p-5">
            <h2 className="font-display text-2xl font-bold text-slate-900">Dr. {lead.first_name} {lead.last_name}</h2>
            <p className="text-slate-500">{lead.specialty || "Unknown specialty"} · {lead.city || "?"} {lead.state || ""}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-sm font-bold ${s340.chip}`}>340B {lead.shade_340b || lead.tier_340b}</span>
              <span className={`rounded-full px-3 py-1 text-sm font-bold ${srpm.chip}`}>RPM {lead.tier_rpm}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">Match: {lead.match_status}</span>
            </div>
            {(lead.tier_340b !== "GREY") && (
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Metric label="Total Claims" v={med.tot_clms != null ? Number(med.tot_clms).toLocaleString() : "—"} />
                <Metric label="Total Drug Cost" v={money(med.tot_cost)} />
                <Metric label="Avg Per Claim" v={money(med.avg_per_claim)} />
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600">
              <p><span className="text-slate-400">NPI:</span> {lead.npi || "—"}</p>
              <p><span className="text-slate-400">Practice:</span> {lead.practice || "—"}</p>
              <p><span className="text-slate-400">Practice type:</span> {lead.practice_type || "—"}</p>
              <p><span className="text-slate-400">Phone:</span> {lead.phone || "—"}</p>
              <p><span className="text-slate-400">Email:</span> {lead.email || "—"}</p>
              <p><span className="text-slate-400">Associate:</span> {lead.associate_name || "—"}</p>
              <p><span className="text-slate-400">Assigned:</span> {lead.assigned_to || "—"}</p>
            </div>
            {lead.interests?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {lead.interests.map((i) => <span key={i} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{i}</span>)}
              </div>
            )}
            <button data-testid="lead-assign" onClick={assign} className="mt-4 flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white active:scale-95"><UserPlus className="h-4 w-4" /> Assign to me</button>
          </div>
        </div>

        {/* All captured CMS columns */}
        {lead.cms_extra && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-1 flex items-center gap-2 font-display font-bold"><Layers className="h-5 w-5 text-primary" /> All CMS Columns</h3>
            <p className="mb-3 text-xs text-slate-400">Aggregated across {lead.cms_extra.row_count ?? "—"} drug rows for this NPI. Numeric measures are summed; categorical fields show the recorded value.</p>
            {Object.keys(lead.cms_extra.extra || {}).length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Summed measures</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(lead.cms_extra.extra).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-slate-50 p-2">
                      <p className="truncate text-[10px] uppercase text-slate-400" title={k}>{k}</p>
                      <p className="text-sm font-bold text-slate-800">{typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(lead.cms_extra.raw || {}).length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Recorded fields</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(lead.cms_extra.raw).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-slate-50 p-2">
                      <p className="truncate text-[10px] uppercase text-slate-400" title={k}>{k}</p>
                      <p className="truncate text-sm font-medium text-slate-700" title={String(v)}>{String(v)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scheduling */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 flex items-center gap-2 font-display font-bold"><CalendarClock className="h-5 w-5 text-primary" /> Follow-up</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-500"><PhoneCall className="h-3.5 w-3.5" /> Call-back date</label>
              <input data-testid="lead-callback" type="date" value={callback} onChange={(e) => setCallback(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> Appointment date &amp; time</label>
              <input data-testid="lead-appointment" type="datetime-local" value={appt} onChange={(e) => setAppt(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <button data-testid="save-schedule" onClick={saveSchedule} className="mt-3 flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white active:scale-95"><Save className="h-4 w-4" /> Save Follow-up</button>
        </div>

        {/* Notes */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 flex items-center gap-2 font-display font-bold"><StickyNote className="h-5 w-5 text-primary" /> Notes</h3>
          <div className="mb-3 space-y-2">
            {(lead.notes || []).length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
            {(lead.notes || []).map((n, i) => (
              <div key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="text-slate-700">{n.text}</p>
                <p className="mt-1 text-xs text-slate-400">{n.by} · {new Date(n.at).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input data-testid="note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button data-testid="add-note" onClick={addNote} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, v }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <p className="text-lg font-bold text-slate-900">{v}</p>
      <p className="text-[10px] uppercase text-slate-400">{label}</p>
    </div>
  );
}
