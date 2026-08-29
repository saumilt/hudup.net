import React from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { APP_VERSION } from "@/version";
import {
  Activity, Loader2, Radio, LayoutGrid, Search, Users2, CheckSquare, Gift,
  Settings2, ArrowRight, Sparkles, Target, Stethoscope, CalendarClock, Inbox,
  PhoneCall, Upload, Megaphone, TrendingUp, UserCog, LogOut, BarChart3,
} from "lucide-react";

const CRM_QUICK = {
  account_manager: [
    { label: "My Leads", icon: Users2, to: "/crm/leads" },
    { label: "My Tasks", icon: CheckSquare, to: "/crm/meetings" },
    { label: "Meetings", icon: CalendarClock, to: "/crm/meetings" },
    { label: "Opportunities", icon: Target, to: "/crm/opportunities" },
    { label: "Communications", icon: Inbox, to: "/crm/communications" },
    { label: "Call List", icon: PhoneCall, to: "/crm/call-lists" },
  ],
  lead_manager: [
    { label: "Medicare Search", icon: Search, to: "/crm/medicare" },
    { label: "Import Data", icon: Upload, to: "/crm/import" },
    { label: "Leads", icon: Users2, to: "/crm/leads" },
    { label: "Campaigns", icon: Megaphone, to: "/crm/campaigns" },
    { label: "Team Pipeline", icon: TrendingUp, to: "/crm/forecast" },
    { label: "Analytics", icon: BarChart3, to: "/crm/analytics" },
  ],
  admin: [
    { label: "Medicare Search", icon: Search, to: "/crm/medicare" },
    { label: "Import Data", icon: Upload, to: "/crm/import" },
    { label: "Campaigns", icon: Megaphone, to: "/crm/campaigns" },
    { label: "Users & Teams", icon: UserCog, to: "/crm/users" },
    { label: "Analytics", icon: BarChart3, to: "/crm/analytics" },
    { label: "Enrichment & Providers", icon: Sparkles, to: "/crm/providers" },
  ],
  default: [
    { label: "Find Physicians", icon: Stethoscope, to: "/crm/medicare" },
    { label: "Medicare Search", icon: Search, to: "/crm/medicare" },
    { label: "My Leads", icon: Users2, to: "/crm/leads" },
    { label: "Opportunities", icon: Target, to: "/crm/opportunities" },
  ],
};

const WORKFLOW = [
  ["Events", "Capture"], ["Intelligence", "Understand"], ["CRM", "Build"],
  ["Outreach", "Email · Call · Text"], ["Opportunities", "Grow"],
];

const HERO_IMG = "https://images.unsplash.com/photo-1666886573531-48d2e3c2b684?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzR8MHwxfHNlYXJjaHwzfHxkb2N0b3IlMjB1c2luZyUyMHRhYmxldHxlbnwwfHx8fDE3ODgwMjU5NjB8MA&ixlib=rb-4.1.0&q=85";
const EVENTS_IMG = "https://images.unsplash.com/photo-1760001551764-14eddf965019?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzR8MHwxfHNlYXJjaHwzfHxjb25mZXJlbmNlJTIwZXhoaWJpdGlvbiUyMGhhbGx8ZW58MHx8fHwxNzg4MDI1OTYwfDA&ixlib=rb-4.1.0&q=85";
const CRM_IMG = "https://images.unsplash.com/photo-1551288049-bebda4e38f71?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDJ8MHwxfHNlYXJjaHwzfHxidXNpbmVzcyUyMGFuYWx5dGljcyUyMGRhc2hib2FyZHxlbnwwfHx8fDE3ODgwMjU5NjB8MA&ixlib=rb-4.1.0&q=85";

