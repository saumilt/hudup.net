# BoothIQ — Product Requirements Document

## Original Problem Statement
Convention booth lead-capture system for a healthcare services company. Runs on an iPad at a trade show: scores each physician lead in real time against uploaded CMS Medicare Part D prescribing data, launches a full-screen prize wheel, and texts the sales team when a high-value lead walks up. Three separate surfaces with separate auth: admin console, doctor kiosk, staff dashboard. ABSOLUTE RULE: the kiosk never shows a score, dollar figure, or Medicare data.

## Cross-Platform Note (2026-08)
- App now spans TWO clients on one shared FastAPI+MongoDB backend: **web** (`/app/frontend`, React) and **mobile** (`/app/mobile`, Expo/React Native rep-companion). Same `/api` contract, same brand (design_guidelines.json). Mobile calls backend via `EXPO_PUBLIC_BACKEND_URL`; web via `REACT_APP_BACKEND_URL`.

## v2.33 (2026-06) — Map View · Drive-Time Radius · Referral Network linkage (testing-agent verified)
- **Map View (Leaflet)** — radius results now render on an interactive map on both **Medicare Search** and **Referral Search** via a List/Map toggle. New `components/crm/CoverageMap.js` (react-leaflet, vector-only CircleMarker/Circle so no marker-icon assets needed): radius circle + red origin pin (labeled) + teal city pins **sized by matching-doctor count**, with hover tooltips + click popups. Backed by new `POST /api/medicare/geo/coverage` (per-city match counts within radius, respecting all filters, returning lat/lon/count for plotting).
- **Drive-Time Radius** (keyless approximation) — new `components/crm/RadiusControls.js` adds a **Miles / Drive-time** mode toggle. Drive-time (minutes × adjustable avg mph, default 45) converts to effective straight-line miles (`effectiveMiles`) and shows a human label (`~23 mi (≈30 min @ 45 mph)`). No external routing/API key; true isochrones (OpenRouteService) intentionally skipped to stay keyless. Radius spec `{mode, miles, driveMin, mph}` is stored in saved views/generators so it reloads exactly.
- **Referral Network linkage** — a lead created from Referral Search stores `referral_generator_id` (+ `referral_generator_name`); `GET /api/crm/referral-generators/counts` maps generator→lead count; saved-generator chips show an **"X leads"** badge opening a modal (`rs-produced-modal`) that lists the produced leads (`GET /api/crm/leads?referral_generator_id=`).
- **Stack**: added `leaflet@^1.9.4` + `react-leaflet@^5.0.0` to the web frontend (compiles clean under React 19, no hydration errors). Backend geo engine unchanged (`geo.py`, pgeocode + US Census).
- Verified: **testing agent iteration 27** — 6/6 backend pytest (`tests/test_iteration27_geo_referral.py`) + full web e2e: both radius modes, Leaflet rendering (61/50 SVG paths), saved-view & saved-generator radius persistence, and the end-to-end referral-network lead linkage (create lead L-00502 → "1 leads" badge → produced-leads modal). Non-blocking pre-existing `<span> inside <option>` hydration warning noted, unrelated. Version badge → **v2.33**.


## v2.32 (2026-06) — Geographic radius search + Referral Search
- **Radius search everywhere** — enter an **address, city, or ZIP + radius (miles)** to find doctors/leads in all nearby cities. Added to **Medicare Search** (`ms-origin`/`ms-radius` + quick-picks 10/25/50/100 + free-form, result banner `ms-radius-banner`), **CRM Leads** list (`lead-filter-origin`/`lead-filter-radius`), and the new **Referral Search** page.
- **Referral Search** (new nav `/crm/referral-search`, `Compass` icon, all CRM roles) — name a **referral generator**, enter **their practice address/city/ZIP + radius**, apply **340B color / RPM / specialty**, and get nearby doctors who could be referral partners, with the **list of cities in radius** shown and one-click **Add lead** (source "Referral Search", tagged with the generator). **Save generator** reuses saved-searches `entity="referral"` (name + origin + radius + filters), reloadable.
- **Geo engine** (`backend/geo.py`, keyless/free): data has only city+state per doctor, so radius is **city-level**. `pgeocode` (offline GeoNames, 41.5k US zips) resolves ZIP→centroid and city→centroid; the **US Census one-line geocoder** resolves full street addresses. A one-time `med_city_geo` index precomputes a centroid for each of **13,453 provider cities** (built in 0.2s with a new `{state, city}` index on `physicians`); radius filtering is an in-memory haversine over that cache. Rebuilt lazily + on startup (`server.py`), so it's always ready.
- **Backend**: `POST /api/medicare/search` now takes `radius_mi` + `origin_address|city|state|zip` (radius supersedes free-text city/state and returns `origin` + `radius_cities`); `POST /api/medicare/geo/resolve` returns origin + nearby cities with distances; `POST /api/medicare/geo/build` rebuilds the index; `GET /api/crm/leads` takes the same `radius_mi` + `origin_*` (Python city-upper match, cross-state safe). Added `pgeocode==0.5.0` to requirements.
- Self-tested end-to-end: ZIP 06510→59 cities; NYC 10mi+GREEN→225 providers; Leads NYC 100mi→72 across NY/PA/NJ/CT; save/list/delete referral generator; live UI across all three surfaces + Referral Search. NOTE: not run through the testing agent. Version badge → **v2.32**.


## v2.31 (2026-06) — One enrichment path + Auto-Research + Source/Confidence + Re-Research
- **Retired the broken PDL buttons** — "Enrich Practice" had no backend route (always failed) and "Enrich" (PDL person) was removed too, so **AI Enrich (live web research) is now the single enrichment path** on a lead. PDL backend endpoints (`routes_crm_engage.py`, `enrichment.py`) are left intact, so the buttons are trivially restorable if wanted.
- **Auto-Research New Leads** — admin toggle on Teams page (`auto-research-settings` / `auto-research-toggle`; `GET/PUT /api/crm/auto-research/settings`, PUT admin-only, stored in `app_settings._id="auto_research"`, default OFF). When ON, `create_lead` kicks off a background research job (`routes_ai_enrich.start_research_job(..., auto=True)`); on completion the lead gets `ai_research_ready=true` + `ai_research_job_id`, surfaced as an **"AI research ready — review"** button (`action-review-research`) that opens the preview.
- **Source + Confidence per field** — `ai_research` now asks the model for each contact field as `{value, source, confidence(HIGH|MEDIUM|LOW)}`; job stores `field_meta`. Review list shows a color-coded confidence badge (`ai-conf-*`) + clickable source-host link (`ai-src-*`) per field. Accept stores per-field `confidence` + `source_url` and a source-tagged provenance label.
- **Re-Research (Refresh from web)** — `action-reresearch` button on the lead re-runs AI web research and opens the review directly.
- Self-tested end-to-end (backend curl: auto-toggle → create lead → background job → `field_meta` all HIGH with real Mayo Clinic sources → accept stores per-field source/confidence → flag cleared → non-admin PUT 403; live UI screenshot: retired buttons gone, Refresh present, 10 confidence badges + 10 source links, Teams toggle). NOTE: not run through the testing agent. Version badge → **v2.31**.


## v2.30 (2026-06) — AI Enrich: live web research (Claude Sonnet 4.6 + web_search)
- **AI web research on a lead**: the "AI Enrich" modal now has a **"Research the web with AI"** button that researches the practice + physician from the live web using what's already on the record (org name, contact name, city/state, NPI, specialty) — no PDF/paste needed. Returns contact/practice fields + a summary + factual notes with **source URLs**, shown for review; nothing is saved until the user ticks fields and applies (accept applies with provenance label **"AI (web research)"**).
- **Provider reality**: OpenAI/ChatGPT web search is NOT available on the Emergent Universal key (LiteLLM rejects `web_search_options` for gpt-5.4/gpt-4.1/gpt-4o/gpt-4o-search-preview). Verified Anthropic `web_search` and Gemini `googleSearch` both work via the key; per user choice we use **Anthropic `claude-sonnet-4-6`** with the server-side `web_search_20250305` tool (`ai.generate_web_research`). Plain (non-search) AI extract-from-PDF/paste still uses OpenAI `gpt-5.4`.
- **Async job pattern** (web search is slow → ingress 502 on sync): `POST /api/crm/leads/{id}/ai-enrich/research` kicks off a background task and returns `{job_id,status:"running"}`; the client polls `GET /api/crm/leads/{id}/ai-enrich/jobs/{job_id}` (status running|preview|error) every 3s (~2min cap). Reuses the existing `/ai-enrich/accept` to apply. Backend: `ai_enrich.ai_research`, `routes_ai_enrich._run_research_job`.
- Self-tested end-to-end (curl POST→poll→preview→accept: real cited data for Cleveland Clinic in ~16s, correct provenance; live UI screenshot: research button → ~18s → preview with 5 fields + summary + source notes). NOTE: not run through the testing agent. Version badge → **v2.30**.


