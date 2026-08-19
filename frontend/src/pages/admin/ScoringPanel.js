import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { TIER_STYLES } from "@/components/TierBadge";
import { toast } from "sonner";

const FIELDS = [
  ["b340_green_apc", "GREEN — Avg per claim ≥"],
  ["b340_green_cost", "GREEN — Total drug cost >"],
  ["b340_yellow_apc", "YELLOW — Avg per claim ≥"],
  ["b340_yellow_cost", "YELLOW — Total drug cost >"],
  ["b340_red_apc", "RED — Avg per claim <"],
  ["b340_red_cost", "RED — Total drug cost <"],
];
const CHRONIC = ["Internal Medicine", "Family Practice", "General Practice", "Cardiology", "Endocrinology", "Nephrology", "Geriatric Medicine", "Pulmonary Disease", "Nurse Practitioner", "Physician Assistant"];

export default function ScoringPanel() {
  const [t, setT] = useState(null);
  const [counts, setCounts] = useState(null);

  useEffect(() => { api.get("/admin/thresholds").then((r) => setT(r.data)); }, []);

  const preview = async (next) => {
    const r = await api.post("/admin/thresholds/preview", { thresholds: next });
    setCounts(r.data);
  };
  const setVal = (k, v) => {
    const next = { ...t, [k]: Number(v) };
    setT(next);
    preview(next);
  };
  const save = async () => {
    await api.put("/admin/thresholds", { thresholds: t });
    toast.success("Thresholds saved");
  };

  if (!t) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-display text-lg font-bold">340B Specialty Pharmacy — Thresholds</h2>
        <p className="mb-4 text-sm text-slate-500">Suits high cost-per-claim prescribers. Evaluated top-down, no fallthrough.</p>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(([k, label]) => (
            <div key={k}>
              <label className="mb-1 block text-xs font-semibold text-slate-500">{label}</label>
              <input data-testid={`threshold-${k}`} type="number" value={t[k]} onChange={(e) => setVal(k, e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          ))}
        </div>
        <button data-testid="save-thresholds" onClick={save} className="mt-4 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white active:scale-95">Save Thresholds</button>
      </div>

      <div className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 font-display font-bold">Live tier distribution (calibration)</h3>
          {counts ? (
            <div className="grid grid-cols-5 gap-2">
              {["GREEN", "YELLOW", "BLUE", "RED", "GREY"].map((tier) => (
                <div key={tier} className="rounded-lg bg-slate-50 p-3 text-center">
                  <div className={`mx-auto mb-1 h-2 w-8 rounded-full ${TIER_STYLES[tier].band}`} />
                  <p data-testid={`count-${tier}`} className="text-lg font-bold">{counts.counts[tier] || 0}</p>
                  <p className="text-[10px] uppercase text-slate-400">{tier}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Change a threshold to preview how many live physicians fall into each tier.</p>
          )}
          {counts && <p className="mt-2 text-xs text-slate-400">{counts.total?.toLocaleString()} physicians in live dataset</p>}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-2 font-display font-bold">RPM — Remote Patient Monitoring</h3>
          <p className="text-sm text-slate-500">Scored on total claim volume. Adjusted ≥8000 GREEN, ≥3000 YELLOW, ≥1000 BLUE, else RED. A 1.25× multiplier applies to chronic-care specialties:</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {CHRONIC.map((c) => <span key={c} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{c}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
