import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { TierPill, money, Btn, Field, inputCls, EmptyState, Modal } from "@/components/crm/kit";
import { Search, Plus, Filter, Save, ChevronLeft, ChevronRight, ChevronDown, Bookmark, Trash2, MapPin } from "lucide-react";
import CoverageMap from "@/components/crm/CoverageMap";
import RadiusControls, { effectiveMiles, radiusLabel } from "@/components/crm/RadiusControls";

const TIERS = ["", "GREEN", "YELLOW", "BLUE", "RED"];
const COLORS = ["GREEN", "YELLOW", "BLUE", "RED"];

// Smart-route a free-text origin to the right geocode field.
const parseOrigin = (text) => {
  const t = (text || "").trim();
  if (!t) return {};
  if (/^\d{5}$/.test(t)) return { origin_zip: t };
  const m = t.match(/^(.+),\s*([A-Za-z]{2})$/);
  if (m) return { origin_city: m[1].trim(), origin_state: m[2].trim() };
  return { origin_address: t };
};

function MultiSelect({ label, options, selected, onChange, testid, disabled }) {
  return (
    <details className="group relative" data-testid={testid}>
      <summary className={`${inputCls} flex cursor-pointer list-none items-center justify-between ${disabled ? "opacity-50" : ""}`}>
        <span className="truncate">{selected.length ? `${selected.length} selected` : `Any ${label}`}</span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
      </summary>
      {!disabled && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {options.length === 0 && <p className="p-1 text-xs text-slate-400">No options</p>}
          {selected.length > 0 && <button type="button" onClick={() => onChange([])} className="mb-1 text-xs text-primary hover:underline">Clear all</button>}
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 py-0.5 text-sm">
              <input type="checkbox" data-testid={`${testid}-opt-${o}`} checked={selected.includes(o)} onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))} className="h-4 w-4 accent-primary" />
              {o}
            </label>
          ))}
        </div>
      )}
    </details>
  );
}

