import React from "react";

export const TIER_STYLES = {
  GREEN: { band: "bg-emerald-500", text: "text-emerald-700", chip: "bg-emerald-100 text-emerald-800 border-emerald-200", label: "GREEN" },
  YELLOW: { band: "bg-amber-500", text: "text-amber-700", chip: "bg-amber-100 text-amber-800 border-amber-200", label: "YELLOW" },
  BLUE: { band: "bg-blue-500", text: "text-blue-700", chip: "bg-blue-100 text-blue-800 border-blue-200", label: "BLUE" },
  RED: { band: "bg-red-500", text: "text-red-700", chip: "bg-red-100 text-red-800 border-red-200", label: "RED" },
  GREY: { band: "bg-slate-300", text: "text-slate-500", chip: "bg-slate-100 text-slate-600 border-slate-200", label: "GREY" },
};

export function TierChip({ label, tier, testId }) {
  const s = TIER_STYLES[tier] || TIER_STYLES.GREY;
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${s.chip}`}
    >
      <span className={`h-2 w-2 rounded-full ${s.band}`} />
      {label} {s.label}
    </span>
  );
}
