# BoothIQ — Product Requirements Document

## Original Problem Statement
Convention booth lead-capture system for a healthcare services company. Runs on an iPad at a trade show: scores each physician lead in real time against uploaded CMS Medicare Part D prescribing data, launches a full-screen prize wheel, and texts the sales team when a high-value lead walks up. Three separate surfaces with separate auth: admin console, doctor kiosk, staff dashboard. ABSOLUTE RULE: the kiosk never shows a score, dollar figure, or Medicare data.

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

