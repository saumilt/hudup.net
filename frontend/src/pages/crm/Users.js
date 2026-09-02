import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, Field, inputCls, Modal } from "@/components/crm/kit";
import { Plus, KeyRound, Mail, Copy, CheckCircle2, Send, Pencil, Trash2 } from "lucide-react";

const ROLE_BADGE = {
  admin: "bg-slate-900 text-white", lead_manager: "bg-indigo-100 text-indigo-700",
  account_manager: "bg-emerald-100 text-emerald-700", staff: "bg-slate-100 text-slate-600",
};

export default function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [show, setShow] = useState(false);
  const [autoPin, setAutoPin] = useState(true);
  const [saving, setSaving] = useState(false);
  const [u, setU] = useState({ name: "", email: "", pin: "", role: "account_manager", title: "", phone: "" });
  const [invite, setInvite] = useState(null); // {name, email, temp_pin, invite_sent}
  const [edit, setEdit] = useState(null); // user being edited
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => { const r = await api.get("/users"); setUsers(r.data); }, []);
  useEffect(() => { load(); api.get("/users/roles").then((r) => setRoles(r.data)).catch(() => {}); }, [load]);

  const resetForm = () => { setU({ name: "", email: "", pin: "", role: "account_manager", title: "", phone: "" }); setAutoPin(true); };

  const create = async () => {
    if (!u.name.trim() || !u.email.trim()) return toast.error("Name and email are required");
    setSaving(true);
    try {
      const payload = {
        name: u.name, email: u.email, role: u.role, title: u.title, phone: u.phone,
        send_invite: autoPin,
        ...(autoPin ? {} : { pin: u.pin }),
      };
      const r = await api.post("/users", payload);
      setShow(false); resetForm(); load();
      if (r.data.temp_pin) {
        setInvite({ name: r.data.name, email: r.data.email, temp_pin: r.data.temp_pin, invite_sent: r.data.invite_sent });
      } else {
        toast.success("User created");
      }
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const openEdit = (usr) => setEdit({ id: usr.id, name: usr.name || "", email: usr.email || "", phone: usr.phone || "", title: usr.title || "", role: usr.role });
  const saveEdit = async () => {
    if (!edit.name.trim() || !edit.email.trim()) return toast.error("Name and email are required");
    setSavingEdit(true);
    try {
      await api.patch(`/users/${edit.id}`, { name: edit.name, email: edit.email, phone: edit.phone, title: edit.title, role: edit.role });
      toast.success("User updated"); setEdit(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingEdit(false); }
  };
  const removeUser = async (usr) => {
    if (!window.confirm(`Delete ${usr.name || usr.email}? This permanently removes their account.`)) return;
    try { await api.delete(`/users/${usr.id}`); toast.success("User deleted"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const sendInvite = async (usr) => {
    if (!window.confirm(`Send a new temporary PIN invite to ${usr.email}?`)) return;
    try {
      const r = await api.post(`/users/${usr.id}/invite`);
      setInvite({ name: usr.name, email: usr.email, temp_pin: r.data.temp_pin, invite_sent: r.data.invite_sent });
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const changeRole = async (id, role) => { await api.patch(`/users/${id}`, { role }); toast.success("Role updated"); load(); };
  const toggleActive = async (id, active) => { await api.patch(`/users/${id}`, { active }); load(); };
  const resetPin = async (id) => { const pin = window.prompt("New PIN (4-8 digits)"); if (!pin) return; try { await api.post(`/users/${id}/reset-pin`, { pin }); toast.success("PIN reset"); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } };

  return (
    <div>
      <PageHeader title="Users & Roles" subtitle="Invite team members and assign CRM roles">
        <Btn onClick={() => { resetForm(); setShow(true); }} data-testid="user-new"><Plus className="h-4 w-4" /> New User</Btn>
      </PageHeader>
      <div className="p-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Phone</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Active</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {users.map((usr) => (
                <tr key={usr.id} data-testid={`user-row-${usr.id}`} className="border-t border-slate-100">
                  <td className="p-3 font-semibold text-slate-800">{usr.name}{usr.title ? <span className="ml-1 text-xs text-slate-400">· {usr.title}</span> : null}</td>
                  <td className="p-3 text-slate-600">{usr.email}</td>
                  <td className="p-3 text-slate-500">{usr.phone || <span className="text-slate-300">—</span>}</td>
                  <td className="p-3">
                    <select data-testid={`user-role-${usr.id}`} value={usr.role} onChange={(e) => changeRole(usr.id, e.target.value)} className={`rounded-full px-2 py-1 text-xs font-semibold ${ROLE_BADGE[usr.role] || ""}`}>
                      {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="p-3">
                    {usr.must_change_pin
                      ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Invite pending</span>
                      : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">Active</span>}
                  </td>
                  <td className="p-3"><input type="checkbox" checked={usr.active !== false} onChange={(e) => toggleActive(usr.id, e.target.checked)} data-testid={`user-active-${usr.id}`} /></td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openEdit(usr)} data-testid={`user-edit-${usr.id}`} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                      <button onClick={() => sendInvite(usr)} data-testid={`user-invite-${usr.id}`} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"><Send className="h-3.5 w-3.5" /> Invite</button>
                      <button onClick={() => resetPin(usr.id)} data-testid={`user-resetpin-${usr.id}`} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"><KeyRound className="h-3.5 w-3.5" /> Reset PIN</button>
                      <button onClick={() => removeUser(usr)} data-testid={`user-delete-${usr.id}`} className="flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create user */}
      <Modal open={show} onClose={() => setShow(false)} title="New Team Member">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input data-testid="user-name" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} className={inputCls} /></Field>
          <Field label="Title"><input value={u.title} onChange={(e) => setU({ ...u, title: e.target.value })} className={inputCls} /></Field>
          <Field label="Email"><input data-testid="user-email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} className={inputCls} /></Field>
          <Field label="Phone"><input data-testid="user-phone" value={u.phone} onChange={(e) => setU({ ...u, phone: e.target.value })} className={inputCls} inputMode="tel" placeholder="+1…" /></Field>
          <Field label="Role"><select data-testid="user-role-new" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })} className={inputCls}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
        </div>
        <label className="mt-1 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600">
          <input type="checkbox" data-testid="user-auto-pin" checked={autoPin} onChange={(e) => setAutoPin(e.target.checked)} />
          <Mail className="h-4 w-4 text-primary" /> Auto-generate a temporary PIN &amp; email an invite
        </label>
        {!autoPin && (
          <Field label="PIN (4-8 digits)"><input data-testid="user-pin" value={u.pin} onChange={(e) => setU({ ...u, pin: e.target.value })} className={inputCls} inputMode="numeric" /></Field>
        )}
        <Btn onClick={create} disabled={saving} data-testid="user-save" className="mt-3 w-full justify-center">{saving ? "Creating…" : "Create User"}</Btn>
      </Modal>

      {/* Edit user */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit User">
        {edit && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><input data-testid="edit-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} /></Field>
              <Field label="Title"><input data-testid="edit-title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className={inputCls} /></Field>
              <Field label="Email"><input data-testid="edit-email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className={inputCls} /></Field>
              <Field label="Phone"><input data-testid="edit-phone" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} className={inputCls} inputMode="tel" placeholder="+1…" /></Field>
              <Field label="Role"><select data-testid="edit-role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} className={inputCls}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
            </div>
            <Btn onClick={saveEdit} disabled={savingEdit} data-testid="edit-save" className="mt-3 w-full justify-center">{savingEdit ? "Saving…" : "Save Changes"}</Btn>
          </>
        )}
      </Modal>

      {/* Invite result */}
      <Modal open={!!invite} onClose={() => setInvite(null)} title="Team member invited">
        {invite && (
          <div data-testid="invite-result" className="text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
            <p className="text-slate-600">
              {invite.invite_sent
                ? <>An invite with a temporary PIN was emailed to <b>{invite.email}</b>.</>
                : <>User created for <b>{invite.email}</b>. Email could not be sent — share this temporary PIN directly:</>}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <span data-testid="invite-temp-pin" className="rounded-xl bg-emerald-50 px-6 py-3 font-display text-3xl font-bold tracking-[0.3em] text-emerald-700">{invite.temp_pin}</span>
              <Btn variant="ghost" onClick={() => { navigator.clipboard.writeText(invite.temp_pin); toast.success("Copied"); }}><Copy className="h-4 w-4" /></Btn>
            </div>
            <p className="mt-3 text-xs text-slate-400">They'll be asked to choose a new PIN on first sign-in.</p>
            <Btn onClick={() => setInvite(null)} className="mt-5 w-full justify-center">Done</Btn>
          </div>
        )}
      </Modal>
    </div>
  );
}
