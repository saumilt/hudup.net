import React from "react";
import { Field, inputCls } from "@/components/crm/kit";

// Convert a radius spec {mode, miles, driveMin, mph} to effective straight-line miles.
export function effectiveMiles(r) {
  if (!r) return 0;
  if (r.mode === "min") return Math.round((Number(r.driveMin) || 0) * (Number(r.mph) || 45) / 60);
  return Number(r.miles) || 0;
}

export function radiusLabel(r) {
  const mi = effectiveMiles(r);
  if (r && r.mode === "min" && r.driveMin) return `~${mi} mi (≈${r.driveMin} min @ ${r.mph || 45} mph)`;
  return `${mi} mi`;
}

const chip = (active) =>
  `rounded-full px-2.5 py-1 text-xs font-bold ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`;

export default function RadiusControls({ value, onChange, idPrefix = "r" }) {
  const v = value || { mode: "mi", miles: 0, driveMin: 0, mph: 45 };
  const set = (patch) => onChange({ ...v, ...patch });
  const mode = v.mode || "mi";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex gap-1 pb-1">
        <button type="button" data-testid={`${idPrefix}-mode-mi`} onClick={() => set({ mode: "mi" })} className={chip(mode === "mi")}>Miles</button>
        <button type="button" data-testid={`${idPrefix}-mode-min`} onClick={() => set({ mode: "min" })} className={chip(mode === "min")}>Drive time</button>
      </div>
      {mode === "mi" ? (
        <>
          <Field label="Radius (mi)">
            <input data-testid={`${idPrefix}-miles`} type="number" min={0} value={v.miles || ""} onChange={(e) => set({ miles: Number(e.target.value) })} placeholder="0" className={`${inputCls} w-24`} />
          </Field>
          <div className="flex flex-wrap gap-1 pb-1">
            {[10, 25, 50, 100].map((n) => (
              <button key={n} type="button" data-testid={`${idPrefix}-mi-${n}`} onClick={() => set({ miles: n })} className={chip(v.miles === n)}>{n}mi</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <Field label="Drive time (min)">
            <input data-testid={`${idPrefix}-min`} type="number" min={0} value={v.driveMin || ""} onChange={(e) => set({ driveMin: Number(e.target.value) })} placeholder="0" className={`${inputCls} w-24`} />
          </Field>
          <div className="flex flex-wrap gap-1 pb-1">
            {[15, 30, 45, 60].map((n) => (
              <button key={n} type="button" data-testid={`${idPrefix}-min-${n}`} onClick={() => set({ driveMin: n })} className={chip(v.driveMin === n)}>{n}m</button>
            ))}
          </div>
          <Field label="Avg mph">
            <input data-testid={`${idPrefix}-mph`} type="number" min={5} value={v.mph || 45} onChange={(e) => set({ mph: Number(e.target.value) })} className={`${inputCls} w-20`} />
          </Field>
          <span className="pb-2 text-xs font-semibold text-slate-400">≈ {effectiveMiles({ mode: "min", driveMin: v.driveMin, mph: v.mph })} mi</span>
        </>
      )}
    </div>
  );
}
