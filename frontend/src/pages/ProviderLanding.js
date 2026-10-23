import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Check, Activity, Network, ClipboardCheck, Plus, Menu, X } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import Launcher from "@/pages/Launcher";
import "@/pages/ProviderLanding.css";

const PROGRAMS = [
  { id: "specialty-pharmacy-340b", short: "340B", name: "Specialty pharmacy 340B", status: "Started writing prescription",
    description: "Keep prescriber relationships, onboarding milestones and pharmacy referral activity connected.", partner: "Pharmacy partner" },
  { id: "rpm", short: "RPM", name: "Remote patient monitoring", status: "Started with Caregenix for RPM",
    description: "Follow each practice from first conversation through enrollment readiness and partner activation.", partner: "Caregenix" },
  { id: "infusion", short: "INF", name: "Infusion", status: "Client is sending Infusion",
    description: "See who is sending referrals, which partner is receiving them and what needs follow-up.", partner: "Infusion partner" },
];
const initialForm = { organization: "", contact_name: "", email: "", organization_type: "MSO", services: [], consent: false, website: "" };

function ProductPreview({ program, setProgram }) {
  const selected = PROGRAMS[program];
  return <div className="hu-preview" aria-label="Illustrative CRM preview">
    <div className="hu-preview-head"><span className="hu-preview-mark">h.</span><strong>Provider workspace</strong><span className="hu-example">ILLUSTRATIVE DATA</span></div>
    <div className="hu-preview-body">
      <div className="hu-preview-sidebar" aria-hidden="true"><span className="hu-sidebar-selected"><Network size={19} /></span><span><Activity size={19} /></span><span><ClipboardCheck size={19} /></span></div>
      <div className="hu-preview-content">
        <div className="hu-preview-eyebrow">CLIENT OVERVIEW <span>↗</span></div>
        <h3>Every relationship.<br />A clear next step.</h3>
        <div className="hu-preview-practice"><div className="hu-avatar">SP</div><div><strong>Sample Physician Group</strong><p>Client onboarding</p></div><span className="hu-dot" /></div>
        <div className="hu-preview-status"><span><Check size={14} /> DTCM Form Completed</span><span>Ready to activate</span></div>
        <div className="hu-program-tabs" role="group" aria-label="Preview a service">
          {PROGRAMS.map((p, i) => <button key={p.id} onClick={() => setProgram(i)} aria-pressed={i === program} className={i === program ? "is-selected" : ""}>{p.short === "INF" ? "Infusion" : p.short}</button>)}
        </div>
        <div className="hu-preview-service"><div><span className="hu-mini-label">SERVICE ACTIVITY</span><h4>{selected.name}</h4></div><span className="hu-service-badge">Active</span><p>{selected.status}</p><div className="hu-preview-partner"><span>Partner</span><strong>{selected.partner}</strong></div></div>
        <div className="hu-referral-mini"><div><span className="hu-mini-label">REFERRAL · SAMPLE-1042</span><strong>From submitted to completed.</strong></div><div className="hu-progress"><span /><span /><span /><span className="hu-progress-last" /></div><div className="hu-progress-labels"><span>Submitted</span><span>Accepted</span><span>Completed</span></div></div>
      </div>
    </div>
    <div className="hu-preview-footer"><span className="hu-dot" /> Relationships, services & referrals — together</div>
  </div>;
}

