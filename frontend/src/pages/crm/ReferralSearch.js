import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { TierPill, money, Btn, Field, inputCls, EmptyState, Modal } from "@/components/crm/kit";
import { Search, MapPin, Bookmark, Trash2, Plus, Users2, ChevronLeft, ChevronRight } from "lucide-react";
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

const EMPTY = { name: "", origin: "", radius: { mode: "mi", miles: 25, driveMin: 0, mph: 45 }, specialty: "", tiers: [], tier_rpm: "" };

export default function ReferralSearch() {
  const nav = useNavigate();
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
  const [produced, setProduced] = useState(null); // { name, leads }

  const loadSaved = useCallback(() => {
    api.get("/crm/saved-searches", { params: { entity: "referral" } }).then((r) => setSaved(r.data)).catch(() => {});
    api.get("/crm/referral-generators/counts").then((r) => setCounts(r.data)).catch(() => {});
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const run = useCallback(async (p = 1, g = gen) => {
    const effMi = effectiveMiles(g.radius);
    if (!(g.origin || "").trim() || !effMi) { toast.error("Enter the generator's practice address / city / ZIP and a radius"); return; }
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
    const name = gen.name.trim() || window.prompt("Name this referral generator (e.g. Dr. Smith — Cardiology):");
    if (!name) return;
    try {
      const r = await api.post("/crm/saved-searches", { name, entity: "referral", query: { ...gen, name } });
      setGen((x) => ({ ...x, name })); setLoadedId(r.data?.id || null);
      toast.success("Referral generator saved"); loadSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const applySaved = (sv) => {
    const q = sv.query || {};
    const g = { ...EMPTY, ...q, radius: q.radius || { mode: "mi", miles: q.radius_mi || 25, driveMin: 0, mph: 45 } };
    setGen(g); setLoadedId(sv.id); run(1, g);
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

  return (
    <div>
      <PageHeader title="Referral Search" subtitle="Find nearby doctors around a referral generator's practice">
        <Btn variant="ghost" onClick={save} data-testid="rs-save"><Bookmark className="h-4 w-4" /> Save generator</Btn>
      </PageHeader>

      <div className="p-6">
        {/* saved generators */}
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm" data-testid="rs-saved">
          <Bookmark className="h-4 w-4 text-slate-400" /><span className="text-slate-500">Saved generators</span>
          {saved.length === 0 && <span className="text-xs text-slate-400">Save a generator to reload its area + filters and track the leads it produces.</span>}
          {saved.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
              <button type="button" onClick={() => applySaved(s)} data-testid={`rs-chip-${s.id}`} className="hover:text-primary">{s.name}</button>
              {counts[s.id] > 0 && <button type="button" data-testid={`rs-produced-${s.id}`} onClick={() => viewProduced(s)} className="rounded-full bg-primary/10 px-1.5 font-bold text-primary hover:bg-primary/20">{counts[s.id]} leads</button>}
              <button type="button" onClick={() => delSaved(s.id)} data-testid={`rs-del-${s.id}`} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
        </div>

        {/* generator form */}
        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Referral generator (optional)"><input data-testid="rs-name" value={gen.name} onChange={(e) => setGen({ ...gen, name: e.target.value })} placeholder="Dr. Smith — Cardiology" className={inputCls} /></Field>
            <Field label="Their practice — address, city, or ZIP"><input data-testid="rs-origin" value={gen.origin} onChange={(e) => setGen({ ...gen, origin: e.target.value })} placeholder="06510 · New Haven, CT · 200 First St SW, Rochester, MN" className={inputCls} /></Field>
            <Field label="Specialty (optional)"><input data-testid="rs-specialty" value={gen.specialty} onChange={(e) => setGen({ ...gen, specialty: e.target.value })} placeholder="Cardiology" className={inputCls} /></Field>
            <Field label="RPM tier"><select data-testid="rs-trpm" value={gen.tier_rpm} onChange={(e) => setGen({ ...gen, tier_rpm: e.target.value })} className={inputCls}>{TIERS.map((t) => <option key={t} value={t}>{t || "Any"}</option>)}</select></Field>
            <Field label="340B color(s)">
              <div data-testid="rs-tiers" className="flex flex-wrap gap-1 pt-1">
                {COLORS.map((c) => {
                  const on = gen.tiers.includes(c);
                  return <button key={c} type="button" data-testid={`rs-tier-${c}`} onClick={() => setGen({ ...gen, tiers: on ? gen.tiers.filter((x) => x !== c) : [...gen.tiers, c] })} className={`rounded-full px-3 py-1.5 text-xs font-bold ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{c}</button>;
                })}
              </div>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
            <MapPin className="mb-2 h-4 w-4 text-primary" />
            <RadiusControls idPrefix="rs" value={gen.radius} onChange={(radius) => setGen({ ...gen, radius })} />
          </div>
          <div className="mt-3"><Btn onClick={() => run(1)} data-testid="rs-search"><Search className="h-4 w-4" /> Find referral partners</Btn></div>
        </div>

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
              {!loading && data.results.length === 0 && <tr><td colSpan={8}><EmptyState icon={Search} title="No referral partners yet" hint="Enter the generator's practice location + radius, then search." /></td></tr>}
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
