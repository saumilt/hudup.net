import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { APP_VERSION } from "@/version";
import {
  LayoutDashboard, Users2, Target, CalendarClock, Building2, Search,
  Activity, LogOut, Settings2, UserCog, Radio,
} from "lucide-react";

const ROLE_LABEL = {
  admin: "Admin", lead_manager: "Lead Manager", account_manager: "Account Manager", staff: "Booth Staff",
};

const NAV = [
  { to: "/crm", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/crm/leads", label: "Leads", icon: Users2 },
  { to: "/crm/opportunities", label: "Opportunities", icon: Target },
  { to: "/crm/meetings", label: "Meetings & Tasks", icon: CalendarClock },
  { to: "/crm/accounts", label: "Accounts / Physicians", icon: Building2 },
  { to: "/crm/medicare", label: "Medicare Search", icon: Search },
];

export default function CrmShell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <Activity className="h-6 w-6 text-primary" />
          <span className="font-display text-lg font-bold">BoothIQ</span>
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
          {user?.role === "admin" && (
            <>
              <NavLink to="/crm/users" data-testid="nav-users" className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-50"}`}>
                <UserCog className="h-4 w-4" /> Users & Roles
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
