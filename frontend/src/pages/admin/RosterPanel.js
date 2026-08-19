import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Plus, Trash2, PhoneCall } from "lucide-react";
import { toast } from "sonner";

export default function RosterPanel() {
  const [roster, setRoster] = useState([]);
  const [form, setForm] = useState({ name: "", mobile: "", role: "rep", on_duty: true });

  const load = async () => setRoster((await api.get("/admin/roster")).data);
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.name.trim() || !form.mobile.trim()) return toast.error("Name and mobile required");
    await api.post("/admin/roster", form);
    setForm({ name: "", mobile: "", role: "rep", on_duty: true });
    load();
    toast.success("Staff added");
  };
  const toggleDuty = async (s) => { await api.put(`/admin/roster/${s.id}`, { ...s, on_duty: !s.on_duty }); load(); };
  const remove = async (id) => { await api.delete(`/admin/roster/${id}`); load(); };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-display text-lg font-bold">Staff Roster</h2>
        <p className="mb-4 text-sm text-slate-500">Only on-duty staff receive SMS alerts. Use Twilio-verified numbers in E.164 format (e.g. +15551234567).</p>
        <div className="space-y-2">
          {roster.length === 0 && <p className="text-sm text-slate-400">No staff yet.</p>}
          {roster.map((s) => (
            <div key={s.id} data-testid={`roster-${s.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <p className="font-semibold text-slate-900">{s.name} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase text-slate-500">{s.role}</span></p>
                <p className="flex items-center gap-1 text-xs text-slate-500"><PhoneCall className="h-3 w-3" /> {s.mobile}</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                  <input data-testid={`duty-${s.id}`} type="checkbox" checked={s.on_duty} onChange={() => toggleDuty(s)} />
                  {s.on_duty ? <span className="text-emerald-600">On duty</span> : <span className="text-slate-400">Off duty</span>}
                </label>
                <button data-testid={`remove-${s.id}`} onClick={() => remove(s.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 font-display font-bold">Add Staff</h3>
        <input data-testid="staff-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input data-testid="staff-mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+15551234567" className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select data-testid="staff-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="rep">Rep</option>
          <option value="manager">Manager</option>
        </select>
        <button data-testid="add-staff" onClick={add} className="flex w-full items-center justify-center gap-1 rounded-lg bg-primary py-2 text-sm font-semibold text-white active:scale-95"><Plus className="h-4 w-4" /> Add to roster</button>
      </div>
    </div>
  );
}
