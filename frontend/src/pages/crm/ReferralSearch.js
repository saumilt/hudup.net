import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { TierPill, money, Btn, Field, inputCls, EmptyState } from "@/components/crm/kit";
import { Search, MapPin, Bookmark, Trash2, Plus, Users2, ChevronLeft, ChevronRight } from "lucide-react";

const COLORS = ["GREEN", "YELLOW", "BLUE", "RED"];
const TIERS = ["", "GREEN", "YELLOW", "BLUE", "RED"];

// Free-text origin -> canonical geocode fields.
const canon = (text) => {
  const t = (text || "").trim();
  if (!t) return {};
  if (/^\d{5}$/.test(t)) return { zip: t };
  const m = t.match(/^(.+),\s*([A-Za-z]{2})$/);
  if (m) return { city: m[1].trim(), state: m[2].trim() };
  return { address: t };
};
const toOrigin = (c) => ({ origin_address: c.address, origin_city: c.city, origin_state: c.state, origin_zip: c.zip });

const EMPTY = { name: "", origin: "", radius_mi: 25, specialty: "", tiers: [], tier_rpm: "" };

export default function ReferralSearch() {
  const [gen, setGen] = useState(EMPTY);
  const [origin, setOrigin] = useState(null);
  const [cities, setCities] = useState([]);
  const [data, setData] = useState({ results: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState([]);

  const loadSaved = useCallback(() => {
    api.get("/crm/saved-searches", { params: { entity: "referral" } }).then((r) => setSaved(r.data)).catch(() => {});
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const run = useCallback(async (p = 1, g = gen) => {
    if (!(g.origin || "").trim() || !g.radius_mi) { toast.error("Enter the generator's practice address / city / ZIP and a radius"); return; }
    setLoading(true); setPage(p);
    try {
      const c = canon(g.origin);
      const [res, srch] = await Promise.all([
        api.post("/medicare/geo/resolve", { ...c, radius_mi: g.radius_mi }),
        api.post("/medicare/search", { ...toOrigin(c), radius_mi: g.radius_mi, specialty: g.specialty, tiers: g.tiers, tier_rpm: g.tier_rpm, page: p, page_size: 25 }),
      ]);
      setOrigin(res.data.origin); setCities(res.data.cities || []); setData(srch.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Search failed");
    } finally { setLoading(false); }
  }, [gen]);

  const save = async () => {
    if (!(gen.origin || "").trim()) return toast.error("Enter a practice location first");
    const name = gen.name.trim() || window.prompt("Name this referral generator (e.g. Dr. Smith — Cardiology):");
    if (!name) return;
    await api.post("/crm/saved-searches", { name, entity: "referral", query: { ...gen, name } });
    toast.success("Referral generator saved"); loadSaved();
  };
  const applySaved = (view) => { const g = { ...EMPTY, ...(view.query || {}) }; setGen(g); run(1, g); };
  const delSaved = async (sid) => {
    try { await api.delete(`/crm/saved-searches/${sid}`); toast.success("Removed"); loadSaved(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const createLead = async (row) => {
    try {
      const r = await api.post("/crm/leads", {
        contact_first: row.first_name, contact_last: row.last_name, source: "Referral Search",
        matched_npi: row.npi, dataset_year: row.dataset_year, specialty: row.specialty,
        city: row.city, state: row.state, priority: "Medium",
        tags: gen.name ? [`Referral: ${gen.name}`] : ["Referral partner"],
      });
      toast.success(`Lead ${r.data.lead_number} created`);
      row.crm = { status: r.data.status, id: r.data.id }; setData((d) => ({ ...d }));
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
          {saved.length === 0 && <span className="text-xs text-slate-400">Save a generator to reload its area + filters in one click.</span>}
          {saved.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
              <button type="button" onClick={() => applySaved(s)} data-testid={`rs-chip-${s.id}`} className="hover:text-primary">{s.name}</button>
              <button type="button" onClick={() => delSaved(s.id)} data-testid={`rs-del-${s.id}`} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
        </div>

        {/* generator form */}
        <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4">
          <Field label="Referral generator (optional)"><input data-testid="rs-name" value={gen.name} onChange={(e) => setGen({ ...gen, name: e.target.value })} placeholder="Dr. Smith — Cardiology" className={inputCls} /></Field>
          <Field label="Their practice — address, city, or ZIP"><input data-testid="rs-origin" value={gen.origin} onChange={(e) => setGen({ ...gen, origin: e.target.value })} placeholder="06510 · New Haven, CT · 200 First St SW, Rochester, MN" className={inputCls} /></Field>
          <Field label="Radius (mi)"><input data-testid="rs-radius" type="number" min={1} value={gen.radius_mi || ""} onChange={(e) => setGen({ ...gen, radius_mi: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Specialty (optional)"><input data-testid="rs-specialty" value={gen.specialty} onChange={(e) => setGen({ ...gen, specialty: e.target.value })} placeholder="Cardiology" className={inputCls} /></Field>
          <Field label="340B color(s)">
            <div data-testid="rs-tiers" className="flex flex-wrap gap-1 pt-1">
              {COLORS.map((c) => {
                const on = gen.tiers.includes(c);
                return <button key={c} type="button" data-testid={`rs-tier-${c}`} onClick={() => setGen({ ...gen, tiers: on ? gen.tiers.filter((x) => x !== c) : [...gen.tiers, c] })} className={`rounded-full px-3 py-1.5 text-xs font-bold ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{c}</button>;
              })}
            </div>
          </Field>
          <Field label="RPM tier"><select data-testid="rs-trpm" value={gen.tier_rpm} onChange={(e) => setGen({ ...gen, tier_rpm: e.target.value })} className={inputCls}>{TIERS.map((t) => <option key={t} value={t}>{t || "Any"}</option>)}</select></Field>
          <div className="flex flex-wrap gap-1 pb-1 pt-6">
            {[10, 25, 50, 100].map((r) => <button key={r} type="button" data-testid={`rs-radius-${r}`} onClick={() => setGen({ ...gen, radius_mi: r })} className={`rounded-full px-2.5 py-1 text-xs font-bold ${gen.radius_mi === r ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{r}mi</button>)}
          </div>
          <div className="col-span-2 flex items-end md:col-span-4"><Btn onClick={() => run(1)} data-testid="rs-search"><Search className="h-4 w-4" /> Find referral partners</Btn></div>
        </div>

        {/* origin + cities */}
        {origin && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3" data-testid="rs-geo-banner">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-700"><MapPin className="h-4 w-4 text-primary" /> {gen.name ? `${gen.name} · ` : ""}{origin.label} — {cities.length} cities within {gen.radius_mi} mi</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {cities.slice(0, 40).map((c) => <span key={`${c.state}-${c.city}`} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-500">{c.city}, {c.state} · {c.distance_mi}mi</span>)}
              {cities.length > 40 && <span className="px-1 text-[11px] text-slate-400">+{cities.length - 40} more</span>}
            </div>
          </div>
        )}

        {/* results */}
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
      </div>
    </div>
  );
}
