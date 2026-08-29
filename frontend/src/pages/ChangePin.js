import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Activity, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { APP_VERSION } from "@/version";

export default function ChangePin() {
  const { user, refreshUser } = useAuth();
  const nav = useNavigate();
  const forced = !!user?.must_change_pin;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const dest = () => (user?.role === "staff" ? "/dashboard" : "/home");

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) return toast.error("New PINs do not match");
    if (!/^\d{4,8}$/.test(next)) return toast.error("PIN must be 4-8 digits");
    setLoading(true);
    try {
      await api.post("/auth/change-pin", { new_pin: next, current_pin: forced ? undefined : current });
      await refreshUser?.();
      toast.success("PIN updated");
      nav(dest());
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Could not change PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div data-testid="app-version" className="fixed right-3 top-3 z-50 rounded-full bg-black/30 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur">v{APP_VERSION}</div>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2 text-primary">
          <Activity className="h-6 w-6" />
          <span className="text-lg font-bold tracking-tight">BoothIQ</span>
        </div>
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <KeyRound className="h-3.5 w-3.5" /> {forced ? "Set your new PIN" : "Change PIN"}
        </div>
        <h1 className="mb-1 text-2xl font-semibold text-slate-900">
          {forced ? "Welcome to BoothIQ" : "Change your PIN"}
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          {forced ? "For security, choose a new PIN to replace your temporary one." : "Enter your current PIN and a new one."}
        </p>

        {!forced && (
          <>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Current PIN</label>
            <input data-testid="current-pin" type="password" inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value)} required
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="••••••" />
          </>
        )}
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">New PIN (4-8 digits)</label>
        <input data-testid="new-pin" type="password" inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value)} required
          className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="••••••" />
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Confirm New PIN</label>
        <input data-testid="confirm-pin" type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
          className="mb-6 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="••••••" />
        <button data-testid="change-pin-submit" disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-semibold text-white transition-transform active:scale-95 disabled:opacity-60">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save PIN
        </button>
      </form>
    </div>
  );
}
