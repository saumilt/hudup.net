import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, Modal, Field, inputCls, money } from "@/components/crm/kit";
import { Network, Plus, MapPin, Shuffle, BarChart3, Scale } from "lucide-react";

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
  const [ams, setAms] = useState([]);
  const [teams, setTeams] = useState([]);
  const [terrs, setTerrs] = useState([]);
  const [att, setAtt] = useState([]);
  const [bal, setBal] = useState(null);
  const [scope, setScope] = useState("am");
  const [modal, setModal] = useState(null);
  const [team, setTeam] = useState({ name: "", member_ids: [] });
  const [terr, setTerr] = useState({ name: "", states: "", specialties: "", team_id: "" });

  const load = useCallback(async () => {
    const [a, t, tr, q, b] = await Promise.all([
      api.get("/users?role=account_manager"), api.get("/crm/teams"),
      api.get("/crm/territories"), api.get("/crm/quotas/attainment"),
      api.get("/crm/routing/balance", { params: { scope } }),
    ]);
    setAms(a.data); setTeams(t.data); setTerrs(tr.data); setAtt(q.data); setBal(b.data);
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  const createTeam = async () => {
    if (!team.name.trim() || !team.member_ids.length) return toast.error("Name and at least one member");
    try { await api.post("/crm/teams", team); toast.success("Team created"); setModal(null); setTeam({ name: "", member_ids: [] }); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const createTerr = async () => {
    if (!terr.name.trim() || !terr.team_id) return toast.error("Name and team required");
    try {
      await api.post("/crm/territories", {
        name: terr.name, team_id: terr.team_id,
        states: terr.states.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
        specialties: terr.specialties.split(",").map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Territory created"); setModal(null); setTerr({ name: "", states: "", specialties: "", team_id: "" }); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const routeUnassigned = async () => {
    try { const r = await api.post("/crm/leads/route-unassigned"); toast.success(`Routed ${r.data.routed} lead(s)`); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const rebalance = async () => {
    try { const r = await api.post("/crm/routing/rebalance"); toast.success(r.data.moved ? `Rebalanced ${r.data.moved} lead(s)` : "Already balanced"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const saveQuota = async (row, patch) => {
    try { await api.put("/crm/quotas", { user_id: row.user_id, leads_target: row.leads_target, meetings_target: row.meetings_target, opps_target: row.opps_target, revenue_target: row.revenue_target, ...patch }); toast.success("Quota saved"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "—";

  return (
    <div>
      <PageHeader title="Teams & Territories" subtitle="Hierarchy, round-robin routing and quotas">
        <Btn variant="ghost" onClick={routeUnassigned} data-testid="route-unassigned"><Shuffle className="h-4 w-4" /> Route Unassigned</Btn>
        <Btn onClick={() => setModal("terr")} data-testid="terr-create-btn"><MapPin className="h-4 w-4" /> New Territory</Btn>
        <Btn onClick={() => setModal("team")} data-testid="team-create-btn"><Plus className="h-4 w-4" /> New Team</Btn>
      </PageHeader>
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><Network className="h-4 w-4 text-primary" /> Teams</h2>
          {teams.length === 0 ? <p className="text-sm text-slate-400">No teams yet.</p> :
            teams.map((t) => (
              <div key={t.id} data-testid="team-card" className="border-b border-slate-50 py-2">
                <p className="font-semibold text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-400">{(t.member_ids || []).length} member(s)</p>
              </div>
            ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-slate-900"><MapPin className="h-4 w-4 text-primary" /> Territories</h2>
          {terrs.length === 0 ? <p className="text-sm text-slate-400">No territories yet.</p> :
            terrs.map((t) => (
              <div key={t.id} data-testid="terr-card" className="border-b border-slate-50 py-2">
                <p className="font-semibold text-slate-800">{t.name} <span className="text-xs font-normal text-slate-400">→ {teamName(t.team_id)}</span></p>
                <p className="text-xs text-slate-400">{[(t.states || []).join(", "), (t.specialties || []).join(", ")].filter(Boolean).join(" · ") || "All"}</p>
              </div>
            ))}
        </div>
      </div>
      <div className="px-6 pb-6">
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

      <Modal open={modal === "team"} onClose={() => setModal(null)} title="New Team">
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
        <Btn onClick={createTeam} data-testid="team-save" className="mt-2 w-full justify-center">Create Team</Btn>
      </Modal>

      <Modal open={modal === "terr"} onClose={() => setModal(null)} title="New Territory">
        <Field label="Territory name"><input data-testid="terr-name" value={terr.name} onChange={(e) => setTerr({ ...terr, name: e.target.value })} className={inputCls} /></Field>
        <Field label="States (comma-separated, e.g. TX, OK)"><input value={terr.states} onChange={(e) => setTerr({ ...terr, states: e.target.value })} className={inputCls} /></Field>
        <Field label="Specialties (comma-separated)"><input value={terr.specialties} onChange={(e) => setTerr({ ...terr, specialties: e.target.value })} className={inputCls} /></Field>
        <Field label="Assign to team">
          <select data-testid="terr-team" value={terr.team_id} onChange={(e) => setTerr({ ...terr, team_id: e.target.value })} className={inputCls}>
            <option value="">Select team…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Btn onClick={createTerr} data-testid="terr-save" className="mt-2 w-full justify-center">Create Territory</Btn>
      </Modal>
    </div>
  );
}
