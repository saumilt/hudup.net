import React from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/lib/api";
import { CheckCircle2, Loader2, Activity } from "lucide-react";

const FIELD_META = {
  contact_first: { label: "First Name", type: "text", ph: "Jane" },
  contact_last: { label: "Last Name", type: "text", ph: "Doe" },
  org_name: { label: "Practice / Organization", type: "text", ph: "Wellness Medical Group" },
  email: { label: "Email", type: "email", ph: "you@practice.com" },
  phone: { label: "Phone", type: "tel", ph: "(555) 123-4567" },
  specialty: { label: "Specialty", type: "text", ph: "Cardiology" },
  city: { label: "City", type: "text", ph: "Austin" },
  state: { label: "State", type: "text", ph: "TX" },
};

export default function CaptureForm() {
  const { slug } = useParams();
  const [config, setConfig] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [interests, setInterests] = React.useState([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(null);

  React.useEffect(() => {
    axios.get(`${API}/public/campaigns/${slug}`)
      .then((r) => setConfig(r.data))
      .catch(() => setError("This form is not available."));
  }, [slug]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleInterest = (i) =>
    setInterests((arr) => (arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i]));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (config.require_email && !form.email) { setError("Please enter your email."); return; }
    setSubmitting(true);
    try {
      const r = await axios.post(`${API}/public/campaigns/${slug}/submit`, { ...form, interests });
      setDone(r.data.thank_you || "Thanks! We've received your details.");
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  };

  const bg = "https://images.unsplash.com/photo-1743657166981-8d8e11d03c3e?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600";

  if (error && !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-500" data-testid="capture-error">{error}</p>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20" style={{ backgroundImage: `url(${bg})` }} />
      <div className="relative w-full max-w-lg rounded-3xl border border-white/40 bg-white/80 p-8 shadow-2xl backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <span className="font-display text-lg font-bold text-slate-900">BoothIQ</span>
        </div>

        {done ? (
          <div className="py-10 text-center" data-testid="capture-success">
            <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-emerald-500" />
            <h2 className="font-display text-2xl font-bold text-slate-900">You're all set!</h2>
            <p className="mt-2 text-slate-500">{done}</p>
          </div>
        ) : (
          <form onSubmit={submit} data-testid="capture-form">
            <h1 className="font-display text-2xl font-bold text-slate-900">{config.headline}</h1>
            {config.subhead && <p className="mt-1 mb-5 text-slate-500">{config.subhead}</p>}

            <div className="space-y-3">
              {(config.fields || []).map((f) => {
                const m = FIELD_META[f];
                if (!m) return null;
                const req = f === "email" && config.require_email;
                return (
                  <label key={f} className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">{m.label}{req && " *"}</span>
                    <input
                      data-testid={`field-${f}`}
                      type={m.type}
                      required={req}
                      value={form[f] || ""}
                      onChange={set(f)}
                      placeholder={m.ph}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                );
              })}
            </div>

            {(config.interests || []).length > 0 && (
              <div className="mt-4">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">I'm interested in</span>
                <div className="flex flex-wrap gap-2">
                  {config.interests.map((i) => (
                    <button
                      key={i} type="button" data-testid={`interest-${i}`}
                      onClick={() => toggleInterest(i)}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition-transform active:scale-95 ${interests.includes(i) ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-slate-600 hover:border-primary"}`}>
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="mt-4 text-sm font-semibold text-red-500" data-testid="capture-form-error">{error}</p>}

            <button
              type="submit" data-testid="capture-submit" disabled={submitting}
              className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-lg font-bold text-white transition-transform active:scale-95 disabled:opacity-60">
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit"}
            </button>
            <p className="mt-3 text-center text-xs text-slate-400">Powered by BoothIQ</p>
          </form>
        )}
      </div>
    </div>
  );
}
