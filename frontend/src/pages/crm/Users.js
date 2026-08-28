import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, Field, inputCls, Modal } from "@/components/crm/kit";
import { UserCog, Plus, KeyRound } from "lucide-react";

const ROLE_BADGE = {
  admin: "bg-slate-900 text-white", lead_manager: "bg-indigo-100 text-indigo-700",
  account_manager: "bg-emerald-100 text-emerald-700", staff: "bg-slate-100 text-slate-600",
};

export default function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [show, setShow] = useState(false);
  const [u, setU] = useState({ name: "", email: "", pin: "", role: "account_manager", title: "" });

  const load = useCallback(async () => { const r = await api.get("/users"); setUsers(r.data); }, []);
  useEffect(() => { load(); api.get("/users/roles").then((r) => setRoles(r.data)).catch(() => {}); }, [load]);

  const create = async () => {
    try {
      await api.post("/users", u);
      toast.success("User created"); setShow(false);
      setU({ name: "", email: "", pin: "", role: "account_manager", title: "" }); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const changeRole = async (id, role) => { await api.patch(`/users/${id}`, { role }); toast.success("Role updated"); load(); };
  const toggleActive = async (id, active) => { await api.patch(`/users/${id}`, { active }); load(); };
  const resetPin = async (id) => { const pin = window.prompt("New PIN (4-8 digits)"); if (!pin) return; try { await api.post(`/users/${id}/reset-pin`, { pin }); toast.success("PIN reset"); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } };

  return (
    <div>
      <PageHeader title="Users & Roles" subtitle="Create Lead Managers, Account Managers and booth staff">
        <Btn onClick={() => setShow(true)} data-testid="user-new"><Plus className="h-4 w-4" /> New User</Btn>
      </PageHeader>
      <div className="p-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Active</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {users.map((usr) => (
                <tr key={usr.id} data-testid={`user-row-${usr.id}`} className="border-t border-slate-100">
                  <td className="p-3 font-semibold text-slate-800">{usr.name}{usr.title ? <span className="ml-1 text-xs text-slate-400">· {usr.title}</span> : null}</td>
                  <td className="p-3 text-slate-600">{usr.email}</td>
                  <td className="p-3">
                    <select data-testid={`user-role-${usr.id}`} value={usr.role} onChange={(e) => changeRole(usr.id, e.target.value)} className={`rounded-full px-2 py-1 text-xs font-semibold ${ROLE_BADGE[usr.role] || ""}`}>
                      {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="p-3"><input type="checkbox" checked={usr.active !== false} onChange={(e) => toggleActive(usr.id, e.target.checked)} data-testid={`user-active-${usr.id}`} /></td>
                  <td className="p-3"><button onClick={() => resetPin(usr.id)} data-testid={`user-resetpin-${usr.id}`} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"><KeyRound className="h-3.5 w-3.5" /> Reset PIN</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={show} onClose={() => setShow(false)} title="New User">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input data-testid="user-name" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} className={inputCls} /></Field>
          <Field label="Title"><input value={u.title} onChange={(e) => setU({ ...u, title: e.target.value })} className={inputCls} /></Field>
          <Field label="Email"><input data-testid="user-email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} className={inputCls} /></Field>
          <Field label="PIN (4-8 digits)"><input data-testid="user-pin" value={u.pin} onChange={(e) => setU({ ...u, pin: e.target.value })} className={inputCls} inputMode="numeric" /></Field>
        </div>
        <Field label="Role"><select data-testid="user-role-new" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })} className={inputCls}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
        <Btn onClick={create} data-testid="user-save" className="mt-2 w-full justify-center">Create User</Btn>
      </Modal>
    </div>
  );
}
