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
