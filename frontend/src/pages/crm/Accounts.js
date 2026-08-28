import React, { useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, Field, inputCls, EmptyState, Modal } from "@/components/crm/kit";
import { Building2, Plus, Stethoscope } from "lucide-react";

export default function Accounts() {
  const [tab, setTab] = useState("accounts");
  const [accounts, setAccounts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [show, setShow] = useState(false);
  const [acc, setAcc] = useState({ name: "", type: "", city: "", state: "" });
  const [con, setCon] = useState({ first_name: "", last_name: "", npi: "", specialty: "", city: "", state: "", phone: "", email: "" });

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([api.get("/crm/accounts"), api.get("/crm/physicians")]);
    setAccounts(a.data); setContacts(c.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      if (tab === "accounts") { await api.post("/crm/accounts", acc); toast.success("Account created"); }
      else {
        const r = await api.post("/crm/physicians", con);
        if (r.data.duplicate) return toast.error(`Possible duplicate: ${r.data.contact.first_name} ${r.data.contact.last_name}`);
        toast.success("Contact created");
      }
      setShow(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Accounts / Physicians">
        <div className="flex gap-1">
          <button data-testid="tab-accounts" onClick={() => setTab("accounts")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "accounts" ? "bg-primary text-white" : "border border-slate-200 text-slate-600"}`}>Accounts</button>
          <button data-testid="tab-contacts" onClick={() => setTab("contacts")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "contacts" ? "bg-primary text-white" : "border border-slate-200 text-slate-600"}`}>Physician Contacts</button>
        </div>
        <Btn onClick={() => setShow(true)} data-testid="acc-new"><Plus className="h-4 w-4" /> New</Btn>
      </PageHeader>

      <div className="p-6">
        {tab === "accounts" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {accounts.length === 0 && <EmptyState icon={Building2} title="No accounts" hint="Create a practice/organization record." />}
            {accounts.map((a) => (
              <div key={a.id} data-testid={`account-${a.id}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-display font-bold text-slate-800">{a.name}</p>
                <p className="text-sm text-slate-500">{a.type || "—"} · {a.city || "?"}, {a.state || ""}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {contacts.length === 0 && <EmptyState icon={Stethoscope} title="No contacts" hint="Add durable physician contacts." />}
            {contacts.map((c) => (
              <div key={c.id} data-testid={`contact-${c.id}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-display font-bold text-slate-800">Dr. {c.first_name} {c.last_name}</p>
                <p className="text-sm text-slate-500">{c.specialty || "—"} · {c.city || "?"}, {c.state || ""}</p>
                {c.npi && <p className="mt-1 font-mono text-xs text-slate-400">NPI {c.npi}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={show} onClose={() => setShow(false)} title={tab === "accounts" ? "New Account" : "New Physician Contact"}>
        {tab === "accounts" ? (
          <>
            <Field label="Name"><input data-testid="acc-name" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type"><input value={acc.type} onChange={(e) => setAcc({ ...acc, type: e.target.value })} className={inputCls} /></Field>
              <Field label="City"><input value={acc.city} onChange={(e) => setAcc({ ...acc, city: e.target.value })} className={inputCls} /></Field>
              <Field label="State"><input value={acc.state} onChange={(e) => setAcc({ ...acc, state: e.target.value })} className={inputCls} /></Field>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name"><input data-testid="con-first" value={con.first_name} onChange={(e) => setCon({ ...con, first_name: e.target.value })} className={inputCls} /></Field>
              <Field label="Last name"><input data-testid="con-last" value={con.last_name} onChange={(e) => setCon({ ...con, last_name: e.target.value })} className={inputCls} /></Field>
              <Field label="NPI"><input value={con.npi} onChange={(e) => setCon({ ...con, npi: e.target.value })} className={inputCls} /></Field>
              <Field label="Specialty"><input value={con.specialty} onChange={(e) => setCon({ ...con, specialty: e.target.value })} className={inputCls} /></Field>
              <Field label="City"><input value={con.city} onChange={(e) => setCon({ ...con, city: e.target.value })} className={inputCls} /></Field>
              <Field label="State"><input value={con.state} onChange={(e) => setCon({ ...con, state: e.target.value })} className={inputCls} /></Field>
              <Field label="Phone"><input value={con.phone} onChange={(e) => setCon({ ...con, phone: e.target.value })} className={inputCls} /></Field>
              <Field label="Email"><input value={con.email} onChange={(e) => setCon({ ...con, email: e.target.value })} className={inputCls} /></Field>
            </div>
          </>
        )}
        <Btn onClick={save} data-testid="acc-save" className="mt-2 w-full justify-center">Save</Btn>
      </Modal>
    </div>
  );
}
