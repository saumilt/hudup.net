import React from "react";
import { X } from "lucide-react";

export const money = (v) =>
  v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${Number(v).toFixed(0)}`;
export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtDay = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const TIER_CHIP = {
  GREEN: "bg-emerald-100 text-emerald-700", YELLOW: "bg-amber-100 text-amber-700",
  BLUE: "bg-blue-100 text-blue-700", RED: "bg-red-100 text-red-700", GREY: "bg-slate-200 text-slate-600",
};
export function TierPill({ kind, tier }) {
  if (!tier) return <span className="text-slate-300">—</span>;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${TIER_CHIP[tier] || TIER_CHIP.GREY}`}>{kind} {tier}</span>;
}

const STATUS_COLOR = {
  New: "bg-slate-100 text-slate-700", "Attempting Contact": "bg-sky-100 text-sky-700",
  Contacted: "bg-blue-100 text-blue-700", Qualified: "bg-indigo-100 text-indigo-700",
  "Meeting Scheduled": "bg-violet-100 text-violet-700", Opportunity: "bg-emerald-100 text-emerald-700",
  Nurture: "bg-amber-100 text-amber-700", Won: "bg-green-600 text-white",
  Lost: "bg-red-100 text-red-700", Disqualified: "bg-red-100 text-red-700",
};
export function StatusBadge({ status }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOR[status] || "bg-slate-100 text-slate-700"}`}>{status}</span>;
}

const PRIO = { Urgent: "text-red-600", High: "text-amber-600", Medium: "text-slate-500", Low: "text-slate-400" };
export function PriorityTag({ priority }) {
  return <span className={`text-xs font-semibold ${PRIO[priority] || "text-slate-500"}`}>{priority || "—"}</span>;
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl bg-white shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
          <button data-testid="modal-close" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}
export const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
      {Icon && <Icon className="mx-auto mb-3 h-10 w-10 text-slate-300" />}
      <p className="font-semibold text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-400">{hint}</p>}
    </div>
  );
}

export function Btn({ children, variant = "primary", className = "", ...props }) {
  const base = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-transform active:scale-95 disabled:opacity-50";
  const styles = {
    primary: "bg-primary text-white hover:bg-primary/90",
    dark: "bg-slate-900 text-white hover:bg-slate-800",
    ghost: "border border-slate-200 text-slate-600 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props}>{children}</button>;
}

export function StatCard({ label, value, sub, testid }) {
  return (
    <div data-testid={testid} className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// Win-probability derived from the two Medicare tiers (color-coded).
export function leadProbability(snap) {
  const a = snap?.tier_340b, b = snap?.tier_rpm;
  const has = (t) => a === t || b === t;
  if (has("GREEN")) return { label: "Hot", color: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" };
  if (has("YELLOW")) return { label: "Warm", color: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" };
  if (has("BLUE")) return { label: "Cool", color: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50" };
  return { label: "Cold", color: "bg-slate-300", text: "text-slate-500", bg: "bg-slate-50" };
}
export function ProbabilityBadge({ snapshot, showLabel = true, testid }) {
  const p = leadProbability(snapshot);
  return (
    <span data-testid={testid} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${p.bg}`} title={`Win probability: ${p.label}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${p.color}`} />
      {showLabel && <span className={`text-xs font-bold ${p.text}`}>{p.label}</span>}
    </span>
  );
}

// Data-completeness score for a lead (distinct from sales/Medicare value).
export function leadCompleteness(lead) {
  const e = lead?.enrichment || {};
  const pr = lead?.practice || {};
  const checks = [
    ["NPI", lead?.matched_npi || lead?.npi],
    ["Specialty", (lead?.medicare_snapshot || {}).specialty || lead?.specialty],
    ["Practice", lead?.org_name],
    ["Phone", lead?.phone],
    ["Email", lead?.email],
    ["Medicare match", lead?.medicare_match_status === "matched"],
    ["Website", pr.website],
    ["LinkedIn", e.linkedin_url],
    ["Location", lead?.city && lead?.state],
  ];
  const have = checks.filter(([, v]) => !!v).length;
  return { pct: Math.round((have / checks.length) * 100), checks };
}
export function CompletenessBadge({ lead, testid }) {
  const { pct } = leadCompleteness(lead);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <span data-testid={testid} className="inline-flex items-center gap-1.5" title="Data completeness">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full ${color}`} style={{ width: `${pct}%` }} /></span>
      <span className="text-xs font-bold text-slate-500">{pct}%</span>
    </span>
  );
}