export default function Medicare() {
  const [years, setYears] = useState([2024]);
  const [form, setForm] = useState({ dataset_year: 2024, npi: "", last_name: "", first_name: "", specialty: "", tier_rpm: "", states: [], cities: [], tiers: [], origin: "", radius: { mode: "mi", miles: 0, driveMin: 0, mph: 45 }, sort: "tot_cost", page: 1, page_size: 25 });
  const [view, setView] = useState("list"); // result view: list | map
  const [coverage, setCoverage] = useState(null);
  const [stateOpts, setStateOpts] = useState([]);
  const [cityOpts, setCityOpts] = useState([]);
  const [data, setData] = useState({ results: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState({});
  const [advOpen, setAdvOpen] = useState(false);
  const [conds, setConds] = useState([{ field: "tot_cost", op: "gte", value: 1000000 }]);
  const [connector, setConnector] = useState("AND");
  const [schema, setSchema] = useState([]);
  const [mode, setMode] = useState("simple");
  const [savedViews, setSavedViews] = useState([]);

  const loadSaved = useCallback(() => {
    api.get("/crm/saved-searches", { params: { entity: "medicare" } }).then((r) => setSavedViews(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/medicare/years").then((r) => setYears(r.data.years)).catch(() => {});
    api.get("/medicare/filter-schema").then((r) => setSchema(r.data.fields)).catch(() => {});
    loadSaved();
  }, [loadSaved]);

  useEffect(() => {
    api.get("/medicare/states", { params: { dataset_year: form.dataset_year } }).then((r) => setStateOpts(r.data.states)).catch(() => {});
  }, [form.dataset_year]);

  useEffect(() => {
    if (form.states.length) {
      api.get("/medicare/cities", { params: { states: form.states.join(","), dataset_year: form.dataset_year } }).then((r) => setCityOpts(r.data.cities)).catch(() => {});
    } else {
      setCityOpts([]);
    }
  }, [form.states, form.dataset_year]);

  const runSearch = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      if (mode === "advanced") {
        const r = await api.post("/medicare/advanced-search", { dataset_year: form.dataset_year, connector, conditions: conds, sort: form.sort, page, page_size: form.page_size });
        setData(r.data);
      } else {
        const effMi = effectiveMiles(form.radius);
        const payload = { ...form, radius_mi: effMi, ...parseOrigin(form.origin), page };
        const r = await api.post("/medicare/search", payload);
        setData(r.data);
        if (effMi > 0 && r.data.origin) {
          try { const cov = await api.post("/medicare/geo/coverage", payload); setCoverage(cov.data); } catch { setCoverage(null); }
        } else { setCoverage(null); setView("list"); }
      }
      setForm((f) => ({ ...f, page }));
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [form, mode, conds, connector]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runSearch(1); }, []);

  const createLead = async (row) => {
    try {
      const r = await api.post("/crm/leads", {
        org_name: null, contact_first: row.first_name, contact_last: row.last_name,
        source: "Medicare Search", matched_npi: row.npi, dataset_year: row.dataset_year || form.dataset_year,
        specialty: row.specialty, city: row.city, state: row.state, priority: "Medium",
      });
      toast.success(`Lead ${r.data.lead_number} created for Dr. ${row.last_name}`);
      row.crm = { status: r.data.status, id: r.data.id };
      setData((d) => ({ ...d }));
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const bulkCreate = async () => {
    const rows = data.results.filter((r) => sel[r.npi] && !r.crm);
    if (!rows.length) return toast.error("Select unconverted rows first");
    for (const row of rows) await createLead(row);
    setSel({});
  };

  const saveSearch = async () => {
    const name = window.prompt("Name this view (e.g. CA · Los Angeles · GREEN):");
    if (!name) return;
    await api.post("/crm/saved-searches", { name, entity: "medicare", query: mode === "advanced" ? { mode, connector, conditions: conds, dataset_year: form.dataset_year } : { mode, ...form } });
    toast.success("View saved"); loadSaved();
  };
  const applyView = async (sv) => {
    const qv = sv.query || {};
    if (qv.mode === "advanced") {
      setMode("advanced"); setConnector(qv.connector || "AND"); setConds(qv.conditions || []);
      setForm((f) => ({ ...f, dataset_year: qv.dataset_year || f.dataset_year, page: 1 }));
      setLoading(true);
      try { const r = await api.post("/medicare/advanced-search", { dataset_year: qv.dataset_year || form.dataset_year, connector: qv.connector || "AND", conditions: qv.conditions || [], sort: form.sort, page: 1, page_size: form.page_size }); setData(r.data); }
      catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setLoading(false); }
      return;
    }
    const next = { ...form, npi: qv.npi || "", last_name: qv.last_name || "", first_name: qv.first_name || "", specialty: qv.specialty || "", tier_rpm: qv.tier_rpm || "", states: qv.states || [], cities: qv.cities || [], tiers: qv.tiers || [], origin: qv.origin || "", radius: qv.radius || { mode: "mi", miles: qv.radius_mi || 0, driveMin: 0, mph: 45 }, dataset_year: qv.dataset_year || form.dataset_year, page: 1 };
    setMode("simple"); setForm(next); setLoading(true);
    try {
      const payload = { ...next, radius_mi: effectiveMiles(next.radius), ...parseOrigin(next.origin), page: 1 };
      const r = await api.post("/medicare/search", payload); setData(r.data); toast.success(`Loaded “${sv.name}”`);
      if (effectiveMiles(next.radius) > 0 && r.data.origin) { try { const cov = await api.post("/medicare/geo/coverage", payload); setCoverage(cov.data); } catch { setCoverage(null); } } else { setCoverage(null); }
    }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setLoading(false); }
  };
  const deleteView = async (sid) => {
    try { await api.delete(`/crm/saved-searches/${sid}`); toast.success("View removed"); loadSaved(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const totalPages = Math.max(1, Math.ceil(data.total / form.page_size));

  return (
    <div>
      <PageHeader title="Medicare Search" subtitle={`Query the CMS Part D dataset · ${data.total.toLocaleString()} matches`}>
        <select data-testid="ms-year" value={form.dataset_year} onChange={(e) => setForm({ ...form, dataset_year: Number(e.target.value) })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
        </select>
        <Btn variant="ghost" onClick={() => setMode(mode === "simple" ? "advanced" : "simple")} data-testid="ms-toggle-mode"><Filter className="h-4 w-4" /> {mode === "simple" ? "Advanced" : "Simple"}</Btn>
        <Btn variant="ghost" onClick={saveSearch} data-testid="ms-save"><Save className="h-4 w-4" /> Save view</Btn>
      </PageHeader>

      <div className="p-6">
        {/* Saved views */}
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm" data-testid="ms-saved-views">
          <Bookmark className="h-4 w-4 text-slate-400" />
          <span className="text-slate-500">Saved views</span>
          <select data-testid="ms-view-select" value="" onChange={(e) => { const v = savedViews.find((s) => s.id === e.target.value); if (v) applyView(v); }} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Load a saved view…</option>
            {savedViews.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {savedViews.length === 0 && <span className="text-xs text-slate-400">Save your favourite state · city · 340B-colour set with “Save view”.</span>}
          {savedViews.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
              <button type="button" onClick={() => applyView(s)} data-testid={`ms-view-chip-${s.id}`} className="hover:text-primary">{s.name}</button>
              <button type="button" onClick={() => deleteView(s.id)} data-testid={`ms-view-del-${s.id}`} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
        </div>

        {/* search form */}
        {mode === "simple" ? (
          <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4">
            {[["last_name", "Last name"], ["first_name", "First name"], ["npi", "NPI"], ["specialty", "Specialty"]].map(([k, l]) => (
              <Field key={k} label={l}><input data-testid={`ms-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={inputCls} /></Field>
            ))}
            <Field label="State"><MultiSelect testid="ms-states" label="state" options={stateOpts} selected={form.states} onChange={(v) => setForm({ ...form, states: v, cities: [] })} /></Field>
            <Field label="City"><MultiSelect testid="ms-cities" label="city" options={cityOpts} selected={form.cities} onChange={(v) => setForm({ ...form, cities: v })} disabled={!form.states.length} /></Field>
            <Field label="340B color(s)">
              <div data-testid="ms-tiers" className="flex flex-wrap gap-1 pt-1">
                {COLORS.map((c) => {
                  const on = form.tiers.includes(c);
                  return <button key={c} type="button" data-testid={`ms-tier-${c}`} onClick={() => setForm({ ...form, tiers: on ? form.tiers.filter((x) => x !== c) : [...form.tiers, c] })} className={`rounded-full px-3 py-1.5 text-xs font-bold ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{c}</button>;
                })}
              </div>
            </Field>
            <Field label="RPM tier"><select data-testid="ms-trpm" value={form.tier_rpm} onChange={(e) => setForm({ ...form, tier_rpm: e.target.value })} className={inputCls}>{TIERS.map((t) => <option key={t} value={t}>{t || "Any"}</option>)}</select></Field>
            <div className="col-span-2 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3 md:col-span-4">
              <MapPin className="mb-2 h-4 w-4 text-primary" />
              <Field label="Near — address, city, or ZIP (radius search)">
                <input data-testid="ms-origin" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} placeholder="06510 · New Haven, CT · 200 First St SW, Rochester, MN" className={`${inputCls} min-w-[280px]`} />
              </Field>
              <RadiusControls idPrefix="ms" value={form.radius} onChange={(radius) => setForm({ ...form, radius })} />
              {effectiveMiles(form.radius) > 0 && <button type="button" data-testid="ms-radius-clear" onClick={() => setForm({ ...form, origin: "", radius: { ...form.radius, miles: 0, driveMin: 0 } })} className="mb-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-200">Clear</button>}
            </div>
            <div className="col-span-2 flex items-end md:col-span-4"><Btn onClick={() => runSearch(1)} data-testid="ms-search"><Search className="h-4 w-4" /> Search</Btn></div>
          </div>
        ) : (
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="font-semibold text-slate-600">Match</span>
              <select value={connector} onChange={(e) => setConnector(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm"><option>AND</option><option>OR</option></select>
              <span className="text-slate-500">of the following</span>
            </div>
            {conds.map((c, i) => (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                <select value={c.field} onChange={(e) => { const n = [...conds]; n[i] = { ...c, field: e.target.value }; setConds(n); }} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                  {schema.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                </select>
                <select value={c.op} onChange={(e) => { const n = [...conds]; n[i] = { ...c, op: e.target.value }; setConds(n); }} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                  {(schema.find((f) => f.field === c.field)?.ops || ["gte", "lte", "eq"]).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <input value={c.value} onChange={(e) => { const n = [...conds]; n[i] = { ...c, value: e.target.value }; setConds(n); }} className="w-40 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                <button onClick={() => setConds(conds.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">✕</button>
              </div>
            ))}
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => setConds([...conds, { field: "tot_clms", op: "gte", value: 1000 }])}><Plus className="h-4 w-4" /> Add condition</Btn>
              <Btn onClick={() => runSearch(1)} data-testid="ms-adv-search"><Search className="h-4 w-4" /> Run</Btn>
            </div>
          </div>
        )}

        {/* results */}
        {data.origin && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-slate-600" data-testid="ms-radius-banner">
            <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Showing doctors within <b>{radiusLabel(form.radius)}</b> of <b>{data.origin.label}</b> — <b>{data.radius_cities}</b> nearby cities.</span>
            <div className="flex gap-1">
              <button type="button" data-testid="ms-view-list" onClick={() => setView("list")} className={`rounded-full px-3 py-1 text-xs font-bold ${view === "list" ? "bg-primary text-white" : "bg-white text-slate-500"}`}>List</button>
              <button type="button" data-testid="ms-view-map" onClick={() => setView("map")} className={`rounded-full px-3 py-1 text-xs font-bold ${view === "map" ? "bg-primary text-white" : "bg-white text-slate-500"}`}>Map</button>
            </div>
          </div>
        )}
        {data.origin && view === "map" && (
          <div className="mb-4" data-testid="ms-map-wrap">
            <CoverageMap origin={data.origin} radiusMi={effectiveMiles(form.radius)} cities={coverage?.cities || []} />
            <p className="mt-1 text-xs text-slate-400">{coverage ? `${coverage.total} matching doctors across ${coverage.cities.length} cities` : "Loading coverage…"}</p>
          </div>
        )}
        {!(data.origin && view === "map") && (
        <>
        <div className="mb-3 flex items-center justify-between">
          <Btn variant="dark" onClick={bulkCreate} data-testid="ms-bulk-create"><Plus className="h-4 w-4" /> Create leads from selected</Btn>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <button disabled={form.page <= 1} onClick={() => runSearch(form.page - 1)} className="rounded p-1 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            Page {form.page} / {totalPages}
            <button disabled={form.page >= totalPages} onClick={() => runSearch(form.page + 1)} className="rounded p-1 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="p-3"><input type="checkbox" onChange={(e) => { const s = {}; if (e.target.checked) data.results.forEach((r) => (s[r.npi] = true)); setSel(s); }} /></th>
                <th className="p-3">Physician</th><th className="p-3">NPI</th><th className="p-3">Specialty</th>
                <th className="p-3">Location</th><th className="p-3">Claims</th><th className="p-3">Drug Cost</th>
                <th className="p-3">$/Claim</th><th className="p-3">340B</th><th className="p-3">RPM</th>
                <th className="p-3">CRM</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={12} className="p-8 text-center text-slate-400">Searching…</td></tr>}
              {!loading && data.results.length === 0 && <tr><td colSpan={12}><EmptyState icon={Search} title="No physicians match" hint="Adjust your filters and search again." /></td></tr>}
              {!loading && data.results.map((r) => (
                <tr key={r.npi} data-testid={`ms-row-${r.npi}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3"><input type="checkbox" checked={!!sel[r.npi]} onChange={(e) => setSel({ ...sel, [r.npi]: e.target.checked })} /></td>
                  <td className="p-3 font-semibold text-slate-800">Dr. {r.first_name} {r.last_name}</td>
                  <td className="p-3 font-mono text-xs text-slate-500">{r.npi}</td>
                  <td className="p-3 text-slate-600">{r.specialty}</td>
                  <td className="p-3 text-slate-600">{r.city}, {r.state}</td>
                  <td className="p-3">{Number(r.tot_clms).toLocaleString()}</td>
                  <td className="p-3">{money(r.tot_cost)}</td>
                  <td className="p-3">{money(r.avg_per_claim)}</td>
                  <td className="p-3"><TierPill kind="" tier={r.tier_340b} /></td>
                  <td className="p-3"><TierPill kind="" tier={r.tier_rpm} /></td>
                  <td className="p-3">{r.crm ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{r.crm.status || "In CRM"}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="p-3">{!r.crm && <Btn onClick={() => createLead(r)} data-testid={`ms-create-${r.npi}`} className="px-2 py-1"><Plus className="h-3.5 w-3.5" /> Lead</Btn>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