## v2.29 (2026-06) — Closer Handoff Alert · Digest Preview · Territory Rebalance Now
- **Closer Handoff Alert** (`routes_push.notify_closer_assigned` + `set_closer`): the moment a lead manager is named the Closer on a lead, a dedicated **push + email** goes out ("You're the closer on a deal…", owner unchanged) so nothing sits waiting. Push logs a non-blocking `EMERGENT_PUSH_KEY` warning in preview (expected; resolves on deploy); email via Resend.
- **Digest Preview** (`routes_digest.build_digest_preview` + `GET /crm/notifications/digest/preview`): admins/managers preview exactly what each rep's daily digest email will contain before it sends — per-rep breakdown `{rep_name,email,count,leads[]}`. Teams page card gains a **Preview** button (`digest-preview-btn`) opening a modal (`digest-preview`, empty state `digest-preview-empty`). `run_assignment_digest` now reuses the same builder (`_digest_html`).
- **Territory Rebalance Now** (`_match_territory` helper + `POST /crm/leads/route-by-territory`): one-tap action that assigns every unassigned, non-archived lead to a member of its **matching** territory's team (round-robin); leads with no matching territory are left untouched. Returns `{routed,skipped,by_team}`. Teams header button `route-by-territory`. `auto_route_lead` refactored to share `_match_territory`.
- Verified: testing agent iteration 26 — 6/6 backend pytest (`tests/test_iteration26_v229.py`) + web e2e; role gating confirmed (lead_manager 200 / account_manager 403 on preview + rebalance). Version badge → **v2.29**.


## v2.28 (2026-06) — Closer Queue · Archive Bin · Saved Medicare Views · Territory Auto-Assign · Digest Time
- **Closer Queue** (`/crm/closer-queue`, nav `nav-closer-queue`, roles super_admin/admin/lead_manager): lead managers see every lead where they are the Closer (`GET /crm/leads?closer_id=<self>`); admins/super_admins see all leads with any closer (`GET /crm/leads?has_closer=true`, shows a Closer column). New backend filters `closer_id` + `has_closer` on `list_leads`.
- **Archive Bin** (`/crm/archive`, admin-only, nav `nav-archive`): lists archived leads + archived opportunities with one-click **Restore** (`POST /crm/leads|opportunities/{id}/archive {archived:false}`). Non-admins are redirected.
- **Saved Medicare Views** (`Medicare.js`): account managers save a state+city+340B-color filter set (`ms-save` → `POST /crm/saved-searches {entity:'medicare'}`) and reload it in one click from the saved-views bar (`ms-saved-views`, dropdown `ms-view-select`, chips `ms-view-chip-*`, delete `ms-view-del-*`). `applyView` sets states/cities/tiers and re-runs the search.
- **Territory Auto-Assign** (`LeadDetail.js` + `routes_teams.py`): when an admin changes a lead's Territory, a confirm offers to reassign it to that territory's team via round-robin — new admin-only `POST /crm/leads/{id}/route-to-territory` (400 if no territory/team, returns account_manager_name + team_name).
- **Daily Digest custom time** (Teams page `digest-settings` card + `routes_digest.py`): admins set hour/minute/timezone + enabled (`digest-hour/minute/tz/enabled`, save `digest-save` → admin-only `PUT /crm/notifications/digest/settings`); `GET` is manager-visible (controls disabled for non-admins). `digest_worker` now runs once per day at the configured local time (zoneinfo, default America/New_York) with a first-encounter baseline so restarts never blast. `Send now` (`digest-send-now`) triggers `/crm/notifications/digest/run` (manager-accessible).
- **Scope fix**: `_lead_scope` and `_opp_scope` now include `super_admin`, so a super admin sees ALL leads and opportunities (previously only their own — verified 417 leads).
- Verified: testing agent iteration 25 — 15/15 backend pytest (`tests/test_iteration25_v228.py`) + web e2e across super_admin/lead_manager/account_manager, no bugs. Version badge → **v2.28**.


## v2.27 (2026-06) — See-all leads + filters · Closer/collaborators · Medicare multi-filter · Admin archive
- **See all leads + filters (Phase 1)**: `_lead_scope` now returns all leads for account managers too (everyone sees every lead). Leads list adds **City** (`lead-filter-city`) and **Assigned rep** (`lead-filter-assigned`) filters; backend `list_leads` gained `city` (regex) + `archived` (default excludes archived).
- **Closer + collaborators (Phase 2)**: lead keeps its account-manager **owner**; a **Closer** (lead manager) can be added by ANY account manager via `POST /leads/{id}/closer` (ANY_CRM). Managers can add **collaborator** account managers + set **collaboration_mode** (`both`/`owner_only`) + **territory** via the extended `/leads/{id}/assign`. Ownership panel UI: `ld-closer`, `ld-collaborators`/`ld-collab-*`, `ld-collab-mode`, `ld-territory`. Closers/collaborators (Phase 1 visibility + ANY_CRM) can add notes/appointments and edit.
- **Medicare multi-filter (Phase 3)**: `SimpleSearch` accepts `states[]`, `cities[]`, `tiers[]` ($in, ANY-match, legacy singular fallback). New `GET /medicare/states` + `GET /medicare/cities?states=`. Medicare page: multi-select **State** dropdown (`ms-states`) → cascading multi **City** (`ms-cities`, cities within chosen states) → multi **340B color** chips (`ms-tier-*`). Account managers already had `CRM_VIEW` access + nav.
- **Admin archive + territory (Phase 4)**: `POST /leads/{id}/archive` + `POST /opportunities/{id}/archive` are **admin-only** (require_admin; account managers get 403); archived items excluded from default lists (`archived=true` to view). `OppPatch` gained `name`. Lead Detail shows an admin **Archive** button (`ld-archive`); Opportunities page shows admin **Edit** modal (`opp-edit-*`) + **Archive** (`opp-archive-*`) + Show-archived toggle. Admin can set a lead's **Territory** (`ld-territory`).
- Verified: testing agent iteration 24 — backend 17/17 pytest + web for BOTH roles (admin sees all controls; account manager correctly restricted, sees all leads, Medicare search 1.14M). Version → **v2.27**.
- Known: cosmetic React console warning (`<span>` under `<option>`) on Leads.js — non-blocking.



- **BUG FIX (Enrich Practice / Enrich gateway 502)**: `enrich_lead_company` and `enrich_lead` (PDL) now catch ALL exceptions and return HTTP 200 `{matched:false, error/message}` instead of a 5xx that surfaced as a Cloudflare "invalid/incomplete response" page. PDL simply having no data no longer looks like a crash.
- **NEW: AI Enrich from a document** (`ai_enrich.py` + `routes_ai_enrich.py`): on a lead, "AI Enrich" accepts a **PDF upload**, a **file_url**, and/or **pasted research text** (e.g. a ChatGPT profile). pypdf extracts the text; the Emergent LLM (gpt-5.4) extracts contact/practice fields (email, work_email, phone, office_phone, website, linkedin, title, practice, address, city/state/zip, npi, specialty) + a summary + bullet notes — using ONLY what's in the material (no fabrication). Review modal → apply chosen fields (mirrored onto empty top-level lead fields + stored in `enrichment` with provenance) and everything else is saved as a prepended "🤖 AI update" note. Endpoints: `POST /leads/{id}/ai-enrich` (multipart) + `POST /leads/{id}/ai-enrich/accept`.
- Verified: testing agent iteration 23 — backend 6/6 pytest (enrich no-5xx, ai-enrich from the Prem Soman PDF → email somanp@upmc.edu + NPI 1265407225 + summary + 30+ notes, accept applies + adds note, empty-input → clean 400) + web UI (AI Enrich modal end-to-end, Data Completeness 33%→56%). Agent fixed a duplicate `ai` useState in LeadDetail.js. Version → **v2.26**.
- pypdf added to requirements; backend restarted.

