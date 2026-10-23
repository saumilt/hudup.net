import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { TierPill, money, Btn, Field, inputCls, EmptyState, Modal } from "@/components/crm/kit";
import { Search, MapPin, Bookmark, Trash2, Plus, Users2, ChevronLeft, ChevronRight, Stethoscope, BarChart3, Compass, Award } from "lucide-react";
import CoverageMap from "@/components/crm/CoverageMap";
import RadiusControls, { effectiveMiles, radiusLabel } from "@/components/crm/RadiusControls";

const COLORS = ["GREEN", "YELLOW", "BLUE", "RED"];
const TIERS = ["", "GREEN", "YELLOW", "BLUE", "RED"];

const canon = (text) => {
  const t = (text || "").trim();
  if (!t) return {};
  if (/^\d{5}$/.test(t)) return { zip: t };
  const m = t.match(/^(.+),\s*([A-Za-z]{2})$/);
  if (m) return { city: m[1].trim(), state: m[2].trim() };
  return { address: t };
};
const toOrigin = (c) => ({ origin_address: c.address, origin_city: c.city, origin_state: c.state, origin_zip: c.zip });

const EMPTY = {
  name: "", source_type: "doctor", profession: "", source_note: "",
  doctor_npi: "", doctor_cap: null, doctor_stats: null,
  origin: "", radius: { mode: "mi", miles: 25, driveMin: 0, mph: 45 }, specialty: "", tiers: [], tier_rpm: "",
};

const capColor = (lvl) =>
  lvl === "High" ? "bg-emerald-100 text-emerald-700"
    : lvl === "Medium" ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-500";

