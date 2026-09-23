import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, Modal, Field, inputCls, money } from "@/components/crm/kit";
import { Network, Plus, MapPin, Shuffle, BarChart3, Scale, Pencil, Trash2, Clock, Send, Eye } from "lucide-react";

function Bar({ actual, target, fmt }) {
  const pct = target ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <span className="text-xs text-slate-500">{fmt ? money(actual) : actual}/{fmt ? money(target) : target}</span>
    </div>
  );
}

export default function Teams() {
  const { user } = useAuth();
  const isAdmin = ["admin", "super_admin"].includes(user?.role);
  const [ams, setAms] = useState([]);
  const [teams, setTeams] = useState([]);
  const [terrs, setTerrs] = useState([]);
  const [att, setAtt] = useState([]);
  const [bal, setBal] = useState(null);
  const [scope, setScope] = useState("am");
  const [modal, setModal] = useState(null);
  const [team, setTeam] = useState({ name: "", member_ids: [] });
  const [terr, setTerr] = useState({ name: "", states: "", specialties: "", team_id: "" });
  const [teamEditId, setTeamEditId] = useState(null);
  const [terrEditId, setTerrEditId] = useState(null);
  const [digest, setDigest] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    const [a, t, tr, q, b, d] = await Promise.all([
      api.get("/users?role=account_manager"), api.get("/crm/teams"),
      api.get("/crm/territories"), api.get("/crm/quotas/attainment"),
      api.get("/crm/routing/balance", { params: { scope } }),
      api.get("/crm/notifications/digest/settings").catch(() => ({ data: null })),
    ]);
    setAms(a.data); setTeams(t.data); setTerrs(tr.data); setAtt(q.data); setBal(b.data);
    if (d.data) setDigest(d.data);
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  const openNewTeam = () => { setTeamEditId(null); setTeam({ name: "", member_ids: [] }); setModal("team"); };
  const openEditTeam = (t) => { setTeamEditId(t.id); setTeam({ name: t.name, member_ids: t.member_ids || [] }); setModal("team"); };
  const saveTeam = async () => {
    if (!team.name.trim() || !team.member_ids.length) return toast.error("Name and at least one member");
    try {
      if (teamEditId) { await api.patch(`/crm/teams/${teamEditId}`, team); toast.success("Team updated"); }
      else { await api.post("/crm/teams", team); toast.success("Team created"); }
      setModal(null); setTeamEditId(null); setTeam({ name: "", member_ids: [] }); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const deleteTeam = async (t) => {
    if (!window.confirm(`Delete team "${t.name}"? Its territories will also be removed.`)) return;
    try { await api.delete(`/crm/teams/${t.id}`); toast.success("Team deleted"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const openNewTerr = () => { setTerrEditId(null); setTerr({ name: "", states: "", specialties: "", team_id: "" }); setModal("terr"); };
  const openEditTerr = (t) => { setTerrEditId(t.id); setTerr({ name: t.name, states: (t.states || []).join(", "), specialties: (t.specialties || []).join(", "), team_id: t.team_id || "" }); setModal("terr"); };
  const saveTerr = async () => {
    if (!terr.name.trim() || !terr.team_id) return toast.error("Name and team required");
    const payload = {
      name: terr.name, team_id: terr.team_id,
      states: terr.states.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      specialties: terr.specialties.split(",").map((s) => s.trim()).filter(Boolean),
    };
    try {
      if (terrEditId) { await api.patch(`/crm/territories/${terrEditId}`, payload); toast.success("Territory updated"); }
      else { await api.post("/crm/territories", payload); toast.success("Territory created"); }
      setModal(null); setTerrEditId(null); setTerr({ name: "", states: "", specialties: "", team_id: "" }); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const deleteTerr = async (t) => {
    if (!window.confirm(`Delete territory "${t.name}"?`)) return;
    try { await api.delete(`/crm/territories/${t.id}`); toast.success("Territory deleted"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const routeUnassigned = async () => {
    try { const r = await api.post("/crm/leads/route-unassigned"); toast.success(`Routed ${r.data.routed} lead(s)`); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const rebalance = async () => {
    try { const r = await api.post("/crm/routing/rebalance"); toast.success(r.data.moved ? `Rebalanced ${r.data.moved} lead(s)` : "Already balanced"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const routeByTerritory = async () => {
    if (!window.confirm("Route every unassigned lead to its matching territory's team?")) return;
    try {
      const r = await api.post("/crm/leads/route-by-territory");
      toast.success(`Routed ${r.data.routed} to their territory team${r.data.skipped ? ` · ${r.data.skipped} skipped (no matching territory)` : ""}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const openDigestPreview = async () => {
    try { const r = await api.get("/crm/notifications/digest/preview"); setPreview(r.data); setModal("digest-preview"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const saveQuota = async (row, patch) => {
    try { await api.put("/crm/quotas", { user_id: row.user_id, leads_target: row.leads_target, meetings_target: row.meetings_target, opps_target: row.opps_target, revenue_target: row.revenue_target, ...patch }); toast.success("Quota saved"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "—";

  const saveDigest = async () => {
    try {
      const r = await api.put("/crm/notifications/digest/settings", {
        enabled: digest.enabled, hour: Number(digest.hour), minute: Number(digest.minute), tz: digest.tz,
      });
      setDigest(r.data); toast.success("Digest schedule saved");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const sendDigestNow = async () => {
    try { const r = await api.post("/crm/notifications/digest/run"); toast.success(`Digest sent to ${r.data.reps_notified} rep(s) · ${r.data.total_leads} lead(s)`); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const TZ_OPTS = [
    ["America/New_York", "Eastern (New York)"], ["America/Chicago", "Central (Chicago)"],
    ["America/Denver", "Mountain (Denver)"], ["America/Los_Angeles", "Pacific (Los Angeles)"],
    ["America/Phoenix", "Arizona (Phoenix)"], ["UTC", "UTC"],
  ];

  return (
    <div>
      <PageHeader title="Teams & Territories" subtitle="Hierarchy, round-robin routing and quotas">
        <Btn variant="ghost" onClick={routeByTerritory} data-testid="route-by-territory"><MapPin className="h-4 w-4" /> Territory Rebalance</Btn>
        <Btn variant="ghost" onClick={routeUnassigned} data-testid="route-unassigned"><Shuffle className="h-4 w-4" /> Route Unassigned</Btn>
        <Btn onClick={openNewTerr} data-testid="terr-create-btn"><MapPin className="h-4 w-4" /> New Territory</Btn>
        <Btn onClick={openNewTeam} data-testid="team-create-btn"><Plus className="h-4 w-4" /> New Team</Btn>
      </PageHeader>
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><Network className="h-4 w-4 text-primary" /> Teams</h2>
          {teams.length === 0 ? <p className="text-sm text-slate-400">No teams yet.</p> :
            teams.map((t) => (
              <div key={t.id} data-testid="team-card" className="flex items-center justify-between border-b border-slate-50 py-2">
                <div>
                  <p className="font-semibold text-slate-800">{t.name}</p>
                  <p className="text-xs text-slate-400">{(t.member_ids || []).length} member(s){t.members?.length ? ` · ${t.members.map((m) => m.name).join(", ")}` : ""}</p>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <Btn variant="ghost" onClick={() => openEditTeam(t)} data-testid={`team-edit-${t.id}`}><Pencil className="h-3.5 w-3.5" /> Edit</Btn>
                  <Btn variant="ghost" onClick={() => deleteTeam(t)} data-testid={`team-delete-${t.id}`}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Btn>
                </div>
              </div>
            ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><MapPin className="h-4 w-4 text-primary" /> Territories</h2>
          {terrs.length === 0 ? <p className="text-sm text-slate-400">No territories yet.</p> :
            terrs.map((t) => (
              <div key={t.id} data-testid="terr-card" className="flex items-center justify-between border-b border-slate-50 py-2">
                <div>
                  <p className="font-semibold text-slate-800">{t.name} <span className="text-xs font-normal text-slate-400">→ {teamName(t.team_id)}</span></p>
                  <p className="text-xs text-slate-400">{[(t.states || []).join(", "), (t.specialties || []).join(", ")].filter(Boolean).join(" · ") || "All"}</p>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <Btn variant="ghost" onClick={() => openEditTerr(t)} data-testid={`terr-edit-${t.id}`}><Pencil className="h-3.5 w-3.5" /> Edit</Btn>
                  <Btn variant="ghost" onClick={() => deleteTerr(t)} data-testid={`terr-delete-${t.id}`}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Btn>
                </div>
              </div>
            ))}
        </div>
      </div>
      <div className="px-6 pb-6">
        {digest && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5" data-testid="digest-settings">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display font-bold text-slate-900"><Clock className="h-4 w-4 text-primary" /> Daily Assignment Digest</h2>
              <div className="flex flex-shrink-0 gap-1">
                <Btn variant="ghost" onClick={openDigestPreview} data-testid="digest-preview-btn"><Eye className="h-4 w-4" /> Preview</Btn>
                <Btn variant="ghost" onClick={sendDigestNow} data-testid="digest-send-now"><Send className="h-4 w-4" /> Send now</Btn>
              </div>
            </div>
            <p className="mb-4 text-sm text-slate-500">One summary email per rep of the leads assigned to them each day. {isAdmin ? "Pick when it goes out." : "Only admins can change the schedule."}</p>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" data-testid="digest-enabled" disabled={!isAdmin} checked={!!digest.enabled} onChange={(e) => setDigest({ ...digest, enabled: e.target.checked })} className="h-4 w-4 accent-primary" /> Enabled
              </label>
              <Field label="Hour (0–23)"><input data-testid="digest-hour" type="number" min={0} max={23} disabled={!isAdmin} value={digest.hour} onChange={(e) => setDigest({ ...digest, hour: e.target.value })} className={`${inputCls} w-24`} /></Field>
              <Field label="Minute"><input data-testid="digest-minute" type="number" min={0} max={59} disabled={!isAdmin} value={digest.minute} onChange={(e) => setDigest({ ...digest, minute: e.target.value })} className={`${inputCls} w-24`} /></Field>
              <Field label="Timezone">
                <select data-testid="digest-tz" disabled={!isAdmin} value={digest.tz} onChange={(e) => setDigest({ ...digest, tz: e.target.value })} className={`${inputCls} w-52`}>
                  {TZ_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              {isAdmin && <Btn onClick={saveDigest} data-testid="digest-save">Save schedule</Btn>}
            </div>
            <p className="mt-3 text-xs text-slate-400">Currently: {digest.enabled ? `sends at ${String(digest.hour).padStart(2, "0")}:${String(digest.minute).padStart(2, "0")} ${digest.tz}` : "disabled"}.</p>
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-display font-bold text-slate-900">Quota Attainment (this month)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1">Rep</th><th>Leads</th><th>Meetings</th><th>Opps</th><th>Revenue</th><th>Targets (edit)</th>
              </tr></thead>
              <tbody>
                {att.map((r) => (
                  <tr key={r.user_id} data-testid="quota-row" className="border-t border-slate-50">
                    <td className="py-2 font-semibold text-slate-700">{r.name}</td>
                    <td><Bar actual={r.leads} target={r.leads_target} /></td>
                    <td><Bar actual={r.meetings} target={r.meetings_target} /></td>
                    <td><Bar actual={r.opps} target={r.opps_target} /></td>
                    <td><Bar actual={r.revenue} target={r.revenue_target} fmt /></td>
                    <td>
                      <input data-testid="quota-revenue" type="number" defaultValue={r.revenue_target} onBlur={(e) => saveQuota(r, { revenue_target: Number(e.target.value) })} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" placeholder="Revenue target" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {bal && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5" data-testid="rr-balance">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display font-bold text-slate-900"><BarChart3 className="h-4 w-4 text-primary" /> Lead Distribution</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                  <button data-testid="rr-scope-am" onClick={() => setScope("am")} className={scope === "am" ? "rounded bg-primary px-2.5 py-1 font-bold text-white" : "px-2.5 py-1 text-slate-500"}>Reps</button>
                  <button data-testid="rr-scope-all" onClick={() => setScope("all")} className={scope === "all" ? "rounded bg-primary px-2.5 py-1 font-bold text-white" : "px-2.5 py-1 text-slate-500"}>All owners</button>
                </div>
                <Btn variant="ghost" onClick={rebalance} data-testid="rr-rebalance"><Scale className="h-4 w-4" /> Even out</Btn>
              </div>
            </div>
            <div className="mb-3 flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-primary" /> This month ({bal.month_total})</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-slate-300" /> Last month ({bal.prev_total})</span>
              {bal.unassigned > 0 && <span>· {bal.unassigned} unassigned</span>}
            </div>
            {bal.reps.length === 0 ? <p className="text-sm text-slate-400">No reps yet.</p> : (
              <div className="space-y-3">
                {bal.reps.map((r) => {
                  const pct = bal.month_total ? Math.round((r.leads / bal.month_total) * 100) : 0;
                  const w = bal.max ? Math.round((r.leads / bal.max) * 100) : 0;
                  const pw = bal.max ? Math.round((r.prev / bal.max) * 100) : 0;
                  return (
                    <div key={r.user_id} data-testid="rr-row" className="flex items-center gap-3 text-sm">
                      <span className="flex w-40 items-center gap-1 truncate font-semibold text-slate-700">
                        {r.name}
                        {r.role === "lead_manager" && <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-400">Mgr</span>}
                      </span>
                      <div className="flex-1 space-y-1">
                        <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-primary" style={{ width: `${w}%` }} /></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-50"><div className="h-full bg-slate-300" style={{ width: `${pw}%` }} /></div>
                      </div>
                      <span className="w-24 text-right text-xs text-slate-500">{r.leads} · {pct}%<span className="block text-slate-300">last mo {r.prev}</span></span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">{bal.month_total === 0 ? "No leads assigned yet this month." : bal.spread === 0 ? "Evenly balanced across reps this month." : `Spread of ${bal.spread} lead(s) between the busiest and quietest rep. Tap “Even out” to redistribute unworked leads.`}</p>
          </div>
        )}
      </div>

      <Modal open={modal === "team"} onClose={() => { setModal(null); setTeamEditId(null); }} title={teamEditId ? "Edit Team" : "New Team"}>
        <Field label="Team name"><input data-testid="team-name" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} className={inputCls} /></Field>
        <Field label="Members (Account Managers)">
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {ams.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={team.member_ids.includes(a.id)} onChange={(e) => setTeam({ ...team, member_ids: e.target.checked ? [...team.member_ids, a.id] : team.member_ids.filter((x) => x !== a.id) })} className="h-4 w-4 accent-primary" />
                {a.name}
              </label>
            ))}
          </div>
        </Field>
        <Btn onClick={saveTeam} data-testid="team-save" className="mt-2 w-full justify-center">{teamEditId ? "Save Changes" : "Create Team"}</Btn>
      </Modal>

      <Modal open={modal === "terr"} onClose={() => { setModal(null); setTerrEditId(null); }} title={terrEditId ? "Edit Territory" : "New Territory"}>
        <Field label="Territory name"><input data-testid="terr-name" value={terr.name} onChange={(e) => setTerr({ ...terr, name: e.target.value })} className={inputCls} /></Field>
        <Field label="States (comma-separated, e.g. TX, OK)"><input value={terr.states} onChange={(e) => setTerr({ ...terr, states: e.target.value })} className={inputCls} /></Field>
        <Field label="Specialties (comma-separated)"><input value={terr.specialties} onChange={(e) => setTerr({ ...terr, specialties: e.target.value })} className={inputCls} /></Field>
        <Field label="Assign to team">
          <select data-testid="terr-team" value={terr.team_id} onChange={(e) => setTerr({ ...terr, team_id: e.target.value })} className={inputCls}>
            <option value="">Select team…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Btn onClick={saveTerr} data-testid="terr-save" className="mt-2 w-full justify-center">{terrEditId ? "Save Changes" : "Create Territory"}</Btn>
      </Modal>

      <Modal open={modal === "digest-preview"} onClose={() => setModal(null)} title="Digest Preview — last 24h">
        {preview && (
          <div className="space-y-3" data-testid="digest-preview">
            <p className="text-sm text-slate-500">{preview.total_leads} lead(s) across {preview.reps.length} rep(s) assigned in the last {preview.window_hours}h. This is exactly what each rep will receive.</p>
            {preview.reps.length === 0 && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-400" data-testid="digest-preview-empty">No leads were assigned in the window — no emails would go out.</p>}
            {preview.reps.map((r) => (
              <div key={r.rep_id} className="rounded-lg border border-slate-200 p-3" data-testid={`digest-preview-rep-${r.rep_id}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">{r.rep_name}</span>
                  <span className="text-xs text-slate-400">{r.email || "no email on file"}</span>
                </div>
                <p className="mb-2 text-xs font-semibold text-primary">{r.count} new lead(s)</p>
                <ul className="space-y-1 text-sm text-slate-600">
                  {r.leads.slice(0, 25).map((l) => (
                    <li key={l.id}><span className="font-mono text-xs text-slate-400">{l.lead_number}</span> {l.name} <span className="text-slate-400">({l.tier} 340B)</span></li>
                  ))}
                </ul>
                {r.count > 25 && <p className="mt-1 text-xs text-slate-400">…and {r.count - 25} more.</p>}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
