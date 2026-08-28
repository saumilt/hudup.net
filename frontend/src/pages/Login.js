import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { APP_VERSION } from "@/version";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, pin);
      toast.success(`Welcome, ${user.name}`);
      const home = user.role === "admin" ? "/crm"
        : user.role === "lead_manager" || user.role === "account_manager" ? "/crm"
        : "/dashboard";
      nav(home);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Login failed");
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
        <h1 className="mb-1 text-2xl font-semibold text-slate-900">Staff Sign In</h1>
        <p className="mb-6 text-sm text-slate-500">Email and PIN</p>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Email</label>
        <input
          data-testid="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          placeholder="admin@boothiq.com"
        />
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">PIN</label>
        <input
          data-testid="login-pin"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          required
          className="mb-6 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          placeholder="••••••"
        />
        <button
          data-testid="login-submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-semibold text-white transition-transform active:scale-95 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign In
        </button>
      </form>
    </div>
  );
}
