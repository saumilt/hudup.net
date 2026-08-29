import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/lib/api";
import { Activity, Loader2, CheckCircle2, Gift, PartyPopper } from "lucide-react";

const INTERESTS = ["340B Pharmacy", "Remote Patient Monitoring", "Chronic Care Management", "Hospital Pharmacy Services"];

// Public, unauthenticated booth self-registration. A walk-up physician scans the
// event QR poster, fills this on their own phone, and becomes a booth lead — the
// same pipeline as the iPad kiosk (matching, scoring, staff alerts, prize wheel).
export default function SelfRegister() {
  const { eventId } = useParams();
  const nav = useNavigate();
  const [cfg, setCfg] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(null);
  const [err, setErr] = React.useState("");
  const [f, setF] = React.useState({
    first_name: "", last_name: "", email: "", phone: "", npi: "",
    practice: "", specialty: "", city: "", state: "", interests: [], consent: false,
  });

  React.useEffect(() => {
    axios.get(`${API}/kiosk/config`, { params: { event_id: eventId } })
      .then((r) => setCfg(r.data))
      .catch(() => setCfg({ event_name: "BoothIQ Event", all_specialties: [], states: [] }))
      .finally(() => setLoading(false));
  }, [eventId]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const toggleInterest = (i) =>
    setF((p) => ({ ...p, interests: p.interests.includes(i) ? p.interests.filter((x) => x !== i) : [...p.interests, i] }));

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!f.first_name.trim() || !f.last_name.trim()) return setErr("Please enter your first and last name.");
    if (!f.consent) return setErr("Please agree to be contacted so our team can follow up.");
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/kiosk/leads`, {
        first_name: f.first_name.trim(), last_name: f.last_name.trim(),
        email: f.email.trim() || null, phone: f.phone.trim() || null,
        npi: f.npi.trim() || null, practice: f.practice.trim() || null,
        specialty: f.specialty || null, city: f.city.trim() || null, state: f.state || null,
        interests: f.interests,
        contact_consent: true, sms_consent: f.consent,
        consent_text: "Self check-in: I agree to be contacted by the BoothIQ team.",
        event_id: eventId || "default",
      });
      setDone(data);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const primary = cfg?.color_scheme?.primary || "#047857";
  const specialties = cfg?.all_specialties || cfg?.common_specialties || [];
  const states = cfg?.states || [];

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center" data-testid="selfreg-success">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-11 w-11 text-emerald-600" />
        </div>
        <h1 className="font-display text-2xl font-bold text-slate-900">You're checked in!</h1>
        <p className="mt-2 max-w-sm text-slate-500">Thanks, Dr. {f.last_name}. A member of our team will follow up shortly.</p>
        {done.spin_available && (
          <button data-testid="selfreg-spin" onClick={() => nav(`/wheel/${done.id}`)}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-8 py-4 text-lg font-bold text-white shadow-lg transition-transform active:scale-95">
            <Gift className="h-5 w-5" /> Spin the Prize Wheel
          </button>
        )}
        <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-400"><PartyPopper className="h-3.5 w-3.5" /> Powered by BoothIQ</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="px-5 pt-8 text-center text-white" style={{ background: `linear-gradient(135deg, ${primary}, #065F46)` }}>
        <div className="mx-auto max-w-md pb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold tracking-wide"><Activity className="h-4 w-4" /> BOOTHIQ</div>
          <h1 className="font-display text-2xl font-bold">{cfg?.event_name || "Welcome"}</h1>
          <p className="mt-1 text-sm text-white/80">Check in at our booth — tell us who you are and we'll take it from here.</p>
        </div>
      </div>

      <form onSubmit={submit} data-testid="selfreg-form" className="mx-auto -mt-5 max-w-md space-y-3 px-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name *"><input data-testid="sr-first" className={inp} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} /></Field>
            <Field label="Last name *"><input data-testid="sr-last" className={inp} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} /></Field>
          </div>
          <Field label="Email"><input data-testid="sr-email" type="email" className={inp} value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Mobile phone"><input data-testid="sr-phone" className={inp} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Practice / Organization"><input data-testid="sr-practice" className={inp} value={f.practice} onChange={(e) => set("practice", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Specialty">
              <select data-testid="sr-specialty" className={inp} value={f.specialty} onChange={(e) => set("specialty", e.target.value)}>
                <option value="">Select…</option>
                {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="State">
              <select data-testid="sr-state" className={inp} value={f.state} onChange={(e) => set("state", e.target.value)}>
                <option value="">Select…</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="City"><input data-testid="sr-city" className={inp} value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="NPI (optional)"><input data-testid="sr-npi" className={inp} value={f.npi} onChange={(e) => set("npi", e.target.value)} /></Field>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-slate-700">What are you interested in?</p>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((i) => {
              const on = f.interests.includes(i);
              return (
                <button type="button" key={i} data-testid={`sr-interest-${i}`} onClick={() => toggleInterest(i)}
                  className={`rounded-full border px-3 py-2 text-sm font-semibold transition-colors ${on ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                  {i}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          <input data-testid="sr-consent" type="checkbox" className="mt-0.5 h-5 w-5 accent-emerald-600" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
          <span>I agree to be contacted by phone, text or email by the BoothIQ team about relevant programs.</span>
        </label>

        {err && <p data-testid="selfreg-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{err}</p>}

        <button data-testid="selfreg-submit" type="submit" disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-4 text-lg font-bold text-white shadow-lg transition-transform active:scale-95 disabled:opacity-60">
          {busy && <Loader2 className="h-5 w-5 animate-spin" />} Check In
        </button>
        <p className="pt-1 text-center text-xs text-slate-400">Powered by BoothIQ</p>
      </form>
    </div>
  );
}

const inp = "w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}
