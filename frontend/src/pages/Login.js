import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Activity, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { APP_VERSION } from "@/version";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  const sendForgot = async (e) => {
    e.preventDefault();
    setForgotBusy(true);
    try {
      const { data } = await api.post("/auth/forgot-pin", { email: forgotEmail });
      setForgotMsg(data.message || "If an account exists for that email, a temporary PIN has been sent.");
    } catch {
      setForgotMsg("If an account exists for that email, a temporary PIN has been sent.");
    } finally {
      setForgotBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, pin);
      toast.success(`Welcome, ${user.name}`);
      const home = user.must_change_pin ? "/change-pin"
        : user.role === "staff" ? "/dashboard"
        : "/home";
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
        <h1 className="mb-1 text-2xl font-semibold text-slate-900">Sign In</h1>
        <p className="mb-6 text-sm text-slate-500">Email and PIN or password</p>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Email</label>
        <input
          data-testid="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          placeholder="you@healthandmore.net"
        />
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">PIN or Password</label>
        <input
          data-testid="login-pin"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          required
          className="mb-6 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          placeholder="Enter your PIN or password"
        />
        <button
          data-testid="login-submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-semibold text-white transition-transform active:scale-95 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign In
        </button>
        <button type="button" data-testid="forgot-pin-link"
          onClick={() => { setForgotEmail(email); setForgotMsg(""); setShowForgot(true); }}
          className="mt-4 block w-full text-center text-sm font-semibold text-primary hover:underline">
          Forgot PIN or password?
        </button>
      </form>

      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForgot(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold text-slate-900">Reset your access</h2>
            {forgotMsg ? (
              <div className="mt-4 text-center">
                <div className="mx-auto mb-3 inline-flex rounded-full bg-emerald-50 p-3 text-emerald-600"><MailCheck className="h-6 w-6" /></div>
                <p data-testid="forgot-result" className="text-sm text-slate-600">{forgotMsg}</p>
                <button data-testid="forgot-done" onClick={() => setShowForgot(false)} className="mt-5 w-full rounded-lg bg-primary py-2.5 font-semibold text-white active:scale-95">Done</button>
              </div>
            ) : (
              <form onSubmit={sendForgot}>
                <p className="mb-4 text-sm text-slate-500">Enter your email and we'll send a temporary PIN. You'll set a new PIN or password after signing in.</p>
                <input data-testid="forgot-email-input" type="email" required value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                  className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="you@healthandmore.net" />
                <button data-testid="forgot-submit" disabled={forgotBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-semibold text-white active:scale-95 disabled:opacity-60">
                  {forgotBusy && <Loader2 className="h-4 w-4 animate-spin" />} Send temporary PIN
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
