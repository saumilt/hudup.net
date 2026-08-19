import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";

const FALLBACK_COLORS = ["#059669", "#0EA5E9", "#6366F1", "#F59E0B", "#EF4444", "#8B5CF6"];

export default function Wheel() {
  const { leadId } = useParams();
  const nav = useNavigate();
  const canvasRef = useRef(null);
  const audioRef = useRef({ ctx: null, muted: false });
  const rotRef = useRef(0);
  const lastSegRef = useRef(-1);
  const [segments, setSegments] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [prize, setPrize] = useState(null);
  const [size, setSize] = useState(Math.min(window.innerWidth, window.innerHeight));

  useEffect(() => {
    api.get("/kiosk/config").then((r) => {
      let segs = r.data.wheel_segments || [];
      if (!segs.length) segs = FALLBACK_COLORS.map((c, i) => ({ id: `f${i}`, label: `Prize ${i + 1}`, color: c }));
      setSegments(segs);
      audioRef.current.muted = r.data.wheel_mute;
    }).catch(() => {
      setSegments(FALLBACK_COLORS.map((c, i) => ({ id: `f${i}`, label: `Prize ${i + 1}`, color: c })));
    });
    const onResize = () => setSize(Math.min(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !segments) return;
    const ctx = canvas.getContext("2d");
    const N = segments.length;
    const seg = (2 * Math.PI) / N;
    const cx = size / 2, cy = size / 2, r = size / 2 - 10;
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < N; i++) {
      const a0 = i * seg + rotRef.current;
      const a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = segments[i].color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 3;
      ctx.stroke();
      // label
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a0 + seg / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
      ctx.font = `600 ${Math.max(14, size * 0.022)}px 'Plus Jakarta Sans', sans-serif`;
      ctx.fillText(segments[i].label, r - 20, 6);
      ctx.restore();
    }
    // hub
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.06, 0, 2 * Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }, [segments, size]);

  useEffect(() => { draw(); }, [draw]);

  const tick = () => {
    const a = audioRef.current;
    if (a.muted || !a.ctx) return;
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    o.frequency.value = 1100;
    o.type = "square";
    g.gain.setValueAtTime(0.08, a.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.ctx.currentTime + 0.05);
    o.connect(g).connect(a.ctx.destination);
    o.start();
    o.stop(a.ctx.currentTime + 0.05);
  };

  const chime = () => {
    const a = audioRef.current;
    if (a.muted || !a.ctx) return;
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      const o = a.ctx.createOscillator();
      const g = a.ctx.createGain();
      o.frequency.value = f;
      o.type = "triangle";
      const t = a.ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g).connect(a.ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  };

  const spin = async () => {
    if (spinning || prize) return;
    // iOS: unlock/resume AudioContext INSIDE the tap handler.
    if (!audioRef.current.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioRef.current.ctx = new AC();
    }
    if (audioRef.current.ctx?.state === "suspended") await audioRef.current.ctx.resume();

    setSpinning(true);
    // Resolve prize BEFORE animation (server decides, weighted).
    let target = Math.floor(Math.random() * segments.length);
    let resolvedPrize = null;
    try {
      const { data } = await api.post(`/kiosk/leads/${leadId}/spin`);
      if (data.prize) {
        resolvedPrize = data.prize;
        const idx = segments.findIndex((s) => s.id === data.prize.segment_id);
        if (idx >= 0) target = idx;
      }
    } catch {
      // Offline fallback: local prize (still one spin, resolved before animation).
      resolvedPrize = { ...segments[target], prize_name: segments[target].label, code: "OFFLINE" };
    }
    if (!resolvedPrize) resolvedPrize = { ...segments[target], prize_name: segments[target].label, code: "PENDING" };

    const N = segments.length;
    const seg = (2 * Math.PI) / N;
    const turns = 5;
    // land target center under the top pointer (-PI/2)
    const finalRot = turns * 2 * Math.PI + (-Math.PI / 2 - (target * seg + seg / 2));
    const startRot = rotRef.current % (2 * Math.PI);
    const total = finalRot - startRot;
    const duration = 4500 + Math.random() * 1500;
    const t0 = performance.now();

    const animate = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      rotRef.current = startRot + total * eased;
      draw();
      // velocity-following tick: fire when segment under pointer changes
      const cur = Math.floor(((-(rotRef.current) - Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) / seg);
      if (cur !== lastSegRef.current) { lastSegRef.current = cur; tick(); }
      if (p < 1) requestAnimationFrame(animate);
      else {
        chime();
        setPrize(resolvedPrize);
        setSpinning(false);
        // Auto-reset 20s after result.
        setTimeout(() => nav("/kiosk", { replace: true }), 20000);
      }
    };
    requestAnimationFrame(animate);
  };

  const restart = () => { if (prize) nav("/kiosk", { replace: true }); };

  if (!segments)
    return (
      <div className="flex h-screen items-center justify-center bg-emerald-700 text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );

  return (
    <div
      onClick={restart}
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 no-select"
    >
      {!prize && (
        <>
          <h1 className="mb-4 font-display text-3xl font-extrabold text-white drop-shadow sm:text-4xl">
            {spinning ? "Good luck! 🍀" : "Tap SPIN to win!"}
          </h1>
          <div className="relative" style={{ width: size * 0.92, height: size * 0.92 }}>
            {/* pointer */}
            <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: "18px solid transparent", borderRight: "18px solid transparent", borderTop: "34px solid #fbbf24" }} />
            <canvas ref={canvasRef} width={size} height={size} className="mx-auto block drop-shadow-2xl" style={{ width: size * 0.92, height: size * 0.92 }} />
            {/* center spin button */}
            <button
              data-testid="wheel-spin-btn"
              onClick={(e) => { e.stopPropagation(); spin(); }}
              disabled={spinning}
              className="absolute left-1/2 top-1/2 z-30 flex h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white font-display text-lg font-extrabold text-emerald-700 shadow-xl transition active:scale-90 disabled:opacity-70"
            >
              {spinning ? "…" : "SPIN"}
            </button>
          </div>
        </>
      )}

      {prize && (
        <div data-testid="wheel-prize" className="flex flex-col items-center px-8 text-center animate-in">
          <div className="mb-3 text-5xl">🎉</div>
          <p className="text-lg font-semibold uppercase tracking-widest text-emerald-200">You won</p>
          <h1 className="my-2 font-display text-5xl font-extrabold text-white drop-shadow sm:text-6xl">{prize.prize_name || prize.label}</h1>
          <div className="mt-4 rounded-2xl bg-white/95 px-8 py-5 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Show this code to booth staff</p>
            <p data-testid="wheel-code" className="font-display text-4xl font-extrabold tracking-[0.3em] text-emerald-700">{prize.code}</p>
          </div>
          <p className="mt-8 text-sm text-emerald-200">Tap anywhere to start over</p>
        </div>
      )}
    </div>
  );
}
