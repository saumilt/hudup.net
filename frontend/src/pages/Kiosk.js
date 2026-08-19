import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { submitLead, syncQueue } from "@/lib/offline";
import { ChevronRight, ChevronLeft, Search, Activity, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

const INTERESTS = [
  "340B Program",
  "Remote Patient Monitoring",
  "Hospital Pharmacy Services",
  "MSO Support",
  "Not sure yet",
];
const CONTACT_TEXT =
  "I agree to be contacted about programs and services using the contact information I provided.";
const SMS_TEXT =
  "I agree to receive SMS text messages. Message and data rates may apply. Reply STOP to opt out.";

export default function Kiosk() {
  const nav = useNavigate();
  const [config, setConfig] = useState(null);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [specSearch, setSpecSearch] = useState("");
  const firstRef = useRef(null);
  const eventId = localStorage.getItem("boothiq_event_id") || "default";
  const [form, setForm] = useState({
    first_name: "", last_name: "", phone: "", email: "", npi: "",
    practice: "", city: "", state: "", specialty: "", associate_id: "", associate_name: "",
    interests: [], contact_consent: false, sms_consent: false,
  });

  useEffect(() => {
    let deviceId = localStorage.getItem("boothiq_device_id");
    api.post("/auth/kiosk/register", { device_id: deviceId }).then((r) => {
      localStorage.setItem("boothiq_device_id", r.data.device_id);
    }).catch(() => {});
    api.get(`/kiosk/config?event_id=${eventId}`).then((r) => {
      setConfig(r.data);
      setForm((f) => ({ ...f, state: r.data.convention_state }));
    }).catch(() => {});
    let wakeLock = null;
    if ("wakeLock" in navigator) navigator.wakeLock.request("screen").then((w) => (wakeLock = w)).catch(() => {});
    try {
      const p = window.screen?.orientation?.lock?.("landscape");
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch { /* noop */ }
    syncQueue();
    setTimeout(() => firstRef.current?.focus(), 300);
    return () => { try { wakeLock?.release?.(); } catch { /* noop */ } };
  }, [eventId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleInterest = (i) =>
    setForm((f) => ({ ...f, interests: f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i] }));

  const step1Valid = form.first_name.trim() && form.last_name.trim() &&
    ((form.phone.trim() && !form.email.trim()) || (!form.phone.trim() && form.email.trim()));

  const submit = async () => {
    setSubmitting(true);
    const payload = {
      ...form,
      npi: form.npi.trim() || null,
      consent_text: `CONTACT: ${CONTACT_TEXT} | SMS: ${SMS_TEXT}`,
      device_id: localStorage.getItem("boothiq_device_id"),
      client_created_at: new Date().toISOString(),
      event_id: eventId,
    };
    const res = await submitLead(payload);
    setSubmitting(false);
    if (res.queued) toast.message("Saved offline — will sync automatically");
    nav(`/wheel/${res.id}`, { replace: true });
  };

  if (!config)
    return (
      <div className="flex h-screen items-center justify-center bg-emerald-700 text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );

  const primary = config.color_scheme?.primary || "#047857";
  const filteredSpecs = (specSearch
    ? config.all_specialties.filter((s) => s.toLowerCase().includes(specSearch.toLowerCase()))
    : [...config.common_specialties, ...config.all_specialties.filter((s) => !config.common_specialties.includes(s))]
  ).slice(0, 12);
  const inputCls = "w-full rounded-2xl border-2 border-slate-200 bg-white px-5 py-4 text-xl outline-none focus:border-slate-400";
  const chip = (active) => active ? { backgroundColor: primary, borderColor: primary, color: "#fff" } : {};

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-50 no-select">
      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${primary}0d, #ffffff, ${primary}0d)` }} />
      <div className="relative z-10 flex items-center gap-3 px-8 pt-6">
        <Activity className="h-6 w-6" style={{ color: primary }} />
        <span className="font-display text-lg font-bold" style={{ color: primary }}>{config.event_name || "BoothIQ"}</span>
        <div className="ml-4 flex flex-1 gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-2 flex-1 rounded-full" style={{ backgroundColor: n <= step ? primary : "#e2e8f0" }} />
          ))}
        </div>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col px-8 pt-8">
        {step === 1 && (
          <div className="space-y-4">
            <h1 className="font-display text-4xl font-bold text-slate-900">Welcome! Let&apos;s get you to the wheel</h1>
            <p className="text-lg text-slate-500">Takes 30 seconds. Spin to win a prize.</p>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <input ref={firstRef} data-testid="kiosk-first-name" className={inputCls} placeholder="First name" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
              <input data-testid="kiosk-last-name" className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
            </div>
            <input data-testid="kiosk-phone" inputMode="tel" className={inputCls} placeholder="Mobile number" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            <div className="text-center text-sm font-semibold uppercase tracking-wider text-slate-400">or</div>
            <input data-testid="kiosk-email" type="email" className={inputCls} placeholder="Email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            <input data-testid="kiosk-npi" inputMode="numeric" maxLength={10} className={inputCls} placeholder="NPI — optional, speeds up your prize" value={form.npi} onChange={(e) => set("npi", e.target.value.replace(/\D/g, ""))} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h1 className="font-display text-4xl font-bold text-slate-900">Your practice</h1>
            <input data-testid="kiosk-practice" className={inputCls} placeholder="Practice name" value={form.practice} onChange={(e) => set("practice", e.target.value)} />
            <div className="grid grid-cols-2 gap-4">
              <input data-testid="kiosk-city" className={inputCls} placeholder="City" value={form.city} onChange={(e) => set("city", e.target.value)} />
              <select data-testid="kiosk-state" className={inputCls} value={form.state} onChange={(e) => set("state", e.target.value)}>
                {config.states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input data-testid="kiosk-specialty-search" className={`${inputCls} pl-12`} placeholder="Search specialty" value={form.specialty || specSearch} onChange={(e) => { setSpecSearch(e.target.value); set("specialty", ""); }} />
            </div>
            <div className="flex flex-wrap gap-2">
              {filteredSpecs.map((s) => (
                <button key={s} data-testid={`kiosk-spec-${s}`} onClick={() => { set("specialty", s); setSpecSearch(""); }}
                  style={chip(form.specialty === s)} className="rounded-full border-2 border-slate-200 bg-white px-4 py-2 text-base font-medium text-slate-700 transition">
                  {s}
                </button>
              ))}
            </div>
            {config.associates?.length > 0 && (
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-500">Who helped you today?</label>
                <select data-testid="kiosk-associate" className={inputCls} value={form.associate_id}
                  onChange={(e) => { const a = config.associates.find((x) => x.id === e.target.value); set("associate_id", e.target.value); set("associate_name", a ? a.name : ""); }}>
                  <option value="">Select associate</option>
                  {config.associates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h1 className="font-display text-4xl font-bold text-slate-900">What are you interested in?</h1>
            <div className="flex flex-wrap gap-3">
              {INTERESTS.map((i) => (
                <button key={i} data-testid={`kiosk-interest-${i}`} onClick={() => toggleInterest(i)}
                  style={chip(form.interests.includes(i))} className="rounded-2xl border-2 border-slate-200 bg-white px-5 py-4 text-lg font-medium text-slate-700 transition active:scale-95">
                  {i}
                </button>
              ))}
            </div>
            <label data-testid="kiosk-contact-consent" className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4" onClick={() => set("contact_consent", !form.contact_consent)}>
              <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border-2" style={form.contact_consent ? { backgroundColor: primary, borderColor: primary } : { borderColor: "#cbd5e1" }}>
                {form.contact_consent && <Check className="h-5 w-5 text-white" />}
              </span>
              <span className="text-base text-slate-600">{CONTACT_TEXT}</span>
            </label>
            <label data-testid="kiosk-sms-consent" className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4" onClick={() => set("sms_consent", !form.sms_consent)}>
              <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border-2" style={form.sms_consent ? { backgroundColor: primary, borderColor: primary } : { borderColor: "#cbd5e1" }}>
                {form.sms_consent && <Check className="h-5 w-5 text-white" />}
              </span>
              <span className="text-base text-slate-600">{SMS_TEXT}</span>
            </label>
          </div>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-between gap-4 px-8 py-6">
        {step > 1 ? (
          <button data-testid="kiosk-back" onClick={() => setStep(step - 1)} className="flex items-center gap-1 rounded-full px-5 py-4 text-lg font-semibold text-slate-500">
            <ChevronLeft className="h-5 w-5" /> Back
          </button>
        ) : <span />}
        {step < 3 ? (
          <button data-testid="kiosk-next" disabled={step === 1 && !step1Valid} onClick={() => setStep(step + 1)}
            style={{ backgroundColor: primary }} className="flex items-center gap-2 rounded-full px-10 py-4 text-xl font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-40">
            Continue <ChevronRight className="h-6 w-6" />
          </button>
        ) : (
          <button data-testid="kiosk-submit" disabled={submitting} onClick={submit}
            style={{ backgroundColor: primary }} className="flex items-center gap-2 rounded-full px-10 py-4 text-xl font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-60">
            {submitting ? <Loader2 className="h-6 w-6 animate-spin" /> : "Spin the Wheel!"}
          </button>
        )}
      </div>
    </div>
  );
}
