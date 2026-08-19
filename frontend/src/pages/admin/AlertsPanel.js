import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { TIER_STYLES } from "@/components/TierBadge";
import { toast } from "sonner";

const SCORES = [["340b", "340B"], ["rpm", "RPM"]];
const TIERS = ["GREEN", "YELLOW", "BLUE", "RED", "GREY"];

export default function AlertsPanel() {
  const [rules, setRules] = useState(null);
  const [ceiling, setCeiling] = useState(20);
  const [roster, setRoster] = useState([]);

  useEffect(() => {
    api.get("/admin/alert-rules").then((r) => { setRules(r.data.rules || {}); setCeiling(r.data.ceiling_per_hour || 20); });
    api.get("/admin/roster").then((r) => setRoster(r.data));
  }, []);

  const getRule = (score, tier) => rules?.[score]?.[tier] || { send: false, recipients: "all" };
  const setRule = (score, tier, patch) => {
    setRules((prev) => ({ ...prev, [score]: { ...(prev[score] || {}), [tier]: { ...getRule(score, tier), ...patch } } }));
  };
  const save = async () => {
    await api.put("/admin/alert-rules", { rules, ceiling_per_hour: Number(ceiling) });
    toast.success("Alert rules saved");
  };

  if (!rules) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-display text-lg font-bold">SMS Alert Rules</h2>
        <p className="mb-4 text-sm text-slate-500">Choose which tiers text staff. Alerts go to on-duty staff only, from the backend — never to the physician.</p>
        {SCORES.map(([score, label]) => (
          <div key={score} className="mb-5">
            <h3 className="mb-2 font-semibold">{label} Score</h3>
            <div className="grid gap-2 sm:grid-cols-5">
              {TIERS.map((tier) => {
                const rule = getRule(score, tier);
                return (
                  <div key={tier} className={`rounded-lg border p-3 ${rule.send ? "border-primary bg-primary/5" : "border-slate-200"}`}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${TIER_STYLES[tier].band}`} />
                      <span className="text-sm font-semibold">{tier}</span>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input data-testid={`rule-${score}-${tier}`} type="checkbox" checked={rule.send} onChange={(e) => setRule(score, tier, { send: e.target.checked })} />
                      Send SMS
                    </label>
                    {rule.send && (
                      <select value={Array.isArray(rule.recipients) ? "subset" : "all"} onChange={(e) => setRule(score, tier, { recipients: e.target.value === "all" ? "all" : [] })} className="mt-2 w-full rounded border border-slate-200 px-1.5 py-1 text-xs">
                        <option value="all">All on-duty</option>
                        <option value="subset">Specific staff</option>
                      </select>
                    )}
                    {rule.send && Array.isArray(rule.recipients) && (
                      <div className="mt-1 space-y-0.5">
                        {roster.map((st) => (
                          <label key={st.id} className="flex items-center gap-1 text-[11px]">
                            <input type="checkbox" checked={rule.recipients.includes(st.id)} onChange={(e) => {
                              const set = new Set(rule.recipients);
                              e.target.checked ? set.add(st.id) : set.delete(st.id);
                              setRule(score, tier, { recipients: [...set] });
                            }} />
                            {st.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-slate-600">Max alerts / staff / hour</label>
          <input data-testid="alert-ceiling" type="number" value={ceiling} onChange={(e) => setCeiling(e.target.value)} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          <span className="text-xs text-slate-400">Beyond this, alerts fall back to a digest.</span>
        </div>
        <button data-testid="save-alert-rules" onClick={save} className="mt-4 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white">Save Rules</button>
      </div>
    </div>
  );
}