export default function ProviderLanding() {
  const { user } = useAuth();
  const [program, setProgram] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    const oldTitle = document.title;
    document.title = "HudlUp | CRM for 340B & RPM with Referral Tracking";
    return () => { document.title = oldTitle; };
  }, []);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError("");
    try { await api.post("/public/request-demo", form); setSent(true); }
    catch (e) { setError(e.response?.status === 429 ? "Too many requests. Please try again later." : formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const update = e => setForm({ ...form, [e.target.name]: e.target.value });
  if (user) return <Launcher />;
  return <div className="hu-site">
    <a className="hu-skip" href="#main">Skip to content</a>
    <header className="hu-nav">
      <a className="hu-brand" href="/" aria-label="HudlUp home"><span className="hu-brand-icon">h.</span>hudlup<span className="hu-brand-period">.</span></a>
      <button className="hu-menu" aria-label={mobileNav ? "Close navigation" : "Open navigation"} aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X /> : <Menu />}</button>
      <nav aria-label="Main navigation" className={mobileNav ? "hu-nav-links is-open" : "hu-nav-links"}>
        <a href="#platform" onClick={() => setMobileNav(false)}>Platform</a><a href="#services" onClick={() => setMobileNav(false)}>Services</a><a href="#workflow" onClick={() => setMobileNav(false)}>How it works</a>
      </nav>
      <div className="hu-nav-actions"><Link to="/login">Sign in <ArrowUpRight size={14} /></Link><a className="hu-button hu-button-small" href="#demo">Book a demo <ArrowRight size={15} /></a></div>
    </header>
    <main id="main">
      <section className="hu-hero hu-container">
        <div className="hu-hero-copy">
          <p className="hu-eyebrow"><span /> BUILT FOR MSOs & PROVIDER TEAMS</p>
          <h1>Better connections.<br />Clearer follow-through.</h1>
          <p className="hu-hero-subtitle">CRM for <strong>340B & RPM</strong><br />with referral tracking.</p>
          <p className="hu-hero-description">Bring your provider relationships, client onboarding and service referrals into one shared workspace. Know where every client stands — and what happens next.</p>
          <div className="hu-hero-actions"><a className="hu-button" href="#demo">See HudlUp in action <ArrowRight size={18} /></a><a className="hu-text-link" href="#platform">Explore the platform <ArrowUpRight size={16} /></a></div>
          <div className="hu-hero-tags"><span><Check size={13} /> Specialty pharmacy 340B</span><span><Check size={13} /> RPM</span><span><Check size={13} /> Infusion</span></div>
        </div>
        <div className="hu-hero-visual"><div className="hu-visual-caption"><span>ONE WORKSPACE. THE FULL PICTURE.</span><span>01 — 03</span></div><ProductPreview program={program} setProgram={setProgram} /></div>
      </section>
      <div className="hu-audience"><div className="hu-container"><span>Made for the teams behind connected care</span><strong>MSOs</strong><strong>RPM providers</strong><strong>Specialty pharmacies</strong><strong>Infusion providers</strong></div></div>
      <section id="platform" className="hu-platform hu-container">
        <div className="hu-section-heading"><p className="hu-eyebrow">THE PROVIDER RELATIONSHIP WORKSPACE</p><h2>From a first conversation<br />to an active service.</h2><p>Sales stages tell one part of the story. HudlUp also tracks the onboarding and service activity that comes after conversion.</p></div>
        <div className="hu-platform-grid">
          <article className="hu-feature-primary"><span className="hu-feature-index">01 / RELATIONSHIPS</span><Network size={30} strokeWidth={1.4} /><h3>A CRM built around<br />your provider network.</h3><p>Keep practices, contacts, owners, opportunities and follow-ups in one place. Give your team the context to move the relationship forward.</p><div className="hu-feature-tags"><span>Lead management</span><span>Tasks & meetings</span><span>Activity timeline</span></div></article>
          <article className="hu-feature-secondary"><span className="hu-feature-index">02 / ONBOARDING</span><ClipboardCheck size={27} strokeWidth={1.4} /><h3>Know who is ready.</h3><p>Track DTCM form completion and activation milestones without losing the original sales stage.</p><div className="hu-inline-milestone"><Check size={16} /> DTCM Form Completed</div></article>
          <article className="hu-feature-secondary hu-feature-referrals"><span className="hu-feature-index">03 / REFERRALS</span><Activity size={27} strokeWidth={1.4} /><h3>Close the follow-up loop.</h3><p>Record the source client, service, destination and internal reference. Follow status changes through to completion.</p><div className="hu-inline-referral"><span>Submitted</span><ArrowRight size={15} /><strong>Completed</strong></div></article>
        </div>
      </section>
      <section id="services" className="hu-services">
        <div className="hu-container">
          <div className="hu-section-heading hu-heading-split"><div><p className="hu-eyebrow">ONE CLIENT. MULTIPLE SERVICES.</p><h2>Every program gets<br />its own progress.</h2></div><p>A practice can work with several services at once. Track each status and partner independently, then add more services as your business grows.</p></div>
          <div className="hu-service-list">{PROGRAMS.map((p, i) => <article key={p.id}>
            <span className="hu-service-number">0{i + 1}</span><div><h3>{p.name}</h3><p>{p.description}</p></div><span className="hu-service-example"><span>EXAMPLE MILESTONE</span>{p.status}</span><ArrowUpRight className="hu-service-arrow" size={24} />
          </article>)}</div>
          <div className="hu-add-service"><Plus size={17} /><span>More ways to work together.</span> Admins can add additional services to the catalog.</div>
        </div>
      </section>
      <section id="workflow" className="hu-workflow hu-container">
        <div className="hu-section-heading"><p className="hu-eyebrow">A CLEAR PATH FOR YOUR TEAM</p><h2>Less chasing.<br />More moving forward.</h2></div>
        <div className="hu-steps">{[
          ["Build the relationship", "Capture a lead, connect the practice and assign the person responsible for the next conversation."],
          ["Onboard the client", "Record client readiness, DTCM progress and the services they are starting."],
          ["Track what follows", "Log service referrals, update milestones and see what needs attention next."],
        ].map(([title, desc], i) => <article key={title}><span>0{i + 1}</span><h3>{title}</h3><p>{desc}</p></article>)}</div>
      </section>
      <section id="demo" className="hu-demo">
        <div className="hu-container hu-demo-grid">
          <div><p className="hu-eyebrow">LET'S CONNECT YOUR WORKFLOW</p><h2>Your provider network.<br />Working together.</h2><p>See how HudlUp can bring CRM, service onboarding and referral tracking into your team's day.</p><ul><li><Check size={18} /> Built for MSO and provider relationships</li><li><Check size={18} /> Track 340B, RPM, infusion and more</li><li><Check size={18} /> Keep ownership and next steps visible</li></ul><span className="hu-demo-wordmark" aria-hidden="true">hudlup.</span></div>
          <div className="hu-demo-form">
            {sent ? <div className="hu-success" role="status"><span><Check size={30} /></span><h3>You're on the list.</h3><p>Your demo request has been received. Our team can follow up using the business email you provided.</p><button className="hu-text-link" onClick={() => { setSent(false); setForm(initialForm); }}>Submit another request <ArrowRight size={16} /></button></div>
              : <form onSubmit={submit}>
                <h3>Let's find your fit.</h3><p>Tell us a little about your organization.</p>
                <label>Organization<input required minLength={2} maxLength={160} name="organization" autoComplete="organization" value={form.organization} onChange={update} placeholder="Organization name" /></label>
                <div className="hu-form-row"><label>Your name<input required minLength={2} maxLength={120} name="contact_name" autoComplete="name" value={form.contact_name} onChange={update} placeholder="Full name" /></label><label>Business email<input required type="email" maxLength={254} name="email" autoComplete="email" value={form.email} onChange={update} placeholder="you@organization.com" /></label></div>
                <label>Organization type<select name="organization_type" value={form.organization_type} onChange={update}>{["MSO", "RPM Provider", "Specialty Pharmacy", "Infusion Provider", "Physician Practice", "Other"].map(s => <option key={s}>{s}</option>)}</select></label>
                <fieldset><legend>Which services do you work with?</legend><div className="hu-checkboxes">{PROGRAMS.map(p => <label key={p.id}><input type="checkbox" checked={form.services.includes(p.id)} onChange={e => setForm({ ...form, services: e.target.checked ? [...form.services, p.id] : form.services.filter(s => s !== p.id) })} />{p.short === "INF" ? "Infusion" : p.short}</label>)}</div></fieldset>
                <div className="hu-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={update} /></label></div>
                <label className="hu-consent"><input required type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} /><span>I agree to be contacted about this demo request.</span></label>
                <p className="hu-form-note">Business inquiries only. Please do not include patient information.</p>
                {error && <p className="hu-form-error" role="alert">{error}</p>}
                <button className="hu-button" type="submit" disabled={busy || !form.services.length}>{busy ? "Sending your request…" : "Request your demo"}<ArrowRight size={17} /></button>
                {!form.services.length && <p className="hu-form-note">Select at least one service to continue.</p>}
              </form>}
          </div>
        </div>
      </section>
    </main>
    <footer className="hu-footer hu-container"><a href="/" className="hu-brand">hudlup.</a><p>CRM for 340B & RPM with referral tracking.</p><Link to="/login">Team sign in <ArrowUpRight size={14} /></Link><span>© {new Date().getFullYear()} HudlUp</span></footer>
  </div>;
}
