import React from "react";
import { useNavigate } from "react-router-dom";
import { Tablet, LayoutDashboard, Settings2, Activity } from "lucide-react";

export default function Launcher() {
  const nav = useNavigate();
  const cards = [
    { to: "/kiosk", image: "https://images.unsplash.com/photo-1573788583106-acf6c8f3f0b5?crop=entropy&cs=srgb&fm=jpg&q=85&w=800", icon: Tablet, title: "Register & Win", desc: "Doctor-facing lead capture & prize wheel", tone: "from-emerald-500 to-emerald-700", testid: "launch-kiosk" },
    { to: "/dashboard", icon: LayoutDashboard, title: "Staff Dashboard", desc: "Live lead feed, tiers & alerts", tone: "from-blue-500 to-blue-700", testid: "launch-dashboard" },
    { to: "/admin", icon: Settings2, title: "Admin Console", desc: "Data upload, scoring, prizes & SMS rules", tone: "from-slate-700 to-slate-900", testid: "launch-admin" },
  ];
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-2 flex items-center gap-2 text-primary">
          <Activity className="h-6 w-6" />
          <span className="text-sm font-semibold uppercase tracking-widest">BoothIQ</span>
        </div>
        <h1 className="mb-2 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Convention Booth Lead Intelligence
        </h1>
        <p className="mb-12 max-w-2xl text-lg text-slate-500">
          Score physicians in real time against Medicare data, launch the prize wheel, and text your team the moment a high-value lead walks up.
        </p>
        <div className="grid gap-6 sm:grid-cols-3">
          {cards.map((c) => (
            <button
              key={c.to}
              data-testid={c.testid}
              onClick={() => nav(c.to)}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              {c.image ? (
                <div className="mb-4 h-32 w-full overflow-hidden rounded-xl">
                  <img src={c.image} alt={c.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                </div>
              ) : (
                <div className={`mb-4 inline-flex rounded-xl bg-gradient-to-br ${c.tone} p-3 text-white`}>
                  <c.icon className="h-6 w-6" />
                </div>
              )}
              <h3 className="text-xl font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{c.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