### ⏳ CONFIRMED-BUT-NOT-YET-BUILT (next up — user approved in this session)
- **Phase 1**: all roles (incl. account managers) can view ALL leads; add City + Assigned-user filters (state exists).
- **Phase 2 (owner/closer model)**: owner=account manager; add a Lead Manager as "Closer" + a second AM collaborator; admin toggles "both work" vs "owner only"; any account manager can add a closer (Q1=b); closer/collaborator get FULL edit (Q2=b); closers/collaborators can add appointments + notes.
- **Phase 3 (Medicare filters)**: multi-select State dropdown → cascading multi City (cities within chosen states) → multi 340B color/tier; grant Account Managers access to Medicare Search.
- **Admin edit/archive/territory**: admin can edit + archive leads AND opportunities; admin can change a lead's territory/team (currently non-editable).



- **Round-robin across chosen people**: the import "equal" mode now round-robins across a manager-selected set of participants (`rr_user_ids` on MappingInput/PresetInput; execute builds the pool from those users in order, else defaults to all active account managers). The Import Wizard shows a checkbox list of assignees that INCLUDES lead managers + admins (relabeled option "Round-robin across chosen people"). Satisfies "pick exactly who it rotates across" + "include lead managers".
- **New user Fatema** (fatema@healthandmore.net) created as **lead_manager** via the existing admin invite endpoint — temp PIN `125148` emailed via Resend, forced change on first login. (see test_credentials.md)
- **Team PATCH 404** consistency fix (returns 404 on missing id, like territory PATCH).
- Verified: testing agent iteration 22 — backend 4/4 pytest (team/territory edit+delete, RR rotation [LM,AM,LM], RR fallback to account managers) + web UI (teams edit/delete modals; import RR list showing 12 assignees incl. 4 lead managers with Fatema). Version → **v2.25**.



- **Bug fix**: the Teams & Territories page only allowed CREATE — no edit/delete — and territories had no edit endpoint. Added `PATCH /api/crm/territories/{id}` (edit name/team/states/specialties; states uppercased). Teams already had PATCH+DELETE and territories had DELETE.
- **Frontend**: every team card and territory card now has **Edit** + **Delete** actions (`team-edit-*`/`team-delete-*`/`terr-edit-*`/`terr-delete-*`); the New/Edit modals are shared with dynamic titles. Delete uses a confirm. Access is admin/super_admin/lead_manager (require_roles already includes admins).
- Verified by main agent (self-test): curl as admin@boothiq.com — create/PATCH team, create/PATCH territory (states tx→[OK,TX]), delete both; screenshot confirmed Edit/Delete buttons on all cards. Version → **v2.24**.



- **Keep imported number**: the importer now records the overridden note's `note_id` in `claim_mismatch_detail`. New `POST /api/crm/leads/claim-mismatch/keep-imported` (manager, per `lead_ids`) restores that note to the imported value (`"<label>: <imported> (source verified)"`), clears the flag, and stamps `claim_mismatch_resolved.kept="imported"`. The Mismatch Report gained per-row **"Keep imported"** vs **"Use Medicare"** actions (bulk "Accept Medicare's numbers (N)" unchanged; its resolve now stamps `kept="medicare"`). Lets managers keep the source figure when it's actually right.
- Verified by main agent (self-test): curl — imported 555 vs Medicare 1943 (note overridden to 1943) → keep-imported → note "Total Claims: 555 (source verified)", flag cleared, resolved.kept="imported"; UI screenshot confirmed both per-row buttons. Rolled back the test import. NOT run through the testing agent (small feature on tested infra). Version → **v2.23**.



- **Accept Medicare's numbers**: new `POST /api/crm/leads/claim-mismatch/resolve` (manager) — clears the `claim_mismatch` flag on flagged leads (all, or a passed `lead_ids` list), stamps `claim_mismatch_resolved {at, by}`, and logs an activity. The note already carries the Medicare value (from import), so this just resolves/acknowledges the flag. On the **Mismatch Report** page: a header **"Accept Medicare's numbers (N)"** button (with confirm) resolves every flagged lead at once, plus a per-row **Accept**. Resolved leads drop off the report and lose the Leads-list badge.
- Verified by main agent (self-test): curl — imported a wrong claim (555) vs Medicare (1943) → 1 flagged → resolve-all → 0 flagged (note retained Medicare value); UI screenshot confirmed the report table (555 red vs 1943 green) + Accept buttons. Rolled back the test import. NOT run through the testing agent (small feature on already-tested infra). Version → **v2.22**.



