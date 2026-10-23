import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { APP_VERSION } from "@/version";
import {
  LayoutDashboard, Users2, Target, CalendarClock, Building2, Search,
  Activity, LogOut, Settings2, UserCog, Radio, Plus, ChevronDown, Grid3x3,
  UserPlus, CheckSquare, CalendarPlus, Stethoscope, Upload, Workflow, Inbox, BarChart3, PhoneCall, Zap, Compass, TrendingUp, Network, Megaphone, AlertTriangle, Handshake, Archive,
} from "lucide-react";

const ROLE_LABEL = {
  admin: "Admin", lead_manager: "Lead Manager", account_manager: "Account Manager", staff: "Booth Staff",
};

const NAV = [
  { to: "/crm", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/crm/leads", label: "Leads", icon: Users2 },
  { to: "/crm/clients", label: "Clients & Services", icon: Building2 },
  { to: "/crm/service-referrals", label: "Referral Tracking", icon: Network },
  { to: "/crm/opportunities", label: "Opportunities", icon: Target },
  { to: "/crm/meetings", label: "Meetings & Tasks", icon: CalendarClock },
  { to: "/crm/communications", label: "Communications", icon: Inbox },
  { to: "/crm/call-lists", label: "Call Lists", icon: PhoneCall },
  { to: "/crm/accounts", label: "Accounts / Physicians", icon: Building2 },
  { to: "/crm/medicare", label: "Medicare Search", icon: Search },
  { to: "/crm/referral-search", label: "Referral Search", icon: Compass },
  { to: "/crm/sequences", label: "Sequences", icon: Workflow },
];

function TopBar() {
  const nav = useNavigate();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showSwitch, setShowSwitch] = React.useState(false);
  const box = React.useRef(null);

  React.useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      try { const r = await api.get(`/crm/search?q=${encodeURIComponent(q.trim())}`); setResults(r.data.results); }
      catch { setResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const go = (r) => {
    setQ(""); setResults(null);
    if (r.type === "lead") nav(`/crm/leads/${r.id}`);
    else if (r.type === "opportunity") nav("/crm/opportunities");
    else if (r.type === "physician") nav(`/crm/physicians/${r.id}`);
  };
  const createItems = [
    { label: "Lead", icon: UserPlus, to: "/crm/leads" },
    { label: "Task", icon: CheckSquare, to: "/crm/meetings" },
    { label: "Meeting", icon: CalendarPlus, to: "/crm/meetings" },
    { label: "Physician Lookup", icon: Stethoscope, to: "/crm/medicare" },
  ];
  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-5 py-2.5 backdrop-blur">
      {/* Workspace switcher */}
      <div className="relative">
        <button data-testid="workspace-switcher" onClick={() => setShowSwitch((s) => !s)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-800 hover:bg-slate-50">
          <Grid3x3 className="h-4 w-4 text-primary" /> HudlUp CRM <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>
        {showSwitch && (
          <div className="absolute left-0 top-full z-40 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-xl" onMouseLeave={() => setShowSwitch(false)}>
            <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary"><span className="h-2 w-2 rounded-full bg-primary" /> CRM</div>
            <button data-testid="switch-events" onClick={() => nav("/events")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Radio className="h-4 w-4" /> Events</button>
            <button data-testid="switch-home" onClick={() => nav("/home")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><LayoutDashboard className="h-4 w-4" /> Home</button>
          </div>
        )}
      </div>
      {/* Global search */}
      <div className="relative flex-1 max-w-xl" ref={box}>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input data-testid="global-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search physicians, practices, leads, NPI, opportunities…"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:bg-white" />
        {results && (
          <div className="absolute left-0 top-full z-40 mt-1 max-h-96 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
            {results.length === 0 ? <p className="px-3 py-3 text-sm text-slate-400">No matches</p> :
              results.map((r, i) => (
                <button key={i} data-testid="search-result" onClick={() => go(r)} className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                  <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.type === "lead" ? "bg-blue-100 text-blue-700" : r.type === "physician" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>{r.type}</span>
                  <span><span className="block text-sm font-semibold text-slate-800">{r.title}</span><span className="block text-xs text-slate-400">{r.sub}</span></span>
                </button>
              ))}
          </div>
        )}
      </div>
      {/* Create */}
      <div className="relative">
        <button data-testid="global-create" onClick={() => setShowCreate((s) => !s)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"><Plus className="h-4 w-4" /> Create</button>
        {showCreate && (
          <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl" onMouseLeave={() => setShowCreate(false)}>
            {createItems.map((c) => (
              <button key={c.label} data-testid={`create-${c.label.toLowerCase().split(" ")[0]}`} onClick={() => { setShowCreate(false); nav(c.to); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><c.icon className="h-4 w-4" /> {c.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CrmShell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  React.useEffect(() => { localStorage.setItem("boothiq_ws", "crm"); }, []);
  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <Activity className="h-6 w-6 text-primary" />
          <span className="font-display text-lg font-bold">HudlUp</span>
          <span className="ml-auto rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-400">v{APP_VERSION}</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={`nav-${n.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
          <div className="my-2 border-t border-slate-100" />
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/explorer" data-testid="nav-explorer" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <Compass className="h-4 w-4" /> Data Explorer
            </NavLink>
          )}
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/automation" data-testid="nav-automation" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <Zap className="h-4 w-4" /> Automation
            </NavLink>
          )}
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/campaigns" data-testid="nav-campaigns" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <Megaphone className="h-4 w-4" /> Campaigns
            </NavLink>
          )}
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/forecast" data-testid="nav-forecast" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <TrendingUp className="h-4 w-4" /> Forecast
            </NavLink>
          )}
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/teams" data-testid="nav-teams" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <Network className="h-4 w-4" /> Teams & Territories
            </NavLink>
          )}
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/analytics" data-testid="nav-analytics" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <BarChart3 className="h-4 w-4" /> Analytics
            </NavLink>
          )}
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/import" data-testid="nav-import" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <Upload className="h-4 w-4" /> Data Import
            </NavLink>
          )}
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/closer-queue" data-testid="nav-closer-queue" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <Handshake className="h-4 w-4" /> Closer Queue
            </NavLink>
          )}
          {(["admin", "super_admin", "lead_manager"].includes(user?.role)) && (
            <NavLink to="/crm/mismatch-report" data-testid="nav-mismatch-report" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
              <AlertTriangle className="h-4 w-4" /> Mismatch Report
            </NavLink>
          )}
          {["admin", "super_admin"].includes(user?.role) && (
            <>
              <NavLink to="/crm/archive" data-testid="nav-archive" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
                <Archive className="h-4 w-4" /> Archive Bin
              </NavLink>
              <NavLink to="/crm/users" data-testid="nav-users" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
                <UserCog className="h-4 w-4" /> Users & Roles
              </NavLink>
              <NavLink to="/crm/providers" data-testid="nav-providers" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
                <Settings2 className="h-4 w-4" /> Providers
              </NavLink>
              <button data-testid="nav-admin-console" onClick={() => nav("/admin")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                <Settings2 className="h-4 w-4" /> Admin Console
              </button>
            </>
          )}
          <button data-testid="nav-booth" onClick={() => nav("/dashboard")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Radio className="h-4 w-4" /> Booth Dashboard
          </button>
        </nav>
        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-semibold text-slate-800">{user?.name}</p>
            <p className="text-xs text-slate-400">{ROLE_LABEL[user?.role] || user?.role}</p>
          </div>
          <button data-testid="crm-logout" onClick={() => { logout(); nav("/login"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      {/* Main */}
      <main className="ml-60 flex-1">
        <TopBar />
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </header>
  );
}
