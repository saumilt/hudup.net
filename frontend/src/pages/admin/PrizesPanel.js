import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Plus, Trash2, Star, BarChart3 } from "lucide-react";
import { toast } from "sonner";

export default function PrizesPanel() {
  const [sets, setSets] = useState([]);
  const [active, setActive] = useState(null);
  const [analytics, setAnalytics] = useState(null);

  const load = async () => {
    const [s, a] = await Promise.all([api.get("/admin/prizes"), api.get("/admin/prizes/analytics")]);
    setSets(s.data);
    setAnalytics(a.data);
    const act = s.data.find((x) => x.active) || s.data[0];
    setActive(act ? JSON.parse(JSON.stringify(act)) : null);
  };
  useEffect(() => { load(); }, []);

  const updateSeg = (i, k, v) => {
    const segs = [...active.segments];
    segs[i] = { ...segs[i], [k]: k === "weight" || k === "inventory" ? (v === "" ? null : Number(v)) : v };
    setActive({ ...active, segments: segs });
  };
  const addSeg = () => setActive({ ...active, segments: [...active.segments, { id: `s${Date.now()}`, label: "New Prize", color: "#10B981", prize_name: "New Prize", weight: 10, inventory: 100 }] });
  const removeSeg = (i) => setActive({ ...active, segments: active.segments.filter((_, idx) => idx !== i) });

  const save = async () => {
    await api.put(`/admin/prizes/${active.id}`, { name: active.name, event_id: active.event_id, segments: active.segments });
    toast.success("Prize set saved");
    load();
  };
  const createSet = async () => {
    const name = window.prompt("New prize set name (per-event)");
    if (!name) return;
    const r = await api.post("/admin/prizes", { name, segments: active?.segments || [] });
    setActive(JSON.parse(JSON.stringify(r.data)));
    load();
  };
  const activate = async (id) => { await api.post(`/admin/prizes/${id}/activate`); toast.success("Prize set activated"); load(); };

  if (!active) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold">Prize Wheel Configuration</h2>
              <p className="text-sm text-slate-500">Weighted odds control prize cost. Zero-inventory segments auto-drop from the wheel. Odds are never based on the doctor&apos;s score.</p>
            </div>
            <select data-testid="prize-set-select" value={active.id} onChange={(e) => setActive(JSON.parse(JSON.stringify(sets.find((s) => s.id === e.target.value))))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? " (active)" : ""}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            {active.segments.map((seg, i) => (
              <div key={seg.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2" data-testid={`segment-${i}`}>
                <input type="color" value={seg.color} onChange={(e) => updateSeg(i, "color", e.target.value)} className="h-9 w-9 rounded" />
                <input value={seg.label} onChange={(e) => updateSeg(i, "label", e.target.value)} placeholder="Label" className="w-28 rounded border border-slate-200 px-2 py-1.5 text-sm" />
                <input value={seg.prize_name} onChange={(e) => updateSeg(i, "prize_name", e.target.value)} placeholder="Prize name" className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-sm" />
                <div><label className="block text-[9px] uppercase text-slate-400">Weight</label><input type="number" value={seg.weight ?? ""} onChange={(e) => updateSeg(i, "weight", e.target.value)} className="w-16 rounded border border-slate-200 px-2 py-1 text-sm" /></div>
                <div><label className="block text-[9px] uppercase text-slate-400">Inventory</label><input type="number" value={seg.inventory ?? ""} onChange={(e) => updateSeg(i, "inventory", e.target.value)} className="w-16 rounded border border-slate-200 px-2 py-1 text-sm" /></div>
                <button onClick={() => removeSeg(i)} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button data-testid="add-segment" onClick={addSeg} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600"><Plus className="h-4 w-4" /> Add segment</button>
            <button data-testid="save-prizes" onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">Save</button>
            <button onClick={createSet} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">New Set (per event)</button>
            {!active.active && <button data-testid="activate-set" onClick={() => activate(active.id)} className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white"><Star className="h-4 w-4" /> Activate</button>}
          </div>
        </div>
      </div>

      <div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 flex items-center gap-2 font-display font-bold"><BarChart3 className="h-5 w-5 text-primary" /> Wheel Analytics</h3>
          {analytics && (
            <>
              <p className="text-sm text-slate-500">Spins completed: <span className="font-bold text-slate-900">{analytics.spins_completed}</span></p>
              <div className="mt-3 space-y-2">
                {(analytics.active_set?.segments || []).map((s) => {
                  const won = analytics.distribution.find((d) => d.label === s.label)?.count || 0;
                  return (
                    <div key={s.id} className="text-xs">
                      <div className="flex justify-between"><span className="font-medium">{s.label}</span><span className="text-slate-500">{won} won · {s.inventory ?? "∞"} left</span></div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (s.weight || 0))}%`, background: s.color }} /></div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
