import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { UploadCloud, FileCheck2, Loader2, CheckCircle2, AlertTriangle, Zap, Database } from "lucide-react";
import { toast } from "sonner";

const CHUNK = 4 * 1024 * 1024;

export default function IngestionPanel() {
  const [sessions, setSessions] = useState([]);
  const [live, setLive] = useState(null);
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState(null); // {name, pct}
  const [seeding, setSeeding] = useState(false);

  const loadSessions = useCallback(async () => {
    const r = await api.get("/admin/sessions");
    setSessions(r.data);
    if (selected) {
      const cur = r.data.find((s) => s.id === selected.id);
      if (cur) setSelected(cur);
    }
  }, [selected]);

  const loadLive = useCallback(async () => {
    const r = await api.get("/admin/live");
    setLive(r.data.live ? { ...r.data.live, physician_count: r.data.physician_count } : null);
  }, []);

  useEffect(() => { loadSessions(); loadLive(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createSession = async () => {
    if (!newName.trim()) return;
    const r = await api.post("/admin/sessions", { name: newName });
    setNewName("");
    setSelected(r.data);
    loadSessions();
  };

  const uploadFile = async (file) => {
    if (!selected) return;
    const initForm = new FormData();
    initForm.append("filename", file.name);
    const { data: initData } = await api.post(`/admin/sessions/${selected.id}/files/init`, initForm);
    const fid = initData.file_id;
    const total = Math.ceil(file.size / CHUNK);
    for (let i = 0; i < total; i++) {
      const blob = file.slice(i * CHUNK, (i + 1) * CHUNK);
      const fd = new FormData();
      fd.append("index", i);
      fd.append("total", total);
      fd.append("chunk", blob, file.name);
      // retry on failure (resumable)
      let ok = false, attempts = 0;
      while (!ok && attempts < 5) {
        try { await api.post(`/admin/sessions/${selected.id}/files/${fid}/chunk`, fd); ok = true; }
        catch { attempts++; await new Promise((r) => setTimeout(r, 800 * attempts)); }
      }
      setUploading({ name: file.name, pct: Math.round(((i + 1) / total) * 100) });
    }
    await api.post(`/admin/sessions/${selected.id}/files/${fid}/complete`);
    setUploading(null);
    toast.success(`${file.name} uploaded — aggregating…`);
    // poll for processing completion
    const poll = setInterval(async () => {
      const r = await api.get(`/admin/sessions/${selected.id}`);
      setSelected(r.data);
      const f = r.data.files.find((x) => x.file_id === fid);
      if (f && f.status === "done") { clearInterval(poll); loadSessions(); }
    }, 1500);
  };

  const onFiles = async (e) => {
    const files = Array.from(e.target.files);
    for (const f of files) await uploadFile(f);
    e.target.value = "";
  };

  const finalize = async () => {
    const r = await api.post(`/admin/sessions/${selected.id}/finalize`);
    toast.success("Session finalized");
    const s = await api.get(`/admin/sessions/${selected.id}`);
    setSelected(s.data);
    loadSessions();
  };
  const goLive = async () => {
    await api.post(`/admin/sessions/${selected.id}/golive`);
    toast.success("Dataset is now LIVE");
    loadLive(); loadSessions();
    const s = await api.get(`/admin/sessions/${selected.id}`);
    setSelected(s.data);
  };
  const seedSample = async () => {
    setSeeding(true);
    await api.post("/admin/seed-sample");
    setSeeding(false);
    toast.success("Synthetic sample dataset generated & live");
    loadLive(); loadSessions();
  };

  const cov = selected?.coverage;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left: sessions + upload */}
      <div className="lg:col-span-2 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Ingestion Sessions</h2>
            <button data-testid="seed-sample" onClick={seedSample} disabled={seeding} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white active:scale-95 disabled:opacity-60">
              {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Generate Sample Dataset
            </button>
          </div>
          <div className="mb-4 flex gap-2">
            <input data-testid="session-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New session name (e.g. CMS 2023 Part D)" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button data-testid="create-session" onClick={createSession} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Create</button>
          </div>
          <div className="space-y-1">
            {sessions.map((s) => (
              <button key={s.id} data-testid={`session-${s.id}`} onClick={() => setSelected(s)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === s.id ? "border-primary bg-primary/5" : "border-slate-200"}`}>
                <span className="font-medium">{s.name}</span>
                <span className="flex items-center gap-2">
                  {s.is_live && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">LIVE</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === "finalized" ? "bg-blue-100 text-blue-700" : s.status === "processing" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{s.status}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 font-display text-lg font-bold">{selected.name}</h2>
            {selected.status !== "finalized" && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-700">
                <AlertTriangle className="h-4 w-4" /> Results are PROVISIONAL until you finalize this session.
              </div>
            )}
            <label className="mb-3 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-slate-500 hover:border-primary">
              <UploadCloud className="h-8 w-8" />
              <span className="text-sm font-semibold">Drop CMS Part D CSV parts here (chunked, resumable)</span>
              <span className="text-xs">Upload 5–8 parts across multiple sittings; totals finalize at the end.</span>
              <input data-testid="file-input" type="file" accept=".csv" multiple className="hidden" onChange={onFiles} />
            </label>
            {uploading && (
              <div className="mb-3">
                <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{uploading.name}</span><span>{uploading.pct}%</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${uploading.pct}%` }} /></div>
              </div>
            )}
            <div className="space-y-1">
              {(selected.files || []).map((f) => (
                <div key={f.file_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-slate-400" /> {f.filename}</span>
                  <span className="text-xs text-slate-500">{f.status === "done" ? `${f.rows.toLocaleString()} rows` : f.status}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button data-testid="finalize-session" onClick={finalize} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Finalize Session</button>
              <button data-testid="golive-session" disabled={selected.status !== "finalized"} onClick={goLive} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Go Live</button>
            </div>

            {cov && (
              <div className="mt-4 rounded-xl border border-slate-200 p-4">
                <h3 className="mb-3 font-display font-bold">Coverage Report</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Total rows" v={cov.total_rows?.toLocaleString()} />
                  <Stat label="Unique NPIs" v={cov.unique_npis?.toLocaleString()} />
                  <Stat label="Lowest NPI" v={cov.min_npi?.toLocaleString()} />
                  <Stat label="Highest NPI" v={cov.max_npi?.toLocaleString()} />
                </div>
                <p className="mt-3 text-xs text-slate-500">Estimated share of full dataset: <span className="font-bold text-slate-800">{cov.estimated_share_pct}%</span></p>
                {cov.warnings?.map((w, i) => (
                  <div key={i} className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700"><AlertTriangle className="h-4 w-4 flex-shrink-0" /> {w}</div>
                ))}
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Row density by 50M NPI block</p>
                  <div className="flex items-end gap-1">
                    {cov.density_blocks?.map((b) => {
                      const max = Math.max(...cov.density_blocks.map((x) => x.count));
                      return <div key={b.block} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(4, (b.count / max) * 60)}px` }} title={`Block ${b.block}: ${b.count}`} />;
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: live dataset */}
      <div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><Database className="h-5 w-5 text-primary" /> Live Dataset</h2>
          {live ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-800">{live.name}</p>
                  <p className="text-xs text-emerald-600">{live.physician_count?.toLocaleString()} physicians · scoring live</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">Previous versions stay intact until a new session finalizes and goes live — zero downtime.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
              No live dataset. Generate a sample or finalize + go live with an upload.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <p className="text-lg font-bold text-slate-900">{v ?? "—"}</p>
      <p className="text-[10px] uppercase text-slate-400">{label}</p>
    </div>
  );
}
