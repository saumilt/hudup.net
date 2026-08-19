import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Plus, Trash2, Save, CalendarDays } from "lucide-react";
import { toast } from "sonner";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","IL","IN","MI","NY","NC","OH","PA","TX","VA","WA"];
const BLANK = { name: "", convention_state: "TX", color_scheme: { primary: "#047857", accent: "#10B981" }, associate_ids: [], prize_set_id: "" };

export default function EventsPanel() {
  const [events, setEvents] = useState([]);
  const [roster, setRoster] = useState([]);
  const [prizeSets, setPrizeSets] = useState([]);
  const [editing, setEditing] = useState(BLANK);

  const load = async () => {
    const [e, r, p] = await Promise.all([api.get("/admin/events"), api.get("/admin/roster"), api.get("/admin/prizes")]);
    setEvents(e.data); setRoster(r.data); setPrizeSets(p.data);
  };
  useEffect(() => { load(); }, []);

  const toggleAssoc = (id) => setEditing((ev) => ({ ...ev, associate_ids: ev.associate_ids.includes(id) ? ev.associate_ids.filter((x) => x !== id) : [...ev.associate_ids, id] }));

  const save = async () => {
    if (!editing.name.trim()) return toast.error("Event name required");
    const body = { ...editing, prize_set_id: editing.prize_set_id || null };
    if (editing.id) await api.put(`/admin/events/${editing.id}`, body);
    else await api.post("/admin/events", body);
    toast.success("Event saved");
    setEditing(BLANK);
    load();
  };
  const remove = async (id) => { await api.delete(`/admin/events/${id}`); toast.success("Event deleted"); load(); };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><CalendarDays className="h-5 w-5 text-primary" /> Events</h2>
        <div className="space-y-2">
          {events.length === 0 && <p className="text-sm text-slate-400">No events yet.</p>}
          {events.map((ev) => (
            <div key={ev.id} data-testid={`event-${ev.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-lg" style={{ backgroundColor: ev.color_scheme?.primary }} />
                <div>
                  <p className="font-semibold text-slate-900">{ev.name}</p>
                  <p className="text-xs text-slate-500">{ev.convention_state} · {ev.associate_ids?.length || 0} associates</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button data-testid={`edit-event-${ev.id}`} onClick={() => setEditing({ ...BLANK, ...ev, prize_set_id: ev.prize_set_id || "" })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600">Edit</button>
                {ev.id !== "default" && <button onClick={() => remove(ev.id)} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 font-display font-bold">{editing.id ? "Edit Event" : "Add Event"}</h3>
        <label className="mb-1 block text-xs font-semibold text-slate-500">Event name</label>
        <input data-testid="event-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="HIMSS 2026 Las Vegas" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="mb-3 grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">State</label>
            <select data-testid="event-state" value={editing.convention_state} onChange={(e) => setEditing({ ...editing, convention_state: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
              {STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Primary color</label>
            <input data-testid="event-primary" type="color" value={editing.color_scheme.primary} onChange={(e) => setEditing({ ...editing, color_scheme: { ...editing.color_scheme, primary: e.target.value } })} className="h-9 w-full rounded" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Accent color</label>
            <input data-testid="event-accent" type="color" value={editing.color_scheme.accent} onChange={(e) => setEditing({ ...editing, color_scheme: { ...editing.color_scheme, accent: e.target.value } })} className="h-9 w-full rounded" />
          </div>
        </div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">Prize set</label>
        <select data-testid="event-prizeset" value={editing.prize_set_id} onChange={(e) => setEditing({ ...editing, prize_set_id: e.target.value })} className="mb-3 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="">Use globally-active set</option>
          {prizeSets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="mb-1 block text-xs font-semibold text-slate-500">Associates working this event</label>
        <div className="mb-4 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {roster.length === 0 && <p className="text-xs text-slate-400">Add staff in the Roster tab first.</p>}
          {roster.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input data-testid={`event-assoc-${s.id}`} type="checkbox" checked={editing.associate_ids.includes(s.id)} onChange={() => toggleAssoc(s.id)} />
              {s.name} <span className="text-xs text-slate-400">({s.role})</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button data-testid="save-event" onClick={save} className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white active:scale-95"><Save className="h-4 w-4" /> Save Event</button>
          {editing.id && <button onClick={() => setEditing(BLANK)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">Cancel</button>}
          {!editing.id && <span className="flex items-center gap-1 text-xs text-slate-400"><Plus className="h-3 w-3" /> Creating a new event</span>}
        </div>
      </div>
    </div>
  );
}