- **Undo reassign**: `bulk-assign` now returns `prev` (each lead's previous owner); new `POST /api/crm/leads/restore-assign` restores them. The Leads reassign success toast shows an **Undo** action (sonner) that reverts the batch (routing_reason "Reassignment undone").
- **Daily assignment digest** (`routes_digest.py`): new `run_assignment_digest()` emails each rep ONE summary of leads assigned to them in the last 24h; `digest_worker()` runs daily (first startup only records a baseline so restarts never blast); manual `POST /api/crm/notifications/digest/run?window_hours=N` (manager) for on-demand/testing. **Per-import assignment emails were removed** — the digest replaces them (import still assigns + pushes are unaffected). Bulk reassign keeps its immediate notify. Emails send live via Resend.
- **Change-history filter**: the Lead Detail **Change History** panel gained tabs — All / Edits / Reassignments / Status (`hist-tab-*`) — client-side filtering the updated/assigned/status entries.
- **Mismatch Report** (`MismatchReport.js`, `/crm/mismatch-report`, manager nav `nav-mismatch-report`): one-screen table of every claim-mismatch lead with **imported vs Medicare** claim counts side by side (+ NPI, 340B, assignee); row click opens the lead. Backed by `GET /api/crm/leads?claim_mismatch=true`.
- Verified: testing agent iteration 21 — backend 6/6 pytest + web e2e (undo round-trip, digest run, history tabs, mismatch page), no bugs (report `/app/test_reports/iteration_21.json`). Also curl-verified digest (4 reps/410 leads) + reassign→undo round-trip. Version → **v2.21**.



- **Reassign in bulk**: the Leads bulk-assign bar now reassigns even already-owned leads to any account manager / lead manager / admin. Button relabeled **Reassign**; a **confirmation modal** ("Reassign N leads to X? They'll be notified…") gates the action. Backend `bulk-assign` sets `account_manager_name` + `routing_reason` "Reassigned to X by Y", logs an activity per lead, and fires the assignment notification.
- **Change history (lead detail)**: `patch_lead` now computes a field-level diff and logs an `updated` activity with `meta.changes = [{field, from, to}]` and summary "Edited <fields>". New **Change History** panel on the web Lead Detail lists edits + reassignments + status changes with old → new values, author, and time.
- **Assignment notify (email + push)**: new `notify_assignment_summary` (`routes_push.py`) sends BOTH a Resend email and an Emergent push (each best-effort, never raises) when leads are assigned to one person — fired from the **import** person-assignment and from **bulk reassign**. NOTE: push returns 500 in preview (placeholder `EMERGENT_PUSH_KEY`) — expected; works after Publish. Email sends live via Resend.
- **Claim-mismatch flag**: `_reconcile_claim_notes` now numeric-compares and RETURNS a mismatch detail; import `execute` stores `claim_mismatch` + `claim_mismatch_detail {label, imported, medicare}` on the lead. New **"Claim mismatch"** filter + amber badge on the Leads list (`lead-filter-mismatch` / `claim-mismatch-<id>`) and a badge on the Lead Detail Medicare Match section — so bad source data is easy to spot. `GET /api/crm/leads?claim_mismatch=true` filters to flagged leads.
- Verified: testing agent iteration 20 — backend 5/5 pytest + web 7/7 e2e, no bugs (report `/app/test_reports/iteration_20.json`). Also curl-verified all four flows (555→1943 flag, edit diff, bulk reassign, person-assign notify). Version → **v2.20**.



- **BUG FIX — edit a lead once entered (web)**: the web Lead Detail page had NO edit form (only Email/Call/Text/Assign/Convert). Added an **Edit** button + modal (`ld-edit`/`edit-save`) covering org, first/last name, phone, email, priority, est. value, specialty, city, state. Backend `LeadPatch` (`PATCH /api/crm/leads/{id}`) extended to accept `contact_first`, `contact_last`, `specialty`, `city`, `state` (state auto-uppercased). (Mobile already had lead edit.)
- **Import — Medicare is authoritative for claim count**: new `_reconcile_claim_notes` in `routes_import.py` — when an imported row's NPI matches a Medicare record, any note whose label denotes the **total claim count** (contains "claim", excludes cost/avg/per/rate/amount) is overridden to `"<label>: <tot_clms> (from Medicare)"` if it disagrees with the imported value. "Avg per claim"/cost notes are untouched. (Per user: "detect claim from medicare if that is not matching with import in notes, override notes with medicare data.")
- **Assign leads to lead managers + admins**: `GET /api/users` now accepts `roles=` (comma-separated). All assignee pickers — Lead Detail owner dropdown (relabeled "Assigned to (owner)"), Leads bulk-assign, and a NEW Import Wizard **"Assign all to a specific person…"** option (`distribute="person"` + `assignee_id`, MappingInput/PresetInput/execute) — now list account_managers + lead_managers + admins + super_admins. So **Ankit (lead_manager)** and **Pratik (admin)** are selectable everywhere. NOTE: Pratik's role was intentionally LEFT as admin (not switched to lead_manager) — including admins as assignees achieves the goal without removing his admin access.
- Verified: testing agent iteration 19 — backend 5/5 pytest + web e2e across Lead Detail, Leads, Import Wizard, no bugs (report `/app/test_reports/iteration_19.json`). Also curl-verified the import claim-override (555→1943 from Medicare) + person-assign to Ankit, rolled back. Version → **v2.19**.



- **Auto-enrich on capture**: public campaign capture (`POST /api/public/campaigns/{slug}/submit`) now fires a best-effort single-lead PDL enrichment (`enrich_one_lead` in `routes_bulk.py`) when the lead has an email or org — HIGH-confidence only, fill-missing, mirrors found phone/work_email to the dialable top-level fields; silent on failure (never blocks capture).
- **Saved Filters (Leads page, managers)**: Leads filter bar gains **340B tier**, **State**, **Source** dropdowns + a **Clear** button (backend `GET /api/crm/leads` now accepts `state` + `tier`). Managers get a **Saved filters** row — Save current / Load dropdown / one-click chips + delete — persisted via the existing `saved-searches` store with `entity="leads"` (no new schema). Per-user scoped.
- **Queue Progress (Call Lists, reps)**: `GET /api/crm/call-lists` now returns `called`/`total`/`remaining` per list; new `GET /api/crm/call-stats/today` → `{calls_today}` (calls the rep logged today across all leads, from `db.calls` by `by_id` + today ISO). CallLists page shows a **"N called today"** pill (on the index AND inside the active queue), a per-card **progress bar** (X/Y called, %), and a **progress bar** in the active queue that advances on Save & Next.
- **Phone/Email import**: import wizard already maps `phone`/`email` (+ heuristic hints); verified they persist on created leads through analyze→mapping→validate→execute.
- Verified: testing agent iteration 18 — backend 13/13 pytest + web e2e of both pages, no bugs (report `/app/test_reports/iteration_18.json`). Version → **v2.18**. NOTE: PDL enrichment uses real credits — capture auto-enrich is 1 call/lead and fill-missing-only; do NOT bulk-run on the Medicare list (no email/company to match).



- **Bulk Enrich** (`routes_bulk.py`): the existing PDL bulk-enrich is now throttled (0.4s/call), stops early on credit-limit (402 → status `stopped_credit_limit`), mirrors found phone/work_email to the lead's top-level `phone`/`email` (so it's dialable), and accepts a filter (`source`/`mine`/`missing_phone`/`limit`) in addition to explicit `lead_ids`. Leads page fires it on selected rows and polls to a summary toast. NOTE: piloting 15 Data-Scraping leads returned 0 matches — PDL needs company/email, which the Medicare list lacks; do NOT bulk-run it on that dataset.
- **My Call Queue** (`routes_growth.py`): call-list filter now supports `mine` (my assigned leads) + `source`, and results are always sorted by 340B then RPM tier (GREEN→YELLOW→BLUE→RED). CallLists page has a one-tap "My Call Queue" button + a "My assigned leads only" checkbox and an "Any" tier option.
- **Bulk user actions** (`routes_users.py` `POST /users/bulk`): deactivate / activate / delete (with optional `reassign_to` for the deleted reps' leads); excludes self, protects the last admin, audited. Users page has row checkboxes + select-all + a bulk action bar.
- **Import presets** (`routes_import.py` `GET/POST /imports/presets`): save the current mapping + source + year + distribution + rule as a named preset and load it in the wizard.
- Verified: backend curl + testing agent iteration 17 (4/4 web e2e pass, no bugs). Version → **v2.17**.


## v2.16 (2026-06) — Managed lead sources + data-year tag + XLSX import + equal-distribution; 396-lead Medicare import
- **Managed lead sources**: new `lead_sources` collection (lazy-seeded: Booth/Event, Manual Entry, Medicare Search, CSV Import, Referral, Website, Campaign, Other, **Data Scraping**, **Gujarati Physicians Event**). `GET/POST /api/crm/lead-sources`; `/api/crm/meta` now returns the managed list. Source is a dropdown + "+ Add" on the Import wizard and the New Lead form (add-anywhere, appears everywhere).
- **Data-collected year**: `collected_year` on leads; set per-import and on the New Lead form; shown as "Data year" on the lead detail.
- **XLSX header detection**: `_parse` now finds the real header row past title/blank preambles (first row within 20 with ≥3 non-empty cells) and reads data after it, on the first sheet.
- **Equal distribution on import**: import options now include Source, Year, and Assignment = Territory routing (default) OR **Assign equally to all reps (round-robin, account managers only)**. Execute honors import-level `source`/`data_year`/`distribute`.
- **Action — imported the user's Medicare file**: `Providers_Over5M_PerClaim7000_by_Geography.xlsx` → **396 leads**, source Data Scraping, year 2026, all matched to Medicare data (340B/RPM tiers, specialty, city, state), 5 metric columns saved as notes, **distributed equally 132/132/132** across the 3 account managers (April, Asiya, Account Manager).
- **Phone/email limitation**: the file and the Medicare dataset contain NO phone/email, and the free NPI (NPPES) registry is DNS-blocked from this environment. Contact info can be filled via the per-lead **Enrich** (PeopleDataLabs) action; bulk PDL enrichment not auto-run (credits + rate limits) — pending user go-ahead.
- Version → **v2.16**. Self-verified via the real import + UI screenshots (not run through the testing agent).


## v2.15 (2026-06) — Deactivate (soft-disable) UX + Sam PIN rotation
- **Deactivate vs Delete**: login already rejects `active:false` accounts with 403 "Account is deactivated" (verified). Added a clear **Deactivate / Activate** button per user row (confirm on deactivate) and an **Inactive** status badge (rows dim when inactive); removed the ambiguous Active checkbox. Deactivating blocks sign-in but keeps all leads/history, and is captured in the audit trail (update → changed:["active"]). Verified: user could log in, then got 403 after deactivate.
- **Sam PIN rotated** to **8677** via env `SUPER_ADMIN_PIN` (old 729164 now rejected; new PIN works; still super_admin, no forced change). Takes effect in production after re-Publish.
- Version → **v2.15**.


## v2.14 (2026-06) — Baked-in super admin + reassign-on-delete + user audit trail
- **Permanent built-in super admin**: `server.py` seed now creates/repairs `sam@healthandmore.net` as **super_admin** on every startup from env (`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PIN=729164` / `SUPER_ADMIN_NAME`), idempotent via the shared `_seed_user` (extended with `enforce_role`), and clears `must_change_pin` so the env PIN is a stable credential (no forced change; reverts to env PIN on restart). This exists in EVERY deploy incl. production. (admin seeding — ran integration_expert first.)
- **Reassign on delete**: `DELETE /api/users/{id}?reassign_to=<uid>` moves the deleted rep's leads (all owned) + open opportunities to the target rep (leads get `routing_reason` "Reassigned from <name> (account removed)"). New `GET /api/users/{id}/workload` → `{leads, open_opps}`. Frontend: delete now checks workload and, if non-zero, opens a "Reassign & Delete" modal to pick the target rep before deleting.
- **User audit trail**: every admin user action (created / updated / invited / pin_reset / deleted) is logged to `user_audit` via `_audit()`. New `GET /api/users/audit` (admin) + an "Audit trail" modal on the Users page listing recent entries (action, target, actor, time, changed fields / leads reassigned).
- Verified via curl (Sam super_admin login w/ 729164; workload=2; delete reassigned 2 leads; audit logged created+deleted) + UI screenshot (audit modal, Super Admin role). Version → **v2.14**. NOTE: `SUPER_ADMIN_PIN=729164` is the chosen baked-in PIN — change it in backend/.env to rotate; takes effect in production after a re-Publish.


## v2.13 (2026-06) — Admin user management: edit attributes + delete
- Admins/super_admins can now **edit** any user's **name, email, phone, title, role** and **delete** users from `/crm/users`. Backend: `routes_users.py` — `PATCH /api/users/{id}` extended with `email` (lowercased + uniqueness check) and `phone`; new `DELETE /api/users/{id}` with guards (cannot delete your own account; cannot delete the last remaining admin/super_admin). `create_user` and `_public` now carry `phone`. Frontend `Users.js`: added a Phone column, per-row **Edit** (modal: name/title/email/phone/role) and **Delete** (confirm) buttons.
- Verified via curl (email lowercased, phone set, duplicate-email guard, delete, self-delete guard) + UI screenshot. Version → **v2.13**.
- NOTE — production accounts: preview and prod are SEPARATE DBs; first deploy provisions a fresh prod DB (no preview data copied). The app's startup seed (`server.py _seed_user`, from env vars) always creates/repairs these in every env: admin@boothiq.com/482913 (admin), leadmanager@boothiq.com/639201, accountmanager@boothiq.com/528174, staff@boothiq.com/715264. Team accounts (healthandmore.net etc.) exist only where created in-app; create them in production via /crm/users after logging in as admin@boothiq.com.


## v2.12 (2026-06) — Rebalance + distribution history + AM filter; Browser Calling (gated OFF)
- **Rebalance ("Even out")**: `POST /api/crm/routing/rebalance` (lead_manager) moves surplus **unworked** leads (status New, not converted, created this month) from the busiest account manager to the quietest until this-month spread ≤ 1. Bounded/idempotent (returns `{ok, moved}`); rebalanced leads get `routing_reason` "Rebalanced — moved from <name> to even out load". "Even out" button on the Teams distribution panel.
- **Distribution history**: `GET /api/crm/routing/balance` now returns per-rep `prev` (last month) alongside `leads` (this month) + `prev_total`; the Teams panel shows this-month (primary) vs last-month (gray) bars.
- **AM-only filter**: balance endpoint takes `scope=am` (account managers only, default) | `scope=all` (adds lead managers, "Mgr" badge). Reps/All-owners toggle on the panel.
- **Browser Calling (Twilio Voice) — BUILT BUT GATED OFF**: `routes_voice.py` — `GET /api/voice/config`, `GET /api/voice/token` (mints Twilio AccessToken with VoiceGrant), `POST /api/voice/twiml` (resolves lead phone server-side, dials from caller-ID), `POST /api/voice/status` (`<Dial action>` callback → auto-logs the call to the lead timeline, idempotent by CallSid). Web `Softphone.js` (Call/Mute/Hang-up) sits in the LeadDetail Call modal. Env stored: `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`. **Still OFF** until the user sets `TWILIO_TWIML_APP_SID` + `TWILIO_VOICE_FROM_NUMBER` and points the TwiML App Voice URL to `<public>/api/voice/twiml`; until then `/voice/config` returns `enabled:false` and the UI shows "Browser calling isn't configured yet." NOT verifiable end-to-end in preview. TODO when enabled: add `X-Twilio-Signature` validation on the two webhooks.
- Verified: testing agent iterations 15 & 16 (8/8 + 13/13 pytest + web e2e, no bugs). Version → **v2.12**.


## v2.11 (2026-06) — Routing fallback logic + bulk-import notes mapping
- **Territory routing** (unchanged, verified): a lead matching a Territory by **state** and/or **specialty** round-robins across that team's members (`auto_route_lead`, `routes_teams.py`).
- **New fallback when NO territory matches** (`source_kind` param on `auto_route_lead`): **manual** leads (created via `POST /api/crm/leads`) are assigned to their **creator**; **bulk-imported / manager-triggered** leads (import execute, `/leads/{id}/route`, `/leads/route-unassigned`) auto-route via **round-robin across all account managers** (falls back to the default team's members if no account managers exist, using a shared `rr_bulk_fallback` counter).
- **Bulk import → notes mapping**: Import Wizard now offers **`notes`** as a mappable target. Any number of unmatched CSV columns can be pointed at `notes`; each becomes a note entry on the imported lead formatted `Column: value` (`_project` aggregates into `_notes`; `execute` builds proper note objects). AI auto-mapping intentionally excludes `notes` (kept user-driven). Import execute now also auto-routes each created lead (bulk fallback).
- Verified: testing agent iteration 14 — 7/7 backend pytest + web e2e of the import wizard (notes option present, tip text, two columns → two notes, routing on execute). Version → **v2.11**.
- **v2.11 UX follow-ups (iteration 15, 8/8 pytest + web e2e, no bugs)**: (1) **Notes Preview** — `/imports/{id}/validate` now returns `notes_columns` + a per-row `notes` count; the Review step shows a "N columns → notes" banner and a Notes column. (2) **Routing Trace** — every routed/assigned lead stores `routing_reason` + `routed_at` (territory match / creator fallback / round-robin / "Manually assigned by <name>"); shown on LeadDetail under Ownership. (3) **Round-Robin Balance** — new `GET /api/crm/routing/balance` + "Lead Distribution (this month)" panel on the Teams page showing each rep's share of this month's new leads and the spread between busiest/quietest.

## v2.7.1 (2026-08) — Deployment fix: non-blocking startup + health endpoints
- **Root cause of failed prod deploy**: `@app.on_event("startup")` awaited ~30 `create_index` calls + data migrations + `tiers.recompute_tiers` + seeds INLINE. Uvicorn doesn't accept connections until startup returns, so against remote Atlas readiness blocked (or slow/failed server-selection hung ~30s then crashed → CrashLoop). nginx readiness probe `GET /health` → `127.0.0.1:8001/health` got `connection refused`; pod never became ready → deploy timed out.
- **Fix (server.py, code-only)**: (1) Added `GET /health` and `GET /api/health` → `{"status":"ok"}` with NO DB access so the probe returns 200 immediately. (2) `startup()` now only `asyncio.create_task(_initialize())` and returns instantly; all index/migration/seed/worker/storage init moved to `_run_init()` wrapped by `_initialize()` in try/except (a slow/failed Atlas op logs an error but never crashes the process or blocks serving).
- Verified: uvicorn logs "Application startup complete." immediately; /health & /api/health → 200; login works (background seed completes shortly after). deployment_agent: backend PASS (only a non-applicable WARN about the preview-only Expo service on port 3001, intentionally left as the standard protected layout).

## v2.10 (2026-08) — Quota attainment on Forecast + per-state territory routing
- **Quota Attainment panel** (Forecast page): new section shows each rep's month-to-date **Leads / Meetings / Opps / Revenue vs target** as color-coded progress bars, with an inline "Edit targets" editor (PUT /api/crm/quotas). `quota_attainment` now includes **lead_managers** too (so Ankit shows) and counts leads month-to-date (was all-time).
- **Per-state territory routing**: replaced the single national round-robin with **per-rep regional teams + territories** — West (April: 13 states), Central & South (Asiya: 20), East & Northeast (Ankit: 18). Each territory → a single-member team, so a lead auto-routes to the rep who owns that state. Verified: CA→April, TX→Asiya, NY/FL/GA→Ankit, WA→April.
- **Quotas set** for April, Asiya, Ankit: 40 leads / 12 meetings / 6 opps / $50k per month (adjustable via the Forecast editor). NOTE: teams/territories/quotas live in the PREVIEW DB — re-create in production Atlas after Publish.
- Self-tested via curl (state routing + attainment) and screenshot (quota panel). Version → **v2.10**.

## v2.9 (2026-08) — Auto-routing on lead creation + team setup + super_admin CRM access
- **New leads auto-route**: `create_lead` (POST /api/crm/leads) now calls `auto_route_lead` when no `account_manager_id` is supplied — brand-new leads round-robin across the matching team. (Previously only campaign-capture leads routed.)
- **super_admin CRM access fix**: `deps.require_roles` now always allows `super_admin` (in addition to `admin`) — without this the super_admin was 403'd on every CRM/manager route.
- **Team config (preview DB)**: Ankit → lead_manager. Team "Field Sales" (members April, Asiya, Ankit; lead Ankit) + territory "National" (all 51 states/DC). Verified round-robin: April→Asiya→Ankit→April. NOTE: this data lives in the PREVIEW Mongo — production Atlas is a separate DB, so the 6 accounts + team/territory must be re-created in production after Publish.
- Self-tested via curl (round-robin routing, super_admin 200 on ANY_CRM + MANAGER routes). Version → **v2.9**.

## v2.8 (2026-08) — Super Admin role, self-service forgot-PIN, code-or-password
- **super_admin role**: added to crm_common (ALL_ROLES/ROLE_LABELS "Super Admin", ADMIN_ROLES tuple). `deps.require_admin` now accepts admin OR super_admin (covers every admin route in one change). Frontend gates updated to treat super_admin as admin: ProtectedRoute adminOnly, App.js CRM_ROLES + manager route arrays, CrmShell nav, Launcher (normalizes super_admin→admin), Dashboard, Leads/LeadDetail/Sequences manager checks.
- **Forgot PIN / password (self-service)**: public POST /api/auth/forgot-pin {email} — always returns the same generic 200 (no account enumeration), rate-limited 3/15min/email via `pin_reset_attempts`; on a real account it rotates to a temp PIN, sets must_change_pin, and emails it (Resend). Web: "Forgot PIN or password?" link + reset modal on Login. Mobile: /forgot-pin screen. `routes_users._send_reset` email template.
- **Code OR password credentials**: `deps.credential_ok(s)` accepts a numeric CODE (4-8 digits) OR a PASSWORD (>=8 chars with letters+numbers). Wired into /api/auth/change-pin, POST /api/users (admin-supplied pin), POST /api/users/{id}/reset-pin. Login field relabeled "PIN or Password" (no numeric-only) on web + mobile; change-pin screens accept either with a policy hint.
- **Users created (healthandmore.net)**: sam+pratik=admin, admin@=super_admin, ankit+april+asiya=account_manager — all emailed invites, forced first-login change. See test_credentials.md.
- Testing iteration 13: backend 14/14 pass; web + mobile flows verified (super_admin access, forgot-pin generic+rotate+rate-limit, credential accept/reject, change-pin). Version → **v2.8**.

## v2.7 (2026-08) — Home Page: feature showcase + imagery
- Enhanced the authenticated home (`Launcher.js`): SaaS hero with a physician image + floating "Real-time Medicare Part D scoring" badge; both workspace cards (Events / CRM) now have photographic banners (conference hall / analytics dashboard); new **"Everything BoothIQ does"** 8-tile feature grid (Medicare scoring, prize-wheel capture, AI Copilot, enrichment, multi-channel outreach, campaigns, teams & forecasting, mobile rep app). Images are Unsplash URLs (no base64/blobs). Self-tested via screenshots. Version → **v2.7**.

## v2.6 (2026-08) — Event Self-Registration QR Posters
- **Booth walk-up self-registration**: new public page `SelfRegister.js` at route `/e/:eventId` (unauthenticated, mobile-first). A physician scans the event QR poster and self-registers from their own phone; the submission reuses the existing public kiosk endpoints (`GET /api/kiosk/config`, `POST /api/kiosk/leads`) so the lead flows into the SAME booth pipeline (physician matching, 340B/RPM scoring, staff SMS alerts, dashboard push) and can spin the prize wheel (`/wheel/{leadId}`) on success.
- **QR posters on Events**: `EventsHome.js` shows a "QR Poster" action per event; reusable `components/QrPoster.js` (`QrPosterModal`) renders the QR of `/e/{eventId}` with Download PNG + Print Poster ("Scan to check in & spin the wheel").
- Self-tested: curl (self-reg creates a booth lead, spin_available) + screenshots (public form + QR modal). No backend changes. Version → **v2.6**.

## v2.5 (2026-08) — Home Redesign, Team Invites (temp PIN), Campaign QR, Push Alerts
- **Home page redesign (web `Launcher.js`)**: Salesforce-style authenticated home / workspace selector — hero + product positioning, two large workspace cards (**BoothIQ Events** vs **BoothIQ CRM**), role-based CRM quick actions (§66), remembered/last-used workspace with a "Continue to X" CTA, and an Events→Intelligence→CRM→Outreach→Opportunities workflow visual. Post-login routing changed: admin/lead_manager/account_manager → `/home`; staff → `/dashboard`; users with a temporary PIN → `/change-pin`. Top-bar sign-out.
- **Team accounts + temporary PIN (auth extension, NOT a rewrite)**: `POST /api/users` now auto-generates a secure 6-digit temp PIN when none is supplied, sets `must_change_pin`, and emails an invite via Resend (`_send_invite`). `POST /api/users/{id}/invite` re-sends/regenerates. `POST /api/auth/change-pin` forces a change on first login (no current-PIN needed when `must_change_pin`; otherwise verifies current). Login + `/auth/me` expose `must_change_pin`. Web `/change-pin` page + admin Users page "Auto-generate & email invite" flow, invite-result dialog (shows temp PIN), per-row Invite/resend + "Invite pending" badge. Mobile also enforces `/change-pin`.
- **Campaign QR posters (web)**: each campaign detail has a **QR Poster** action (`qrcode.react`) — renders a QR of the public `/c/{slug}` capture link with Download PNG + Print Poster ("Scan to connect").
- **Push alerts (mobile, Emergent managed relay)**: `routes_push.py` — `POST /api/register-push` + `send_push()` helper; `notify_lead_assigned` fired (non-blocking) from `auto_route_lead` and lead `assign`. Mobile: `expo-notifications`/`expo-device`, handlers + Android channel + tap/cold-start + denied nudge in `app/_layout.tsx`, `registerForPush` after login, `expo-notifications` plugin + `android.googleServicesFile` in `app.json`. `EMERGENT_PUSH_KEY=placeholder` in backend `.env` (deploy pipeline swaps it). **Requires the user to provide `google-services.json` and to Publish → generate a native build; cannot run in Expo Go / web preview.**
- Testing iteration 12: backend 11/11 pass; web + mobile flows verified (temp-PIN → forced change → home; home redesign; QR poster). Version → **v2.5**.
- **NOTE**: register-push returns 500 in preview (placeholder key) — expected; works post-deploy. Browser Calling (Wave 4) + Mailbox OAuth (Wave 5) still blocked pending credentials.


- **Wave 15 — Marketing Campaigns (web + backend, `routes_campaigns.py`)**: campaign entity (name, channel, status Draft/Active/Paused/Completed, budget, goal_leads, UTM). Each campaign owns a **public shareable capture form** (`capture.slug`, headline/subhead/fields/interest-chips/thank-you/require_email). Endpoints under `/api/crm/campaigns` (lead_manager/admin only; account_manager 403) for CRUD + per-campaign performance stats (captured, converted, conversion_rate, pipeline_value, won_value). **Public un-authenticated** endpoints `/api/public/campaigns/{slug}` (GET config) and `/api/public/campaigns/{slug}/submit` (POST → creates a CRM lead with **source attribution**: source='Campaign', source_details+campaign_id+campaign_name, interests→tags; auto-routes via territories/teams + fires automation `lead_created`). Guards: 400 missing required email, 409 when Paused/Completed, 404 unknown slug. Web: `/crm/campaigns` page (cards + create modal + detail modal with copy-link + status chips + recent leads); public form page at route `/c/:slug`. Added "Campaign" to LEAD_SOURCES. Nav "Campaigns" (admin + lead_manager).
- **Wave 12 — Mobile Rep Companion (Expo, `/app/mobile`)**: expo-router file-based routing. Screens: `login` (email+PIN, token in secure-store), `(tabs)` bottom-nav [My Day / Leads / Profile], `lead/[id]` detail, `lead/new` create. My Day = `/api/crm/home/my-day` + `/attention` (stat cards, meetings, tasks, new leads, followups). Leads = list + debounced search + FAB create. Lead detail full actions: tap-to-call (tel:), send SMS (`/leads/{id}/text`), log call w/ disposition (`/leads/{id}/call`), add note, change status chips, **edit** (org/email/phone/priority/value PATCH). Shared brand theme (`src/theme.ts`), fetch-based API client (`src/lib/api.ts`), `src/contexts/auth.tsx`.
- Testing iteration 11: backend 17/17 pass; web + mobile flows verified. Fixed nested-button HTML in Campaigns.js. Version → v2.4.
- **KNOWN (parked)**: mobile/web SMS send hits Twilio but delivery depends on the user's A2P 10DLC registration (unchanged from prior waves). Twilio **Voice** (Wave 4), Mailbox OAuth (Wave 5), CRM Sync (Wave 11, skipped by user) remain blocked/parked.


## Architecture
- **Backend**: FastAPI + MongoDB (`/app/backend`). Modular: `deps.py` (db/ws/auth/twilio), `scoring.py`, `matching.py`, `routes_auth/admin/kiosk/dashboard.py`, `server.py`.
- **Web frontend**: React CRA + Tailwind + shadcn (`/app/frontend`). Routes: `/` launcher, `/login`, `/kiosk`, `/wheel/:id`, `/dashboard`, `/admin`. PWA (manifest + service worker) for offline kiosk.
- **Auth**: email + PIN, role-based (admin/staff), Bearer JWT in localStorage. Kiosk = no login, device-registered.
- **Live updates**: WebSocket `/api/ws/dashboard` and `/api/ws/admin:{sid}`.

## User Personas
- **Admin**: uploads CMS data, calibrates scoring, configures prizes and SMS rules, manages roster.
- **Booth staff / rep**: watches the live dashboard, gets SMS on green leads, works leads.
- **Doctor (visitor)**: fills the kiosk form, spins the wheel — never sees any scoring.

## Core Requirements (static)
1. CSV ingestion sessions with chunked resumable upload + streaming aggregation across file boundaries; coverage report + truncation warnings; finalize + zero-downtime go-live.
2. Two independent scores: 340B (6 editable thresholds, top-down) and RPM (volume + 1.25x chronic-care multiplier).
3. Identity matching: NPI Luhn checksum, name resolution with collision count → confirmed/probable/unresolved; unresolved = GREY (never RED).
4. iPad kiosk: 3-screen form, no score exposure, offline queue, wake lock, PWA.
5. Full-screen weighted prize wheel: outcome resolved server-side before animation, one-spin enforcement, WebAudio tick+chime, inventory auto-drop.
6. Twilio SMS alert engine: per-tier rules, roster with on-duty, dedup + rate-limit + digest fallback, delivery logging.
7. Staff dashboard: live feed, dual tier bands, GREY distinct-in-kind, filters/sort, counters, CSV/XLSX export.

## Implemented (2026-06 — first MVP)
- All 7 parts implemented at a functional end-to-end level on the web surface. 34/34 backend tests pass; web e2e verified.
- Twilio wired with real credentials (server-side send + logging). Synthetic sample dataset generator for instant demo.
- **MOCKED/LIMITATION**: real SMS delivery depends on Twilio account (trial accounts only deliver to verified numbers); alert logs are always written. Offline kiosk scoring is simplified — offline leads are queued and scored on sync (not scored from a fully cached 25M-row lookup).

## Backlog / Remaining
- **P1**: Native mobile staff-dashboard companion app (Expo) — requested, not yet built.
- **P1**: Column-mapping confirmation UI before processing (backend preview endpoint exists; wire the admin screen).
- **P2**: HTTP 409 for already_spun; kiosk endpoint rate limiting; strict chunk-order enforcement; CRM push field-mapping UI.
- **P2**: Multi-event switcher across dashboard/admin; digest delivery of held alerts.

## Next Tasks
1. Build the Expo mobile staff dashboard (live feed + alerts + sync status) against the shared backend.
2. Add the column-mapping confirmation step in the ingestion UI.
3. Post-MVP hardening from test report `critical_code_review_comments`.

## v2.3 (2026-06) — Wave 9 (Territories & Teams) + Wave 10 (Forecasting)
- **Teams & Territories** (`routes_teams.py`, `/crm/teams`, manager): create teams (lead manager + AM members), territories (states/specialties → team), **round-robin lead routing** (`auto_route_lead` picks the next team member by rotating cursor), route-one + route-unassigned endpoints, and a new automation action `route_lead` (e.g. "when lead_created → route_lead"). **Quotas** per rep (leads/meetings/opps/revenue) with month-to-date attainment bars.
- **Sales Forecast** (`routes_forecast.py`, `/crm/forecast`, manager): open pipeline value, probability-weighted forecast (Discovery 10% → Negotiation 75%), win rate (won/(won+lost)), avg deal, won revenue, pipeline-by-stage funnel, and by-account-manager breakdown.
- Verified via curl (routed 7 leads, quota attainment, forecast math) + UI screenshots. Version → v2.3.

## v2.2 (2026-06) — Wave 8: Autonomous AI Agent
- **AI Agent** (`routes_agent.py`, Emergent universal key): on any lead, **AI Agent** generates a human-in-the-loop action plan — summary, reasoning, 3-4 prioritized `next_actions` (status/task/email/sms), and draft email + SMS. `POST /api/crm/leads/{id}/agent/plan`. The rep approves exactly which actions run; `POST .../agent/execute` applies only approved items (create task, change status, send email via Resend, send SMS via Twilio — all consent-checked) and logs each as an AI-labeled activity. Nothing sends without explicit approval.
- Verified via curl + UI screenshot. Version → v2.2.

## REMAINING WAVES (9–15) — sequencing & prerequisites
- **Wave 9 — Territories & Team Management** (no keys): teams, quotas, round-robin lead routing, hierarchy. Next up.
- **Wave 10 — Forecasting & Custom Dashboards** (no keys): pipeline/revenue forecast, cohort analysis, scheduled report emails.
- **Wave 11 — External Sync & Public API** (NEEDS creds): Salesforce/HubSpot two-way sync, calendar sync, webhooks/API keys, Zapier.
- **Wave 12 — Mobile app (Expo)** (new client surface under /app/mobile): rep companion — leads, My Day, call/text/log, sequences.
- **Wave 13 — Compliance & Governance** (SSO NEEDS creds): audit-log UI, consent center, data retention, permission matrix, SSO/SAML.
- **Wave 14 — Documents & Proposals** (e-sign provider likely needed): proposal generation, e-sign, collateral library.
- **Wave 15 — Campaigns & Marketing**: event campaigns, landing/capture forms, attribution.

## v2.1 (2026-06) — Wave 6 (Automation + Call Lists) & Wave 7 (Data Explorer, Completeness)
- **Automation Rules** (`automation.py`, `/crm/automation`, manager): WHEN [event] IF [conditions] THEN [actions]. Events: lead_created, status_changed, lead_assigned, medicare_matched, opportunity_created, meeting_completed. Actions: create_task, schedule_followup, change_status, add_tag, start_sequence, notify_manager. Default-safe (task/draft over sending). Hooked into lead create + status change. Verified: "status→Qualified" auto-enrolls a sequence + creates a task.
- **Smart Call Lists** (`/crm/call-lists`): build a queue from a tier/state/status filter; focused Call Queue UI (Hot/Warm badge, tiers, phone, disposition + notes) with **Save & Next / Skip** auto-advance; each disposition logs a call to the timeline.
- **Data Explorer** (`/crm/explorer`, manager): drill by state / specialty / 340B tier / min $-per-claim over the full Medicare universe (1.14M), with top-state & top-specialty facets, in-CRM vs not-in-CRM counts, and one-click **Create Call List** / Open in Medicare Search.
- **Data Completeness + Relationships**: per-lead completeness score (NPI, specialty, practice, phone, email, Medicare match, website, LinkedIn, location) with a colored badge + checklist, plus a compact relationship chain (specialty → practice → Medicare → opportunity → account manager) on the lead record.
- Verified via curl + UI screenshots. Version → v2.1. Full standalone Relationship-Map graph page + record-freshness timestamps remain as Wave 7 polish.

## PARKED / BACKLOG (per user)
- **Wave 4 — Browser Calling** (Twilio Voice softphone/conference/recording) — needs Twilio Voice API Key SID+Secret, TwiML App SID, voice number.
- **Wave 5 — Mailbox OAuth** (Gmail/Outlook) — needs Google/Microsoft OAuth creds.
- **Wave 8 — Autonomous AI Agent** — build after remaining backlog.
- Future: Wave 9 Territories/Teams · Wave 10 Forecasting/Dashboards · Wave 11 External Sync & API · Wave 12 Mobile (Expo) · Wave 13 Compliance/SSO · Wave 14 Documents/Proposals · Wave 15 Campaigns.

## v2.0 (2026-06) — Expansion Wave 3: Practice Enrich + Comms Inbox + Analytics
- **Practice/Company Enrich** (PDL company API): lead action **Enrich Practice** → preview (name, website, LinkedIn company page, industry, size, employee count, founded, location) with accept-selected + provenance into `lead.practice`. `POST /api/crm/leads/{id}/enrich-company` (+ `/accept`).
- **Unified Communications Inbox** (`/crm/communications`, `GET /api/crm/communications`): one feed of emails + SMS + calls with channel/direction, contact, lead status, "Needs response", role-scoped (AM sees own), tabs + counts; click → lead.
- **Communication Analytics** (`/crm/analytics`, `GET /api/crm/analytics/communications`, manager-only): emails/SMS sent+received, calls + connection rate, call dispositions, meetings booked, opportunities, won, funnel ratios; 7/30/90-day range.
- Verified via curl + UI screenshots. Version → v2.0.

## FUTURE PHASES (backlog, prioritized)
- **Wave 4 — Browser Calling** (Twilio Voice): softphone + conference + incoming match + recording/transcription. BLOCKED: needs Twilio Voice API Key SID+Secret, TwiML App SID, voice-capable number.
- **Wave 5 — Mailbox OAuth** (Gmail / Microsoft 365 send+receive from rep's inbox). BLOCKED: needs Google/Microsoft OAuth app credentials.
- **Wave 6 — Automation Rules** (WHEN/IF/THEN engine + admin builder), **Smart Call Lists** (calling queues with disposition auto-advance).
- **Wave 7 — Intelligence**: Account Relationship Map, Data Explorer (visual DB navigation), data completeness & record-freshness scoring.
- **Wave 8 — Autonomous AI Agent (recorded per user request)**: evolve the AI Copilot into an agent that proactively researches physicians/practices, drafts multichannel outreach, recommends and (with human approval) executes next actions, and drives sequences/automation — always with clear AI labeling and human-in-the-loop approval. To be built AFTER the current backlog (Waves 4–7) is complete.

## v1.9 (2026-06) — Expansion Wave 2: Two-Way SMS + Bulk Enrich + Sequences
- **Two-Way SMS (live, Twilio)**: `/api/crm/leads/{id}/text` sends real SMS via the existing Twilio account (respects Do Not Text / opt-out), logs to timeline. Inbound webhook `POST /api/crm/twilio/sms-inbound` matches phone→lead, logs replies, honors STOP/START opt-out, and auto-pauses active sequence enrollments on a real reply. Messaging provider slot now reports configured. NOTE: set the Twilio number's inbound SMS webhook to `{APP_URL}/api/crm/twilio/sms-inbound`; outbound delivery still gated by A2P 10DLC (account-side).
- **Bulk Enrich (PDL background job)**: `/api/crm/enrichment/bulk` enriches many selected leads in the background, **fill-missing-only** with provenance (HIGH-confidence only), never overwrites; `GET /api/crm/enrichment/{job_id}` for progress. Leads page: multi-select → **Bulk Enrich**.
- **Sequences**: `routes_sequences.py` — create multi-step cadences (email / SMS / call task / task / wait with day offsets), enroll leads, pause/resume/cancel. A background worker advances due steps every 60s and executes each channel (email via Resend, SMS via Twilio w/ consent checks, tasks created). **Auto-pauses on physician reply** (inbound SMS). UI: `/crm/sequences` builder + enroll from Leads bulk toolbar.
- Verified via curl (SMS queued by Twilio, inbound webhook, bulk job, sequence enroll+advance) and UI screenshots. Version → v1.9.
- **Deferred — Browser Calling** (softphone + conference + recording): needs Twilio **Voice** credentials (API Key SID+Secret, TwiML App SID, voice-capable number).

## v1.8 (2026-06) — Expansion Wave 1: AI Copilot + Bulk Import
- **AI Copilot** (Emergent universal key, `ai.py` + `routes_ai.py`): on any lead — **AI Draft Email**, **AI Draft Text**, **AI Prep Call** (overview/talking points/questions/objections), **AI Research** brief (KNOWN vs AI-interpretation), and next-action suggestion. Uses privacy-safe internal CRM context (org, specialty, geography, Medicare tiers/figures, enrichment, recent activity). Every use logged to timeline.
- **Bulk Import wizard** (`routes_import.py`, `/crm/import`): drag-and-drop CSV/TSV/XLSX/JSON → auto-parse → **AI-assisted column mapping** (with heuristic fallback) → **validate** (classify New / Existing[NPI or email] / Duplicate-in-file / Review) → **execute** (create leads, auto Medicare match by NPI, rule: Safe vs Refresh) → **rollback** (deletes created records + their activities). Rows staged in `import_jobs`; nothing written to production collections until execute; every execute is rollback-safe. Nav "Data Import" for admin + lead_manager.
- Verified via curl (all import steps + AI endpoints returning real output) and UI screenshots. New deps: openpyxl. Version → v1.8.
- **Wave 2 (next, Twilio)**: Two-Way SMS (outbound send + inbound replies to timeline) on the existing Twilio account; Browser Calling softphone + conference + auto-logging (needs Twilio Voice creds: API Key SID+Secret, TwiML App SID, a voice-capable number).

## v1.7 (2026-06) — Platform Expansion Phase 1 + Enrichment + Email
- **Home redesign**: authenticated home is now a role-based **workspace selector** (BoothIQ Events vs BoothIQ CRM) with remembered last-workspace, positioning copy, and a workflow strip. `/home`, `/events` (Events command center) added.
- **CRM shell**: top-left **workspace switcher**, **global search** (`/api/crm/search` across leads/opps/physicians), global **+Create**. Nav gains Providers (admin).
- **CRM Home command center**: greeting + **Needs your attention** cards + **My Day** queue + dynamic **Opportunities BoothIQ Found** insights (`/api/crm/home/attention|my-day|insights`).
- **Sales workspace** on every lead: first-class action bar `[Email][Call][Text][Schedule][✨Enrich]`, **win-probability** color badge (Hot/Warm/Cool/Cold from 340B+RPM), **communication consent/preferences** (Do Not Call/Text, email suppression, SMS consent, preferred method), and a **unified activity timeline** (crm_activities merged with embedded activity).
- **One-click Enrichment (People Data Labs, live)**: `/api/crm/leads/{id}/enrich` + `/enrich/accept` — side-by-side preview, accept-selected, **data provenance** (source/confidence/retrieved/accepted-by), never auto-overwrites. Physician workspace at `/crm/physicians/{npi}`.
- **Email (Resend, live)**: `/api/crm/leads/{id}/email` sends real email, logs to timeline, respects suppression. **Call** logging + disposition + follow-up task. **Text** records message (Twilio two-way send deferred to Phase 4 — returns queued_not_configured).
- **Provider abstraction** (`providers.py`) + admin **Providers** page (`/crm/providers`, `/api/admin/providers`): enable/disable/auto per vendor slot; live `configured` flags. Foundation: consent model, provenance, unified timeline.
- New env: `RESEND_API_KEY`, `RESEND_FROM`, `PDL_API_KEY`. New backend: `routes_crm_engage.py`, `providers.py`, `enrichment.py`, `emailer.py`. Verified: 19/19 backend + web e2e (iteration 10), kiosk privacy intact. Version → v1.7.
- **Remaining phases (planned)**: Bulk Import wizard; deeper Enrichment (company/LinkedIn discovery, bulk); Communications (Gmail/Outlook OAuth, two-way SMS, browser calling/conference/recording, unified inbox); AI copilot + sequences + automation + smart call lists; Intelligence (relationship map, data explorer, analytics).

## v1.6 (2026-06) — CRM layer (Lead Manager & Account Manager)
- **New roles**: `lead_manager`, `account_manager` (+ admin user management at `/crm/users`; `require_roles` dependency). Demo logins seeded.
- **CRM leads**: lifecycle statuses + immutable status-history, priority, dual ownership (Lead Mgr + Account Mgr), notes, combined activity timeline, Medicare snapshot (tiers + figures) captured on match/convert.
- **Medicare Search**: simple + advanced AND/OR filter builder, multi-year (`dataset_year`), results table with 340B/RPM tiers + CRM status, create-lead-from-result + bulk create, saved searches, year-comparison. Existing dataset migrated to dataset_year 2024; tiers denormalized onto physicians (recomputed at finalize / threshold-change).
- **Assignment & conversion**: assign / bulk-assign to Account Manager (manager-only), convert lead → Opportunity.
- **Opportunities** pipeline (stages + stage history, auto won/lost), **Tasks** (my/team/overdue/upcoming), **Meetings** (schedule/reschedule/cancel/complete, next-step task, downloadable `.ics`, Twilio SMS reminder). Email invite + Google Calendar hooks reserved (activate when keys set).
- **Accounts + physician contacts** with duplicate detection. **Role dashboards/reports** for Lead Manager & Account Manager.
- New backend files: `routes_crm.py`, `routes_crm_meetings.py`, `routes_medicare.py`, `routes_users.py`, `crm_common.py`, `tiers.py`, `notifications.py`. New frontend: `components/crm/*` + `pages/crm/*`. Verified: 42/42 backend + 9/9 web e2e (iteration 9). Version → v1.6.

## v1.5 (2026-06) — Deployment fix
- Chunked CSV upload staging moved off pod-local `/tmp` to **Emergent object storage** (`backend/storage.py`). Each 4MB chunk is stored as its own part object and stream-read back in order during aggregation — bounded memory, correct on multi-pod deployments. Verified single + multi-chunk boundary stitching (300/300 rows, exact claim sums), CSV quoting preserved. Version badge bumped to v1.5.

