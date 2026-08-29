import React from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, Modal, Field, inputCls, StatCard, EmptyState, money, fmtDay } from "@/components/crm/kit";
import { toast } from "sonner";
import { QRCodeCanvas } from "qrcode.react";
import {
  Megaphone, Plus, Link2, Copy, ExternalLink, Trash2, Target, Users2, TrendingUp, DollarSign, QrCode,
} from "lucide-react";

const CHANNEL_COLOR = {
  "Event / Booth": "bg-emerald-100 text-emerald-700",
  Email: "bg-blue-100 text-blue-700",
  Social: "bg-violet-100 text-violet-700",
  Referral: "bg-amber-100 text-amber-700",
  Website: "bg-sky-100 text-sky-700",
  "Paid Ads": "bg-pink-100 text-pink-700",
  Other: "bg-slate-100 text-slate-600",
};
const STATUS_COLOR = {
  Draft: "bg-slate-100 text-slate-600",
  Active: "bg-emerald-100 text-emerald-700",
  Paused: "bg-amber-100 text-amber-700",
  Completed: "bg-slate-200 text-slate-500",
};

function captureUrl(slug) {
  return `${window.location.origin}/c/${slug}`;
}

function CampaignForm({ meta, initial, onSave, saving }) {
  const c = initial || {};
  const cap = c.capture || {};
  const [form, setForm] = React.useState({
    name: c.name || "",
    channel: c.channel || "Event / Booth",
    status: c.status || "Draft",
    description: c.description || "",
    budget: c.budget ?? "",
    goal_leads: c.goal_leads ?? "",
    headline: cap.headline || "",
    subhead: cap.subhead || "",
    thank_you: cap.thank_you || "",
    interests: (cap.interests || []).join(", "),
    require_email: cap.require_email ?? true,
    enabled: cap.enabled ?? true,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    if (!form.name.trim()) return toast.error("Campaign name is required");
    const payload = {
      name: form.name.trim(),
      channel: form.channel,
      status: form.status,
      description: form.description || null,
      budget: form.budget === "" ? null : Number(form.budget),
      goal_leads: form.goal_leads === "" ? null : Number(form.goal_leads),
      capture: {
        enabled: !!form.enabled,
        require_email: !!form.require_email,
        headline: form.headline || null,
        subhead: form.subhead || null,
        thank_you: form.thank_you || null,
        interests: form.interests.split(",").map((s) => s.trim()).filter(Boolean),
      },
    };
    onSave(payload);
  };

  return (
    <div>
      <Field label="Campaign Name">
        <input data-testid="campaign-name" className={inputCls} value={form.name} onChange={set("name")} placeholder="Spring 2026 Cardiology Expo" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel">
          <select data-testid="campaign-channel" className={inputCls} value={form.channel} onChange={set("channel")}>
            {(meta?.channels || []).map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select data-testid="campaign-status" className={inputCls} value={form.status} onChange={set("status")}>
            {(meta?.statuses || []).map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget ($)">
          <input data-testid="campaign-budget" type="number" className={inputCls} value={form.budget} onChange={set("budget")} placeholder="5000" />
        </Field>
        <Field label="Lead Goal">
          <input data-testid="campaign-goal" type="number" className={inputCls} value={form.goal_leads} onChange={set("goal_leads")} placeholder="100" />
        </Field>
      </div>
      <Field label="Description">
        <textarea className={inputCls} rows={2} value={form.description} onChange={set("description")} placeholder="Notes about this campaign…" />
      </Field>

      <div className="my-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700"><Link2 className="h-4 w-4 text-primary" /> Capture Form</p>
        <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input data-testid="capture-enabled" type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} /> Enable public capture form
        </label>
        <Field label="Headline">
          <input className={inputCls} value={form.headline} onChange={set("headline")} placeholder="Connect with us" />
        </Field>
        <Field label="Subhead">
          <input className={inputCls} value={form.subhead} onChange={set("subhead")} placeholder="Share your details and we'll reach out." />
        </Field>
        <Field label="Interest Chips (comma-separated → saved as lead tags)">
          <input className={inputCls} value={form.interests} onChange={set("interests")} placeholder="340B, RPM, Chronic Care" />
        </Field>
        <Field label="Thank-you Message">
          <input className={inputCls} value={form.thank_you} onChange={set("thank_you")} placeholder="Thanks! We'll be in touch." />
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input type="checkbox" checked={form.require_email} onChange={(e) => setForm((f) => ({ ...f, require_email: e.target.checked }))} /> Require email
        </label>
      </div>
      <Btn data-testid="save-campaign" onClick={submit} disabled={saving} className="w-full justify-center">
        {saving ? "Saving…" : "Save Campaign"}
      </Btn>
    </div>
  );
}

function QRPoster({ url, name, onClose }) {
  const ref = React.useRef(null);
  const getCanvas = () => ref.current?.querySelector("canvas");
  const download = () => {
    const c = getCanvas();
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `${name.replace(/[^a-z0-9]+/gi, "-")}-qr.png`;
    a.click();
  };
  const printPoster = () => {
    const c = getCanvas();
    if (!c) return;
    const data = c.toDataURL("image/png");
    const w = window.open("", "_blank", "width=800,height=1000");
    if (!w) return toast.error("Enable pop-ups to print the poster");
    w.document.write(`<!doctype html><html><head><title>${name} — QR Poster</title>
      <style>body{font-family:'Plus Jakarta Sans',Arial,sans-serif;text-align:center;padding:64px 40px;color:#0F172A}
      .ey{letter-spacing:.25em;text-transform:uppercase;color:#047857;font-weight:800;font-size:14px}
      h1{font-size:42px;margin:12px 0 4px}p.sub{font-size:22px;color:#334155;margin:0 0 32px}
      img{width:380px;height:380px}p.cta{font-size:26px;font-weight:800;color:#047857;margin-top:28px}
      p.ft{color:#94a3b8;margin-top:40px;font-size:13px}</style></head>
      <body><div class="ey">BoothIQ</div><h1>${name}</h1>
      <p class="sub">Interested? Scan to connect with our team.</p>
      <img src="${data}"/><p class="cta">📱 Scan to connect</p>
      <p class="ft">${url}</p></body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 300);
  };
  return (
    <div className="text-center">
      <div ref={ref} className="mx-auto mb-4 inline-flex rounded-2xl border border-slate-200 bg-white p-5">
        <QRCodeCanvas value={url} size={240} fgColor="#0F172A" level="M" includeMargin data-testid="campaign-qr-canvas" />
      </div>
      <p className="font-display text-lg font-bold text-slate-900">{name}</p>
      <p className="mb-4 text-sm text-slate-500">Scan to open the capture form</p>
      <div className="flex justify-center gap-2">
        <Btn data-testid="qr-download" variant="ghost" onClick={download}><Copy className="h-4 w-4" /> Download PNG</Btn>
        <Btn data-testid="qr-print" onClick={printPoster}><QrCode className="h-4 w-4" /> Print Poster</Btn>
      </div>
    </div>
  );
}

function CampaignDetail({ campaign, onClose, onChanged }) {
  const [c, setC] = React.useState(campaign);
  const [busy, setBusy] = React.useState(false);
  const [showQR, setShowQR] = React.useState(false);
  const s = c.stats || {};
  const slug = c.capture?.slug;
  const url = slug ? captureUrl(slug) : null;

  const copy = () => { navigator.clipboard.writeText(url); toast.success("Capture link copied"); };
  const setStatus = async (status) => {
    setBusy(true);
    try {
      const r = await api.patch(`/crm/campaigns/${c.id}`, { status });
      setC(r.data); onChanged?.(); toast.success(`Status → ${status}`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard testid="stat-captured" label="Captured" value={s.captured ?? 0} />
        <StatCard testid="stat-converted" label="Converted" value={s.converted ?? 0} sub={`${s.conversion_rate ?? 0}% rate`} />
        <StatCard testid="stat-pipeline" label="Pipeline" value={money(s.pipeline_value)} />
        <StatCard testid="stat-won" label="Won" value={money(s.won_value)} sub={`${s.won ?? 0} deals`} />
      </div>

      {c.capture?.enabled && url && (
        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">Public Capture Link</p>
          <div className="flex items-center gap-2">
            <input readOnly data-testid="capture-link" className={`${inputCls} bg-white`} value={url} />
            <Btn data-testid="copy-link" variant="ghost" onClick={copy}><Copy className="h-4 w-4" /></Btn>
            <a href={url} target="_blank" rel="noreferrer"><Btn variant="ghost"><ExternalLink className="h-4 w-4" /></Btn></a>
            <Btn data-testid="open-qr-poster" onClick={() => setShowQR(true)}><QrCode className="h-4 w-4" /> QR Poster</Btn>
          </div>
        </div>
      )}

      <Modal open={showQR} onClose={() => setShowQR(false)} title="Capture Form QR Poster">
        {url && <QRPoster url={url} name={c.name} onClose={() => setShowQR(false)} />}
      </Modal>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Set status:</span>
        {["Draft", "Active", "Paused", "Completed"].map((st) => (
          <button key={st} data-testid={`set-status-${st.toLowerCase()}`} disabled={busy || c.status === st}
            onClick={() => setStatus(st)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${c.status === st ? "bg-primary text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            {st}
          </button>
        ))}
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Recent captured leads</p>
      <div className="rounded-xl border border-slate-200">
        {(c.recent_leads || []).length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No leads captured yet. Share the link above to start collecting.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {(c.recent_leads || []).slice(0, 15).map((l) => (
              <div key={l.id} data-testid="campaign-lead-row" className="flex items-center justify-between px-4 py-2 text-sm">
                <div>
                  <span className="font-semibold text-slate-800">{l.org_name || `${l.contact_first || ""} ${l.contact_last || ""}`.trim() || l.lead_number}</span>
                  <span className="ml-2 text-xs text-slate-400">{l.email || l.phone || "—"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{fmtDay(l.created_at)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{l.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Campaigns() {
  const [meta, setMeta] = React.useState(null);
  const [campaigns, setCampaigns] = React.useState(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [detail, setDetail] = React.useState(null);

  const load = React.useCallback(async () => {
    try {
      const [m, c] = await Promise.all([api.get("/crm/campaigns/meta"), api.get("/crm/campaigns")]);
      setMeta(m.data); setCampaigns(c.data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); setCampaigns([]); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const create = async (payload) => {
    setSaving(true);
    try {
      await api.post("/crm/campaigns", payload);
      toast.success("Campaign created");
      setShowCreate(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const openDetail = async (id) => {
    try { const r = await api.get(`/crm/campaigns/${id}`); setDetail(r.data); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Delete this campaign? Captured leads are kept.")) return;
    try { await api.delete(`/crm/campaigns/${id}`); toast.success("Deleted"); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Marketing Campaigns" subtitle="Event campaigns, capture forms, and source attribution">
        <Btn data-testid="new-campaign" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New Campaign</Btn>
      </PageHeader>

      <div className="p-6">
        {campaigns === null ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-slate-200" />)}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="grid"><EmptyState icon={Megaphone} title="No campaigns yet" hint="Create your first campaign to generate a shareable capture form and track source attribution." /></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => {
              const s = c.stats || {};
              const goal = c.goal_leads || 0;
              const pct = goal ? Math.min(100, Math.round((s.captured / goal) * 100)) : 0;
              return (
                <div key={c.id} data-testid="campaign-card" role="button" tabIndex={0}
                  onClick={() => openDetail(c.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(c.id); } }}
                  className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-5 text-left transition-transform hover:-translate-y-1 hover:shadow-lg">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display text-base font-bold text-slate-900">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.campaign_number}</p>
                    </div>
                    <button data-testid="delete-campaign" onClick={(e) => remove(c.id, e)} className="rounded-lg p-1 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CHANNEL_COLOR[c.channel] || CHANNEL_COLOR.Other}`}>{c.channel}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[c.status] || STATUS_COLOR.Draft}`}>{c.status}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div><Users2 className="mx-auto h-4 w-4 text-slate-400" /><p className="mt-0.5 text-sm font-bold text-slate-800">{s.captured ?? 0}</p><p className="text-[10px] text-slate-400">Leads</p></div>
                    <div><Target className="mx-auto h-4 w-4 text-slate-400" /><p className="mt-0.5 text-sm font-bold text-slate-800">{s.converted ?? 0}</p><p className="text-[10px] text-slate-400">Conv.</p></div>
                    <div><TrendingUp className="mx-auto h-4 w-4 text-slate-400" /><p className="mt-0.5 text-sm font-bold text-slate-800">{s.conversion_rate ?? 0}%</p><p className="text-[10px] text-slate-400">Rate</p></div>
                    <div><DollarSign className="mx-auto h-4 w-4 text-slate-400" /><p className="mt-0.5 text-sm font-bold text-slate-800">{money(s.pipeline_value)}</p><p className="text-[10px] text-slate-400">Pipe</p></div>
                  </div>
                  {goal > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[10px] font-semibold text-slate-400"><span>Goal progress</span><span>{s.captured ?? 0}/{goal}</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Campaign" wide>
        <CampaignForm meta={meta} onSave={create} saving={saving} />
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name || "Campaign"} wide>
        {detail && <CampaignDetail campaign={detail} onClose={() => setDetail(null)} onChanged={load} />}
      </Modal>
    </div>
  );
}