const FEATURES = [
  { icon: Stethoscope, title: "Real-time Medicare scoring", desc: "Score physicians against CMS Part D data the instant they walk up to the booth." },
  { icon: Gift, title: "Prize-wheel capture", desc: "A doctor-facing kiosk and prize wheel that turn booth traffic into qualified leads." },
  { icon: Sparkles, title: "AI Copilot & research", desc: "Draft emails, prep calls and research practices with an AI copilot and autonomous agent." },
  { icon: Search, title: "Data enrichment", desc: "Enrich physicians and practices with professional, practice and contact intelligence." },
  { icon: Inbox, title: "Multi-channel outreach", desc: "Two-way SMS and email with sequences, automation rules and a unified inbox." },
  { icon: Megaphone, title: "Marketing campaigns", desc: "Public capture forms, printable QR posters and full source attribution into the pipeline." },
  { icon: TrendingUp, title: "Teams & forecasting", desc: "Territories, auto lead-routing and sales forecasting across your whole team." },
  { icon: PhoneCall, title: "Mobile rep app", desc: "Work My Day, leads, calls and follow-ups right from your phone." },
];

export default function Launcher() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [events, setEvents] = React.useState(null);
  const [eventId, setEventId] = React.useState(localStorage.getItem("boothiq_event_id") || "default");
  const role = user?.role === "super_admin" ? "admin" : user?.role;
  const canCrm = !user || ["admin", "lead_manager", "account_manager"].includes(role);
  const last = localStorage.getItem("boothiq_ws");
  const crmQuick = CRM_QUICK[role] || CRM_QUICK.default;

  React.useEffect(() => {
    api.get("/kiosk/events").then((r) => setEvents(r.data)).catch(() => setEvents([]));
  }, []);

  const goEvents = () => { localStorage.setItem("boothiq_ws", "events"); nav("/events"); };
  const goCrm = () => { localStorage.setItem("boothiq_ws", "crm"); nav(user ? "/crm" : "/login"); };
  const launchKiosk = () => { localStorage.setItem("boothiq_event_id", eventId); nav("/kiosk"); };

  const continueWs = last === "crm" && canCrm ? "crm" : last === "events" ? "events" : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50">
      {/* Ambient brand glow — professional, no gradients-on-white slop */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-emerald-200/40 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-1/3 h-80 w-80 rounded-full bg-teal-100/50 blur-3xl" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between border-b border-slate-200/70 bg-white/70 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-primary">
          <Activity className="h-6 w-6" />
          <span className="font-display text-lg font-bold tracking-tight text-slate-900">BoothIQ</span>
          <span data-testid="app-version" className="ml-1 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-400">v{APP_VERSION}</span>
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">{user.name}</span>
            <button data-testid="home-signout" onClick={() => { logout(); nav("/login"); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div className="grid items-center gap-8 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-primary">Physician Engagement &amp; Intelligence Platform</p>
            <h1 className="max-w-3xl font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Physician Intelligence.<br className="hidden sm:block" /> Engagement. Growth.
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-500">
              Capture physician relationships at events or discover new opportunities through Medicare intelligence.
              Enrich, communicate, schedule, track and convert — all from one platform.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <p className="font-display text-lg font-semibold text-slate-700">
                {user ? `Welcome back, ${user.name?.split(" ")[0]}.` : "Choose your workspace."}
              </p>
              {continueWs && (
                <button data-testid="continue-workspace" onClick={continueWs === "crm" ? goCrm : goEvents}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 active:scale-95">
                  Continue to {continueWs === "crm" ? "CRM" : "Events"} <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="hidden lg:block">
            <div className="relative">
              <img src={HERO_IMG} alt="Physician using a tablet" loading="lazy"
                className="aspect-[4/3] w-full rounded-3xl object-cover shadow-xl ring-1 ring-slate-200" />
              <div className="absolute -bottom-4 -left-4 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur">
                <p className="text-2xl font-bold text-primary">Real-time</p>
                <p className="text-xs font-semibold text-slate-500">Medicare Part D scoring</p>
              </div>
            </div>
          </div>
        </div>

        <h2 className="mb-4 mt-10 text-xs font-bold uppercase tracking-wider text-slate-400">Choose your workspace</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Events */}
          <section className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition-transform hover:-translate-y-1 hover:shadow-lg">
            <img src={EVENTS_IMG} alt="Conference exhibition hall" loading="lazy"
              className="-mx-7 -mt-7 mb-5 h-40 w-full object-cover" />
            <div className="mb-4 flex items-center gap-3">
              <div className="inline-flex rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 p-3 text-white shadow-sm"><Radio className="h-6 w-6" /></div>
              <div className="flex-1">
                <h3 className="font-display text-2xl font-bold text-slate-900">BoothIQ Events</h3>
                <p className="text-sm text-slate-500">Capture &amp; manage physicians at conferences and booths.</p>
              </div>
              {last === "events" && <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700">LAST USED</span>}
            </div>
            <button data-testid="open-events" onClick={goEvents}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-semibold text-white transition active:scale-95">
              Open BoothIQ Events <ArrowRight className="h-4 w-4" />
            </button>
            <div className="mt-4">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Launch kiosk for event</label>
              {events === null ? (
                <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : (
                <div className="flex gap-2">
                  <select data-testid="launcher-event" value={eventId} onChange={(e) => setEventId(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                  </select>
                  <QuickLink icon={Gift} label="Prize Wheel" onClick={launchKiosk} />
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <QuickLink icon={Radio} label="Event Dashboard" onClick={() => nav("/dashboard")} />
              <QuickLink icon={Users2} label="Booth Leads" onClick={() => nav("/leads")} />
            </div>
          </section>

          {/* CRM */}
          <section className={`group relative overflow-hidden rounded-3xl border p-7 shadow-sm transition-transform ${canCrm ? "border-slate-200 bg-white hover:-translate-y-1 hover:shadow-lg" : "border-slate-200 bg-slate-50 opacity-70"}`}>
            <img src={CRM_IMG} alt="Sales analytics dashboard" loading="lazy"
              className="-mx-7 -mt-7 mb-5 h-40 w-full object-cover" />
            <div className="mb-4 flex items-center gap-3">
              <div className="inline-flex rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-3 text-white shadow-sm"><LayoutGrid className="h-6 w-6" /></div>
              <div className="flex-1">
                <h3 className="font-display text-2xl font-bold text-slate-900">BoothIQ CRM</h3>
                <p className="text-sm text-slate-500">Search, enrich, communicate with &amp; manage physicians.</p>
              </div>
              {last === "crm" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">LAST USED</span>}
            </div>
            {canCrm ? (
              <>
                <button data-testid="open-crm" onClick={goCrm}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white transition active:scale-95">
                  Open BoothIQ CRM <ArrowRight className="h-4 w-4" />
                </button>
                <div className="mt-4 flex flex-wrap gap-2">
                  {crmQuick.map((q) => <QuickLink key={q.label} icon={q.icon} label={q.label} onClick={() => nav(user ? q.to : "/login")} />)}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
                CRM access is limited to managers and admins. You're set up for BoothIQ Events.
              </div>
            )}
          </section>
        </div>

        {/* Workflow visual — Events feed the CRM */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {WORKFLOW.map(([a, b], i) => (
            <React.Fragment key={a}>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-center shadow-sm">
                <p className="text-sm font-bold text-slate-800">{a}</p>
                <p className="text-[11px] font-medium text-slate-400">{b}</p>
              </div>
              {i < WORKFLOW.length - 1 && <ArrowRight className="h-4 w-4 text-slate-300" />}
            </React.Fragment>
          ))}
        </div>

        {/* Feature showcase — what BoothIQ does */}
        <div className="mt-16">
          <h2 className="text-center text-xs font-bold uppercase tracking-wider text-primary">Everything BoothIQ does</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-lg text-slate-500">
            From the first booth interaction to a closed opportunity — one connected physician engagement platform.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} data-testid={`feature-${f.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
                <div className="mb-3 inline-flex rounded-xl bg-emerald-50 p-2.5 text-primary"><f.icon className="h-5 w-5" /></div>
                <p className="font-display font-bold text-slate-900">{f.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {role === "admin" && (
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <QuickLink icon={Settings2} label="Admin Console" onClick={() => nav("/admin")} />
            <QuickLink icon={Upload} label="Data Import" onClick={() => nav("/crm/import")} />
            <QuickLink icon={UserCog} label="Users & Teams" onClick={() => nav("/crm/users")} />
            <QuickLink icon={Sparkles} label="Enrichment Providers" onClick={() => nav("/crm/providers")} />
          </div>
        )}
      </main>
    </div>
  );
}

function QuickLink({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} data-testid={`quick-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm">
      <Icon className="h-3.5 w-3.5 text-primary" /> {label}
    </button>
  );
}