export default function ReferralSearch() {
  const nav = useNavigate();
  const [tab, setTab] = useState("search"); // search | report
  const [gen, setGen] = useState(EMPTY);
  const [loadedId, setLoadedId] = useState(null);
  const [origin, setOrigin] = useState(null);
  const [cities, setCities] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [view, setView] = useState("list");
  const [data, setData] = useState({ results: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState([]);
  const [counts, setCounts] = useState({});
  const [perf, setPerf] = useState([]);
  const [perfTotals, setPerfTotals] = useState(null);
  const [produced, setProduced] = useState(null); // { name, leads }

  // doctor lookup
  const [dq, setDq] = useState("");
  const [dres, setDres] = useState([]);
  const [dopen, setDopen] = useState(false);
  const [dbusy, setDbusy] = useState(false);
  const dtimer = useRef(null);

  const loadSaved = useCallback(() => {
    api.get("/crm/saved-searches", { params: { entity: "referral" } }).then((r) => setSaved(r.data)).catch(() => {});
    api.get("/crm/referral-generators/counts").then((r) => setCounts(r.data)).catch(() => {});
    api.get("/crm/referral-performance").then((r) => { setPerf(r.data.rows || []); setPerfTotals(r.data.totals || null); }).catch(() => {});
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const onDoctorQuery = (val) => {
    setDq(val); setDopen(true);
    if (dtimer.current) clearTimeout(dtimer.current);
    if ((val || "").trim().length < 2) { setDres([]); return; }
    dtimer.current = setTimeout(async () => {
      setDbusy(true);
      try { const r = await api.get("/medicare/physicians/lookup", { params: { q: val.trim() } }); setDres(r.data.results || []); }
      catch { setDres([]); }
      finally { setDbusy(false); }
    }, 300);
  };
  const pickDoctor = (r) => {
    const dname = `Dr. ${r.first_name || ""} ${r.last_name || ""}`.trim() + (r.specialty ? ` — ${r.specialty}` : "");
    setGen((g) => ({
      ...g, name: dname, origin: `${r.city}, ${r.state}`, specialty: r.specialty || g.specialty,
      doctor_npi: r.npi, doctor_cap: r.capability,
      doctor_stats: { tot_clms: r.tot_clms, tot_cost: r.tot_cost, tier_340b: r.tier_340b, tier_rpm: r.tier_rpm },
    }));
    setLoadedId(null);
    setDq(`Dr. ${r.first_name} ${r.last_name} · NPI ${r.npi}`);
    setDopen(false);
  };
  const setType = (t) => setGen((g) => ({ ...g, source_type: t, doctor_cap: null, doctor_stats: null, doctor_npi: "" }));

  const run = useCallback(async (p = 1, g = gen) => {
    const effMi = effectiveMiles(g.radius);
    if (!(g.origin || "").trim() || !effMi) { toast.error("Enter the referral source's practice address / city / ZIP and a radius"); return; }
    setLoading(true); setPage(p);
    try {
      const c = canon(g.origin);
      const payload = { ...toOrigin(c), radius_mi: effMi, specialty: g.specialty, tiers: g.tiers, tier_rpm: g.tier_rpm, page: p, page_size: 25 };
      const [res, srch, cov] = await Promise.all([
        api.post("/medicare/geo/resolve", { ...c, radius_mi: effMi }),
        api.post("/medicare/search", payload),
        api.post("/medicare/geo/coverage", payload),
      ]);
      setOrigin(res.data.origin); setCities(res.data.cities || []); setData(srch.data); setCoverage(cov.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Search failed");
    } finally { setLoading(false); }
  }, [gen]);

  const save = async () => {
    if (!(gen.origin || "").trim()) return toast.error("Enter a practice location first");
    const name = gen.name.trim() || window.prompt("Name this referral source (e.g. Dr. Smith — Cardiology):");
    if (!name) return;
    try {
      const r = await api.post("/crm/saved-searches", { name, entity: "referral", query: { ...gen, name } });
      setGen((x) => ({ ...x, name })); setLoadedId(r.data?.id || null);
      toast.success("Referral source saved"); loadSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const applySaved = (sv) => {
    const q = sv.query || {};
    const g = { ...EMPTY, ...q, radius: q.radius || { mode: "mi", miles: q.radius_mi || 25, driveMin: 0, mph: 45 } };
    setGen(g); setLoadedId(sv.id); setTab("search");
    setDq(g.doctor_npi ? `${g.name} · NPI ${g.doctor_npi}` : "");
    run(1, g);
  };
  const delSaved = async (sid) => {
    try { await api.delete(`/crm/saved-searches/${sid}`); toast.success("Removed"); loadSaved(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const viewProduced = async (sv) => {
    try {
      const r = await api.get("/crm/leads", { params: { referral_generator_id: sv.id, limit: 500 } });
      setProduced({ name: sv.name, leads: r.data });
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const createLead = async (row) => {
    try {
      const r = await api.post("/crm/leads", {
        contact_first: row.first_name, contact_last: row.last_name, source: "Referral Search",
        matched_npi: row.npi, dataset_year: row.dataset_year, specialty: row.specialty,
        city: row.city, state: row.state, priority: "Medium",
        referral_generator_id: loadedId, referral_generator_name: gen.name || (origin && origin.label) || null,
        tags: gen.name ? [`Referral: ${gen.name}`] : ["Referral partner"],
      });
      toast.success(`Lead ${r.data.lead_number} created`);
      row.crm = { status: r.data.status, id: r.data.id }; setData((d) => ({ ...d }));
      loadSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / 25));
  const track = loadedId ? perf.find((p) => p.id === loadedId) : null;
  const isDoctor = gen.source_type === "doctor";

  return (
    <div>
      <PageHeader title="Referral Search" subtitle="Find nearby doctors around a referral source's practice & track what they convert">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <button type="button" data-testid="rs-tab-search" onClick={() => setTab("search")} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold ${tab === "search" ? "bg-white text-primary shadow-sm" : "text-slate-500"}`}><Compass className="h-3.5 w-3.5" /> Find partners</button>
          <button type="button" data-testid="rs-tab-report" onClick={() => { setTab("report"); loadSaved(); }} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold ${tab === "report" ? "bg-white text-primary shadow-sm" : "text-slate-500"}`}><BarChart3 className="h-3.5 w-3.5" /> Performance</button>
        </div>
        {tab === "search" && <Btn variant="ghost" onClick={save} data-testid="rs-save"><Bookmark className="h-4 w-4" /> Save source</Btn>}
      </PageHeader>

      {tab === "report" ? (
        <div className="p-6">
          {perfTotals && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Sources", perfTotals.sources], ["Leads produced", perfTotals.leads], ["Opportunities", perfTotals.opportunities], ["Won / Accounts", perfTotals.won]].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs uppercase tracking-wider text-slate-400">{l}</p><p className="mt-1 text-2xl font-bold text-slate-900">{v}</p></div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" data-testid="rs-report-table">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr><th className="p-3">Referral source</th><th className="p-3">Type</th><th className="p-3">Leads</th><th className="p-3">Opportunities</th><th className="p-3">Won / Accounts</th><th className="p-3">Conversion</th><th className="p-3"></th></tr>
              </thead>
              <tbody>
                {perf.length === 0 && <tr><td colSpan={7}><EmptyState icon={BarChart3} title="No referral sources yet" hint="Save a referral source and add leads from it to see conversion performance here." /></td></tr>}
                {perf.map((r) => (
                  <tr key={r.id} data-testid={`rs-report-row-${r.id}`} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-3 font-semibold text-slate-800">{r.name}</td>
                    <td className="p-3">{r.source_type === "doctor" ? <span className="inline-flex items-center gap-1 text-slate-500"><Stethoscope className="h-3.5 w-3.5" /> Doctor</span> : <span className="text-slate-500">{r.profession || "Other"}</span>}</td>
                    <td className="p-3 font-bold text-slate-800">{r.leads}</td>
                    <td className="p-3 text-slate-600">{r.opportunities}</td>
                    <td className="p-3 text-slate-600">{r.won}{r.accounts ? ` · ${r.accounts} acct` : ""}</td>
                    <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.conversion_rate >= 25 ? "bg-emerald-100 text-emerald-700" : r.conversion_rate > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>{r.conversion_rate}%</span></td>
                    <td className="p-3 text-right">{r.leads > 0 && <button type="button" data-testid={`rs-report-leads-${r.id}`} onClick={() => viewProduced({ id: r.id, name: r.name })} className="text-xs font-bold text-primary hover:underline">View leads</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <div className="p-6">
        {/* saved sources */}
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm" data-testid="rs-saved">
          <Bookmark className="h-4 w-4 text-slate-400" /><span className="text-slate-500">Saved sources</span>
          {saved.length === 0 && <span className="text-xs text-slate-400">Save a referral source to reload its area + filters and track the leads it produces.</span>}
          {saved.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {(s.query?.source_type === "doctor") ? <Stethoscope className="h-3 w-3 text-slate-400" /> : null}
              <button type="button" onClick={() => applySaved(s)} data-testid={`rs-chip-${s.id}`} className="hover:text-primary">{s.name}</button>
              {counts[s.id] > 0 && <button type="button" data-testid={`rs-produced-${s.id}`} onClick={() => viewProduced(s)} className="rounded-full bg-primary/10 px-1.5 font-bold text-primary hover:bg-primary/20">{counts[s.id]} leads</button>}
              <button type="button" onClick={() => delSaved(s.id)} data-testid={`rs-del-${s.id}`} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
        </div>

        {/* source form */}
        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Referral source type">
              <select data-testid="rs-source-type" value={gen.source_type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                <option value="doctor">Doctor</option>
                <option value="other">Other profession</option>
              </select>
            </Field>

            {isDoctor ? (
              <div className="relative col-span-2">
                <Field label="Find the referring doctor (name or NPI)">
                  <input data-testid="rs-doctor-lookup" value={dq} onChange={(e) => onDoctorQuery(e.target.value)} onFocus={() => dres.length && setDopen(true)} placeholder="Start typing a name or NPI — pulls from Medicare data" className={inputCls} autoComplete="off" />
                </Field>
                {dopen && (dbusy || dres.length > 0 || (dq || "").trim().length >= 2) && (
                  <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg" data-testid="rs-doctor-results">
                    {dbusy && <p className="p-3 text-xs text-slate-400">Searching Medicare data…</p>}
                    {!dbusy && dres.length === 0 && <p className="p-3 text-xs text-slate-400">No matching physicians.</p>}
                    {dres.map((r) => (
                      <button key={r.npi} type="button" data-testid={`rs-doctor-opt-${r.npi}`} onClick={() => pickDoctor(r)} className="flex w-full items-start justify-between gap-2 border-b border-slate-50 p-2.5 text-left hover:bg-slate-50">
                        <span>
                          <span className="block text-sm font-semibold text-slate-800">Dr. {r.first_name} {r.last_name}</span>
                          <span className="block text-xs text-slate-400">{r.specialty} · {r.city}, {r.state} · NPI {r.npi}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${capColor(r.capability?.level)}`}>{r.capability?.level}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <Field label="Profession"><input data-testid="rs-profession" value={gen.profession} onChange={(e) => setGen({ ...gen, profession: e.target.value })} placeholder="Nurse, Office Manager, Pharmacist…" className={inputCls} /></Field>
                <Field label="Referral source name"><input data-testid="rs-name" value={gen.name} onChange={(e) => setGen({ ...gen, name: e.target.value })} placeholder="Jane Doe — Front desk" className={inputCls} /></Field>
              </>
            )}

            <Field label="Their practice — address, city, or ZIP"><input data-testid="rs-origin" value={gen.origin} onChange={(e) => setGen({ ...gen, origin: e.target.value })} placeholder="06510 · New Haven, CT · 200 First St SW, Rochester, MN" className={inputCls} /></Field>
            <Field label="Specialty to target (optional)"><input data-testid="rs-specialty" value={gen.specialty} onChange={(e) => setGen({ ...gen, specialty: e.target.value })} placeholder="Cardiology" className={inputCls} /></Field>
            <Field label="RPM tier"><select data-testid="rs-trpm" value={gen.tier_rpm} onChange={(e) => setGen({ ...gen, tier_rpm: e.target.value })} className={inputCls}>{TIERS.map((t) => <option key={t} value={t}>{t || "Any"}</option>)}</select></Field>
            <Field label="340B color(s)">
              <div data-testid="rs-tiers" className="flex flex-wrap gap-1 pt-1">
                {COLORS.map((c) => {
                  const on = gen.tiers.includes(c);
                  return <button key={c} type="button" data-testid={`rs-tier-${c}`} onClick={() => setGen({ ...gen, tiers: on ? gen.tiers.filter((x) => x !== c) : [...gen.tiers, c] })} className={`rounded-full px-3 py-1.5 text-xs font-bold ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{c}</button>;
                })}
              </div>
            </Field>
            {!isDoctor && <div className="col-span-2 md:col-span-4"><Field label="Note (optional)"><input data-testid="rs-note" value={gen.source_note} onChange={(e) => setGen({ ...gen, source_note: e.target.value })} placeholder="How you know this source, best contact method, etc." className={inputCls} /></Field></div>}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
            <MapPin className="mb-2 h-4 w-4 text-primary" />
            <RadiusControls idPrefix="rs" value={gen.radius} onChange={(radius) => setGen({ ...gen, radius })} />
          </div>
          <div className="mt-3"><Btn onClick={() => run(1)} data-testid="rs-search"><Search className="h-4 w-4" /> Find referral partners</Btn></div>
        </div>

        {/* capability panel */}
        {isDoctor && gen.doctor_cap && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4" data-testid="rs-capability">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-primary" />
                <span className="font-semibold text-slate-800">{gen.name || "Selected doctor"}</span>
                <span data-testid="rs-cap-level" className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${capColor(gen.doctor_cap.level)}`}><Award className="h-3 w-3" /> {gen.doctor_cap.level} referral potential</span>
              </div>
              {gen.doctor_stats && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{Number(gen.doctor_stats.tot_clms || 0).toLocaleString()} claims</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{money(gen.doctor_stats.tot_cost)} drug cost</span>
                  <TierPill kind="" tier={gen.doctor_stats.tier_340b} />
                  <TierPill kind="" tier={gen.doctor_stats.tier_rpm} />
                </div>
              )}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {(gen.doctor_cap.reasons || []).map((r, i) => <li key={i} className="flex items-center gap-1">• {r}</li>)}
            </ul>
            <div className="mt-3 border-t border-slate-100 pt-3 text-sm" data-testid="rs-track-record">
              {track ? (
                <p className="text-slate-600">Track record with us: <b className="text-slate-900">{track.leads}</b> leads produced · <b className="text-slate-900">{track.opportunities}</b> opportunities · <b className="text-slate-900">{track.won}</b> won <span className="text-slate-400">({track.conversion_rate}% conversion)</span></p>
              ) : (
                <p className="text-slate-400">Save this source to start tracking the leads &amp; conversions it produces.</p>
              )}
            </div>
          </div>
        )}

        {/* origin + cities + view toggle */}
        {origin && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3" data-testid="rs-geo-banner">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-700"><MapPin className="h-4 w-4 text-primary" /> {gen.name ? `${gen.name} · ` : ""}{origin.label} — {cities.length} cities within {radiusLabel(gen.radius)}</p>
              <div className="flex gap-1">
                <button type="button" data-testid="rs-view-list" onClick={() => setView("list")} className={`rounded-full px-3 py-1 text-xs font-bold ${view === "list" ? "bg-primary text-white" : "bg-white text-slate-500"}`}>List</button>
                <button type="button" data-testid="rs-view-map" onClick={() => setView("map")} className={`rounded-full px-3 py-1 text-xs font-bold ${view === "map" ? "bg-primary text-white" : "bg-white text-slate-500"}`}>Map</button>
              </div>
            </div>
            {view === "list" && (
              <div className="mt-2 flex flex-wrap gap-1">
                {cities.slice(0, 40).map((c) => <span key={`${c.state}-${c.city}`} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-500">{c.city}, {c.state} · {c.distance_mi}mi</span>)}
                {cities.length > 40 && <span className="px-1 text-[11px] text-slate-400">+{cities.length - 40} more</span>}
              </div>
            )}
          </div>
        )}

        {origin && view === "map" && (
          <div className="mb-4" data-testid="rs-map-wrap">
            <CoverageMap origin={origin} radiusMi={effectiveMiles(gen.radius)} cities={coverage?.cities || []} />
            <p className="mt-1 text-xs text-slate-400">{coverage ? `${coverage.total} potential partners across ${coverage.cities.length} cities` : "Loading coverage…"}</p>
          </div>
        )}

        {/* results */}
        {!(origin && view === "map") && (
        <>
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Users2 className="h-4 w-4 text-primary" /> {data.total?.toLocaleString() || 0} potential referral partners</span>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <button disabled={page <= 1} onClick={() => run(page - 1)} className="rounded p-1 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            Page {page} / {totalPages}
            <button disabled={page >= totalPages} onClick={() => run(page + 1)} className="rounded p-1 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr><th className="p-3">Physician</th><th className="p-3">Specialty</th><th className="p-3">Location</th><th className="p-3">Drug Cost</th><th className="p-3">340B</th><th className="p-3">RPM</th><th className="p-3">CRM</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="p-8 text-center text-slate-400">Searching…</td></tr>}
              {!loading && data.results.length === 0 && <tr><td colSpan={8}><EmptyState icon={Search} title="No referral partners yet" hint="Pick a referral source + radius, then search." /></td></tr>}
              {!loading && data.results.map((r) => (
                <tr key={r.npi} data-testid={`rs-row-${r.npi}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-semibold text-slate-800">Dr. {r.first_name} {r.last_name}</td>
                  <td className="p-3 text-slate-500">{r.specialty}</td>
                  <td className="p-3 text-slate-500">{r.city}, {r.state}</td>
                  <td className="p-3 font-bold text-slate-800">{money(r.tot_cost)}</td>
                  <td className="p-3"><TierPill kind="" tier={r.tier_340b} /></td>
                  <td className="p-3"><TierPill kind="" tier={r.tier_rpm} /></td>
                  <td className="p-3">{r.crm ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">In CRM</span> : <span className="text-xs text-slate-400">—</span>}</td>
                  <td className="p-3 text-right">{!r.crm && <Btn variant="ghost" onClick={() => createLead(r)} data-testid={`rs-add-${r.npi}`}><Plus className="h-4 w-4" /> Add lead</Btn>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}
      </div>
      )}

      <Modal open={!!produced} onClose={() => setProduced(null)} title={produced ? `Leads from ${produced.name}` : ""}>
        {produced && (
          <div className="space-y-1" data-testid="rs-produced-modal">
            {produced.leads.length === 0 && <p className="text-sm text-slate-400">No leads produced yet.</p>}
            {produced.leads.map((l) => (
              <button key={l.id} type="button" onClick={() => nav(`/crm/leads/${l.id}`)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-2 text-left text-sm hover:bg-slate-50">
                <span className="font-semibold text-slate-800">{l.org_name || `${l.contact_first || ""} ${l.contact_last || ""}`.trim() || l.lead_number}</span>
                <span className="text-xs text-slate-400">{l.lead_number} · {l.status}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
