import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Phone, PhoneOff, Mic, MicOff, PhoneCall } from "lucide-react";
import { Btn } from "@/components/crm/kit";

const LABELS = {
  idle: "Ready to call", connecting: "Connecting…", ringing: "Ringing…",
  "in-call": "Connected", ended: "Call ended", error: "Call error",
};

export default function Softphone({ lead, user }) {
  const [enabled, setEnabled] = useState(null); // null = loading
  const [status, setStatus] = useState("idle");
  const [muted, setMuted] = useState(false);
  const deviceRef = useRef(null);
  const callRef = useRef(null);

  useEffect(() => {
    api.get("/voice/config").then((r) => setEnabled(!!r.data.enabled)).catch(() => setEnabled(false));
    return () => { try { callRef.current?.disconnect(); deviceRef.current?.destroy(); } catch (e) { /* noop */ } };
  }, []);

  const ensureDevice = async () => {
    if (deviceRef.current) return deviceRef.current;
    const { data } = await api.get("/voice/token");
    if (!data.token) throw new Error("not configured");
    const device = new Device(data.token, { logLevel: 1, closeProtection: true });
    device.on("tokenWillExpire", async () => {
      try { const t = await api.get("/voice/token"); if (t.data.token) device.updateToken(t.data.token); } catch (e) { /* noop */ }
    });
    device.on("error", () => setStatus("error"));
    deviceRef.current = device;
    return device;
  };

  const callLead = async () => {
    if (!lead?.phone) return toast.error("No phone number on file for this lead");
    try {
      setStatus("connecting");
      const device = await ensureDevice();
      const call = await device.connect({
        params: { lead_id: String(lead.id), by_id: user?.id || "", by_name: user?.name || "" },
      });
      callRef.current = call;
      call.on("ringing", () => setStatus("ringing"));
      call.on("accept", () => setStatus("in-call"));
      call.on("disconnect", () => { callRef.current = null; setStatus("ended"); setMuted(false); });
      call.on("cancel", () => { callRef.current = null; setStatus("idle"); });
      call.on("reject", () => { callRef.current = null; setStatus("idle"); });
      call.on("error", () => setStatus("error"));
    } catch (e) {
      setStatus("error");
      toast.error("Could not start the call. Allow microphone access and try again.");
    }
  };

  const toggleMute = () => {
    if (!callRef.current) return;
    const next = !muted;
    callRef.current.mute(next);
    setMuted(next);
  };

  const hangUp = () => { callRef.current?.disconnect(); };

  if (enabled === null) return null;
  if (enabled === false) {
    return (
      <div data-testid="softphone-disabled" className="mb-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
        Browser calling isn’t configured yet — add your Twilio TwiML App SID and a voice number to enable one-tap dialing.
      </div>
    );
  }

  const active = ["connecting", "ringing", "in-call"].includes(status);
  return (
    <div data-testid="softphone" className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <PhoneCall className="h-4 w-4 text-primary" />
      <span className="text-sm text-slate-600">{LABELS[status] || status}</span>
      <div className="ml-auto flex items-center gap-2">
        {!active ? (
          <Btn data-testid="softphone-call" onClick={callLead} disabled={!lead?.phone}><Phone className="h-4 w-4" /> Call in browser</Btn>
        ) : (
          <>
            <Btn data-testid="softphone-mute" variant="ghost" onClick={toggleMute} disabled={status !== "in-call"}>
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {muted ? "Unmute" : "Mute"}
            </Btn>
            <Btn data-testid="softphone-hangup" variant="danger" onClick={hangUp}><PhoneOff className="h-4 w-4" /> Hang up</Btn>
          </>
        )}
      </div>
    </div>
  );
}
