import React, { useState, useEffect } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/crm/CrmShell";
import { Btn, inputCls } from "@/components/crm/kit";
import { Upload, ArrowRight, CheckCircle2, RotateCcw, Sparkles, StickyNote } from "lucide-react";

const STEPS = ["Upload", "Map Columns", "Review", "Done"];
const FIELD_OPTS = ["", "org_name", "contact_first", "contact_last", "email", "phone", "npi", "specialty", "city", "state", "source", "tags", "notes"];

export default function ImportWizard() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);       // {import_id, headers, sample, row_count}
  const [mapping, setMapping] = useState({});
  const [rule, setRule] = useState("safe");
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState("Data Scraping");
  const [year, setYear] = useState("");
  const [distribute, setDistribute] = useState("route");
  const [assignees, setAssignees] = useState([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [valid, setValid] = useState(null);   // {counts, preview, total}
  const [result, setResult] = useState(null); // {created, updated, skipped}
  const [busy, setBusy] = useState(false);

  const [presets, setPresets] = useState([]);
  useEffect(() => {
    api.get("/crm/lead-sources").then((r) => setSources(r.data)).catch(() => {});
    api.get("/imports/presets").then((r) => setPresets(r.data)).catch(() => {});
    api.get("/users", { params: { roles: "account_manager,lead_manager,admin,super_admin" } }).then((r) => setAssignees(r.data)).catch(() => {});
  }, []);
  const applyPreset = (id) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setMapping(p.mapping || {});
    if (p.source) setSource(p.source);
    if (p.data_year) setYear(String(p.data_year));
    setDistribute(p.distribute || "route");
    setAssigneeId(p.assignee_id || "");
    setRule(p.rule || "safe");
    toast.success(`Loaded preset "${p.name}"`);
  };
  const savePreset = async () => {
    const name = window.prompt("Save this mapping as a preset named:");
    if (!name || !name.trim()) return;
    try {
      await api.post("/imports/presets", { name: name.trim(), mapping, source, data_year: year ? Number(year) : null, distribute, assignee_id: assigneeId || null, rule });
      const r = await api.get("/imports/presets"); setPresets(r.data);
      toast.success("Preset saved");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const addSource = async () => {
    const name = window.prompt("New lead source name:");
    if (!name || !name.trim()) return;
    try {
      const r = await api.post("/crm/lead-sources", { name: name.trim() });
      setSources(r.data.sources); setSource(name.trim()); toast.success("Source added");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("dataset_type", "lead");
      const r = await api.post("/imports", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setJob(r.data);
      const a = await api.post(`/imports/${r.data.import_id}/analyze`);
      setMapping(a.data.mapping); setStep(1);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setBusy(false); }
  };
  const doValidate = async () => {
    if (distribute === "person" && !assigneeId) return toast.error("Pick a person to assign the imported leads to");
    setBusy(true);
    try {
      await api.post(`/imports/${job.import_id}/mapping`, { mapping, rule, source, data_year: year ? Number(year) : null, distribute, assignee_id: distribute === "person" ? (assigneeId || null) : null });
      const r = await api.post(`/imports/${job.import_id}/validate`);
      setValid(r.data); setStep(2);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setBusy(false); }
  };
  const doExecute = async () => {
    setBusy(true);
    try { const r = await api.post(`/imports/${job.import_id}/execute`); setResult(r.data); setStep(3); toast.success("Import complete"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setBusy(false); }
  };
  const doRollback = async () => {
    try { const r = await api.post(`/imports/${job.import_id}/rollback`); toast.success(`Rolled back ${r.data.removed} records`); reset(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const reset = () => { setStep(0); setFile(null); setJob(null); setMapping({}); setValid(null); setResult(null); };

  const CLS = { new: "text-emerald-700 bg-emerald-100", existing: "text-blue-700 bg-blue-100", duplicate_in_file: "text-amber-700 bg-amber-100", review: "text-slate-600 bg-slate-200" };

  return (
    <div>
      <PageHeader title="Data Import" subtitle="Upload physician / practice data → map → review → import (rollback-safe)." />
      <div className="p-6">
        {/* Stepper */}
        <div className="mb-6 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${i === step ? "bg-primary text-white" : i < step ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{i + 1}. {s}</span>
              {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-slate-300" />}
            </React.Fragment>
          ))}
        </div>

        {step === 0 && (
          <div className="max-w-lg rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <Upload className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="mb-3 text-sm text-slate-500">CSV, TSV, XLSX or JSON — physicians, practices or leads.</p>
            <input data-testid="import-file" type="file" accept=".csv,.tsv,.xlsx,.xls,.json" onChange={(e) => setFile(e.target.files[0])} className="mx-auto mb-4 block text-sm" />
            <Btn data-testid="import-upload" onClick={upload} disabled={!file || busy} className="justify-center">{busy ? "Analyzing…" : "Upload & Analyze"}</Btn>
          </div>
        )}

        {step === 1 && job && (
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm text-slate-600"><Sparkles className="h-4 w-4 text-primary" /> AI suggested a mapping for {job.row_count} rows. Adjust any column below.</div>
            <div className="mb-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">Tip: map any extra columns to <span className="font-semibold text-slate-700">notes</span> — each becomes a note on the lead (<span className="font-mono">Column: value</span>). You can point multiple columns at notes.</div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Source column</th><th className="p-3">Sample</th><th className="p-3">→ BoothIQ field</th></tr></thead>
                <tbody>
                  {job.headers.map((h) => (
                    <tr key={h} className="border-t border-slate-100">
                      <td className="p-3 font-semibold text-slate-700">{h}</td>
                      <td className="p-3 text-slate-400">{String(job.sample?.[0]?.[h] ?? "")}</td>
                      <td className="p-3">
                        <select data-testid={`map-${h}`} value={mapping[h] || ""} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value || null })} className={inputCls}>
                          {FIELD_OPTS.map((f) => <option key={f} value={f}>{f || "— ignore —"}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <select data-testid="import-preset" defaultValue="" onChange={(e) => { if (e.target.value) { applyPreset(e.target.value); e.target.value = ""; } }} className={inputCls}>
                  <option value="">Load a saved preset…</option>
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Btn variant="ghost" type="button" onClick={savePreset} data-testid="import-save-preset">Save as preset</Btn>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Lead source</label>
                  <div className="flex gap-2">
                    <select data-testid="import-source" value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
                      {sources.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <Btn variant="ghost" type="button" onClick={addSource} data-testid="import-add-source">+ Add</Btn>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Data collected year</label>
                  <input data-testid="import-year" type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2026" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Import rule</label>
                  <select data-testid="import-rule" value={rule} onChange={(e) => setRule(e.target.value)} className={inputCls}>
                    <option value="safe">Safe — create new, skip existing</option>
                    <option value="refresh">Refresh — fill missing on existing</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Assignment</label>
                  <select data-testid="import-distribute" value={distribute} onChange={(e) => setDistribute(e.target.value)} className={inputCls}>
                    <option value="route">Territory routing (round-robin fallback)</option>
                    <option value="equal">Assign equally to all reps (round-robin)</option>
                    <option value="person">Assign all to a specific person…</option>
                  </select>
                </div>
                {distribute === "person" && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Assign to</label>
                    <select data-testid="import-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
                      <option value="">Select a person…</option>
                      {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role && a.role !== "account_manager" ? ` (${a.role.replace("_", " ")})` : ""}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex">
                <Btn data-testid="import-validate" onClick={doValidate} disabled={busy} className="ml-auto">{busy ? "Checking…" : "Review Matches"} <ArrowRight className="h-4 w-4" /></Btn>
              </div>
            </div>
          </div>
        )}

        {step === 2 && valid && (
          <div className="max-w-3xl">
            <div className="mb-4 grid grid-cols-4 gap-3">
              {Object.entries(valid.counts).map(([k, v]) => (
                <div key={k} data-testid={`vcount-${k}`} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                  <p className="font-display text-2xl font-bold text-slate-900">{v}</p>
                  <p className="text-xs capitalize text-slate-400">{k.replace(/_/g, " ")}</p>
                </div>
              ))}
            </div>
            {valid.notes_columns?.length > 0 && (
              <div data-testid="notes-columns-summary" className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                <StickyNote className="h-4 w-4" /> {valid.notes_columns.length} column{valid.notes_columns.length > 1 ? "s" : ""} → notes: <span className="font-semibold">{valid.notes_columns.join(", ")}</span>
              </div>
            )}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Class</th><th className="p-3">Org</th><th className="p-3">Contact</th><th className="p-3">NPI</th><th className="p-3">Notes</th></tr></thead>
                <tbody>{valid.preview.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${CLS[r.class]}`}>{r.class.replace(/_/g, " ")}</span></td>
                    <td className="p-3 text-slate-700">{r.data.org_name || "—"}</td>
                    <td className="p-3 text-slate-600">{[r.data.contact_first, r.data.contact_last].filter(Boolean).join(" ") || "—"}</td>
                    <td className="p-3 font-mono text-xs text-slate-500">{r.data.npi || "—"}</td>
                    <td className="p-3 text-slate-500" data-testid={`vpreview-notes-${i}`}>{r.notes ? `${r.notes} note${r.notes > 1 ? "s" : ""}` : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mt-4 flex gap-3">
              <Btn variant="ghost" onClick={() => setStep(1)}>Back</Btn>
              <Btn data-testid="import-execute" onClick={doExecute} disabled={busy} className="ml-auto">{busy ? "Importing…" : `Import ${valid.counts.new} New Records`}</Btn>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
            <p className="font-display text-xl font-bold text-slate-900">Import complete</p>
            <p className="mt-1 text-sm text-slate-500">{result.created} created · {result.updated} updated · {result.skipped} skipped</p>
            <div className="mt-5 flex justify-center gap-3">
              <Btn data-testid="import-rollback" variant="danger" onClick={doRollback}><RotateCcw className="h-4 w-4" /> Rollback</Btn>
              <Btn onClick={reset}>Import Another</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
