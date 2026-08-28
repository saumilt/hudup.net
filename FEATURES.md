# BoothIQ — Complete Feature & Architecture Specification (v1.5)

> Convention booth lead-capture system for a healthcare services company. Runs on an iPad kiosk at trade shows: captures physician leads, scores them in real time against uploaded CMS Medicare Part D data, launches a full-screen prize wheel, and texts sales staff when a high-value lead is captured. Web app deployed at production `https://hudlup.net`.

## 1. Tech Stack & Architecture
- **Frontend:** React (Create React App) + Tailwind CSS + shadcn/ui, React Router. Installable PWA (service worker) for offline kiosk use.
- **Backend:** FastAPI (Python), all routes prefixed `/api`.
- **Database:** MongoDB (Motor async driver). String UUID ids; `_id` excluded from responses.
- **Realtime:** WebSocket (`/api/ws/{room}`) for live dashboard leads + ingestion progress; polling fallback.
- **Integrations:** Twilio SMS (server-side only). Twilio creds in backend `.env`.
- **Auth:** Email + numeric PIN, role-based (admin/staff), JWT bearer token in localStorage.
- **Version stamp:** `APP_VERSION` in `/app/frontend/src/version.js`, shown top-right on every screen (currently v1.5).
- **Object storage:** Emergent object storage (`backend/storage.py`) used to stage chunked CSV uploads off the app pod so ingestion works on multi-pod deployments.

### Routes (frontend)
- `/` Launcher (choose surface; kiosk event selector)
- `/login` email + PIN
- `/kiosk` doctor-facing capture (no login; device-registered)
- `/wheel/:leadId` full-screen prize wheel
- `/dashboard` staff live lead feed
- `/leads` filter/search + export screen
- `/lead/:leadId` lead detail (notes, callback/appointment)
- `/admin` admin console (tabs below)

### Seeded accounts
- Admin: `admin@boothiq.com` / PIN `482913`
- Staff: `staff@boothiq.com` / PIN `715264`

## 2. Surfaces & Separation
Three distinct surfaces on separate routes with separate access. **Absolute rule:** the doctor-facing kiosk + wheel NEVER display a score, dollar figure, tier word, or any Medicare data. Kiosk API responses return only `{id, spin_available}`. The wheel receives only a color hex (no numbers/words).

## 3. Data Ingestion (Admin)
- Upload CMS "Medicare Part D Prescribers by Provider and Drug" CSVs (designed for ~25M rows / 2.5GB split across 5–8 parts).
- **Ingestion sessions:** create a session, upload files across multiple sittings, then explicitly **finalize**. Totals provisional until finalized.
- **Chunked, resumable uploads** (4MB chunks, retry w/ backoff); survives dropped connections. Each chunk is stored as its own object in **Emergent object storage** (not pod-local disk), so uploads and processing are correct across a multi-pod deployment.
- **Streaming aggregation** row-by-row: parts are fetched one at a time and stitched at line boundaries, so memory stays bounded regardless of file size (never loads the whole file). Handles UTF-8 BOM (`utf-8-sig`).
- **Cross-file physician straddling:** aggregation keyed by NPI with `$inc`, so the same doctor split across the end of one file and start of the next is merged correctly.
- **Column detection by header name** (not position): Prscrbr_NPI, Prscrbr_Last_Org_Name, Prscrbr_First_Name, Prscrbr_City, Prscrbr_State_Abrvtn, Prscrbr_Type, Tot_Clms, Tot_Drug_Cst. Preview endpoint shows detected mapping; admin can override.
- **Capture ALL columns:** numeric measure columns are summed per NPI into `extra.<Col>`; categorical columns carried into `raw.<Col>` (first value); `row_count` = number of drug rows. ID-like columns (fips/npi/flag/sprsn/_src) routed to raw, not summed.
- **Aggregation math:** total claims = sum(Tot_Clms); total drug cost = sum(Tot_Drug_Cst); avg per claim = total cost / total claims (computed at finalize).
- **Coverage report** (on finalize): total rows, unique NPIs, min/max NPI, row-density by 50M NPI block, estimated share of full dataset, and **truncation warnings** (max NPI well below 1,999,999,999, or sharp density drop in final block).
- **Live dataset management:** finalize then "Go Live"; previous live dataset stays until new one goes live (zero downtime). Delete datasets (blocked for the currently-live one).
- **Synthetic sample generator** for instant demos (~700 physicians with deliberate name collisions).
- Progress reported over WebSocket (`admin:{session_id}`).

## 4. Scoring (server-side only)
Two independent scores per physician (no combined score).

### 340B Specialty Pharmacy (top-down, no fallthrough)
Uses avg $/claim + total drug cost. All six numbers are admin-editable with live tier-count calibration preview.
- **GREEN** (green shades by avg/claim): base `#34D399`; **GREEN+** ≥ $7,000 `#059669`; **GREEN++** ≥ $10,000 `#064E3B` — requires avg ≥ $4,000 AND cost > $2,000,000
- **YELLOW** `#F59E0B` — avg ≥ $1,000 AND cost > $1,000,000
- **BLUE** `#3B82F6` — avg < $1,000 AND cost < $1,000,000
- **RED** `#EF4444` — everything else
- **GREY** `#CBD5E1` — unmatched physician

### RPM (Remote Patient Monitoring)
Uses total claim volume × 1.25 multiplier for chronic-care specialties (internal medicine, family practice, general practice, cardiology, endocrinology, nephrology, geriatric medicine, pulmonary disease, nurse practitioner, physician assistant).
- **GREEN** `#10B981` — adjusted ≥ 8,000
- **YELLOW** `#F59E0B` — ≥ 3,000
- **BLUE** `#3B82F6` — ≥ 1,000
- **RED** `#EF4444` — below 1,000
- **GREY** — unmatched

## 5. Identity Matching
- **Prefer NPI:** 10-digit numeric field, validated with the NPI checksum (Luhn over `80840` + first 9 digits).
- **Name + location resolution** (when no NPI): query aggregated table by uppercased last name + state + first initial; if multiple candidates and a city is provided, narrow by city (unique city match = confirmed). Kiosk shows an autofill picker ("Is one of these your practice?") listing City · Specialty for common names; falls back to asking for NPI when >12 matches.
- **Collision count:** number of providers sharing uppercased first+last name → match status: `confirmed` (1), `probable` (2–4), `unresolved` (5+). Unresolved scores GREY (unknown, not low value).
- Aggregated table stores/indexes uppercased+trimmed first/last names. Indexes: NPI; (last_upper, state); (last_upper, first_upper); session_id.

## 6. iPad Kiosk (doctor-facing)
- **3-screen form**, landscape-oriented, large tap targets, autofocus, numeric keypads for NPI/phone.
  - Screen 1: first name, last name, mobile OR email (**at least one**, both allowed), optional NPI ("speeds up your prize").
  - Screen 2: practice name, **practice type** (Employee / Private Practice / Group), practice city, state (defaults to event's convention state), specialty (searchable), name-resolution picker, "Which employee helped you today?" dropdown (from event associates or full roster).
  - Screen 3: interest chips (340B, RPM, Hospital Pharmacy Services, MSO Support, Not sure yet), two SEPARATE consent checkboxes (contact + SMS), each stored with exact wording + timestamp.
- On submit → straight to the wheel.
- **Hardening:** screen wake lock, landscape lock (best effort), auto-reset 20s after wheel result, back-navigation blocked (uses history replace), PWA standalone; recommend iPad Guided Access.
- **Offline:** leads written to localStorage first, synced with retry + exponential backoff; never blocks the doctor's flow.
- **Per-event theming:** kiosk uses the selected event's color scheme.

## 7. Full-Screen Prize Wheel
- Launches on submit, fills the screen edge-to-edge (PWA standalone).
- Canvas wheel; **outcome resolved server-side before animation** (weighted probability), then animates to the predetermined segment. One spin per lead, enforced locally + server-side (atomic guard).
- Accelerate → 4–6s spin → eased stop → winning animation + large prize name + redemption code.
- **Audio:** AudioContext created/resumed inside the SPIN tap handler (iOS unlock), velocity-following tick during spin, rising chime on stop; mute toggle in admin.
- **Configurable prizes** (no redeploy): segment label, color, prize name, win weight, inventory. Weighted odds control cost. Zero-inventory segments auto-drop. Multiple prize sets; assignable per event. Odds are NEVER a function of the doctor's score.
- **Wheel analytics:** spins completed, prize distribution vs weights, inventory remaining.
- **Tier-color rings (staff hack, admin-toggleable `wheel_tier_glow`):** OUTER ring = 340B color, INNER ring = RPM color, background ambiance follows 340B. No match → RED outer + ORANGE inner. Neutral slate background when toggle off. Color-only (no words/numbers) to preserve the privacy rule. Returned via `/api/kiosk/leads/{id}/glow` → `{glow, glow_340b, glow_rpm}`.

## 8. Twilio SMS Alerts
- **Alert rules engine (admin):** per score (340B/RPM) per tier, choose whether to send; recipients = all on-duty or a specific subset; per-event rules; hourly ceiling per staffer with digest fallback.
- **Staff roster:** name, mobile, role, on-duty toggle. Only on-duty staff alerted; scoped to event associates when assigned.
- **Selected employee always notified:** when the doctor picks the employee who helped them, that employee gets a text with a link to the lead detail (to add notes) — even for GREY/unmatched leads.
- **Message content:** tier + color code, physician name/specialty/city/state, headline figures (claims, drug cost, $/claim), booth/iPad, and a short link to the lead. Never sent to the physician; only public CMS data + provided business contact.
- **Reliability:** phone normalization to E.164; dedup (never twice per lead per staffer); rate limiting; offline queuing with delayed-flag; delivery status via Twilio status-callback webhook (`/api/twilio/status`).
- **Delivery logging + dashboard "SMS Delivery Health" banner** showing failure counts + error code (e.g. A2P 10DLC error 30034). Every alert logged with recipient, timestamp, Twilio SID, status.

## 9. Staff Dashboard
- Live auto-refreshing feed (WebSocket + polling), newest first, arrives within ~2s.
- **Lead cards:** dual color bands (340B + RPM, hex-accurate incl. green shades), name, specialty, city/state, NPI + match status, claims, drug cost, avg/claim, interest chips, contact, associate. GREY cards distinct-in-kind (slate, no shadow). Actions: Open (detail), Assign to me, Note.
- **Green-lead alert:** audible beep + haptic when a GREEN lead arrives (in addition to SMS).
- **Counters:** today's leads by tier (340B/RPM), spins, prizes remaining.
- **Filters/sort:** tier (both), specialty, state, interest, assigned rep, associate, match status; sort by drug cost / avg per claim / claim volume / capture time. Multi-event tagging.
- **Connectivity + delayed-alert banners.**
- **Alert log drawer** with live status updates.

## 10. Leads Screen (`/leads`) & Lead Detail (`/lead/:id`)
- Dedicated filter/select table (event, tier, match, associate, state, specialty, interest, sort) with per-row Open + CSV/XLSX export.
- Lead detail: full physician info + scores, **"All CMS Columns"** section (summed measures + carried fields + drug rows), notes (add/list), **call-back date**, **appointment date/time**, assign. Reached from the SMS link.

## 11. Events (Admin)
- Add/edit/delete events (default event protected). Each event: name, convention state, **color scheme** (primary/accent), assigned **associates** (from roster), and prize set.
- Kiosk is set to an event on the launcher; kiosk theme, associate list, prize set, and default state come from the event.

## 12. Export & CRM
- CSV + XLSX export including NPI, match status, both tiers + 340B shade, raw Medicare figures, event, associate, practice type, callback/appointment, and a dynamic tail of **every captured CMS column** (summed measures + raw fields + drug rows).
- CRM field-mapping endpoint for pushing leads into an existing CRM.

## 13. Admin Console Tabs
Events · Data Ingestion · Scoring (threshold editor + live calibration counts) · Prize Wheel (segments/weights/inventory/prize sets + analytics + tier-glow toggle) · SMS Alerts (rules + ceiling) · Staff Roster.

## 14. Key API Endpoints (all under /api)
- Auth: `POST /auth/login`, `GET /auth/me`, `POST /auth/kiosk/register`
- Admin ingestion: `POST /admin/sessions`, files init/chunk/complete, `POST /admin/sessions/{id}/finalize`, `/golive`, `DELETE /admin/sessions/{id}`, `GET /admin/live`, `POST /admin/seed-sample`
- Admin config: `/admin/thresholds` (+`/preview`), `/admin/prizes` (+`/activate`,`/analytics`), `/admin/alert-rules`, `/admin/roster`, `/admin/events`, `/admin/settings`
- Kiosk: `GET /kiosk/config?event_id=`, `GET /kiosk/events`, `POST /kiosk/resolve`, `POST /kiosk/leads`, `POST /kiosk/leads/{id}/spin`, `GET /kiosk/leads/{id}/glow`
- Dashboard: `GET /dashboard/leads` (+`/{id}`), `/counters`, `/alerts`, `POST /dashboard/leads/{id}/assign|note|schedule`, `GET /dashboard/export`, `/crm-mapping`
- Twilio webhook: `POST /twilio/status`
- WebSocket: `/ws/dashboard`, `/ws/admin:{sessionId}`

## 15. Known Constraints / Notes
- SMS delivery requires Twilio **A2P 10DLC** registration; unregistered US 10DLC sender returns error 30034 (undelivered). Code sends correctly; delivery is account-gated.
- Offline scoring currently: offline leads are queued and scored on sync (not scored from a fully cached 25M-row on-device lookup).
- Preview vs production: changes are made in preview; production (`hudlup.net`) requires redeploy. The top-right version badge indicates the running build.

## 15b. Changelog
- **v1.5** — Moved chunked CSV upload staging from pod-local `/tmp` to Emergent object storage (`backend/storage.py`); ingestion is now correct on multi-pod deployments. Verified single- and multi-chunk boundary stitching (exact row counts + claim sums) and preserved CSV quoting.
- **v1.4** — 340B green shading (GREEN/GREEN+/GREEN++), dual concentric tier rings on the wheel (outer 340B, inner RPM), SMS Delivery Health banner, per-screen version badge, practice city/state capture, lead-submit validation fix.

## 16. Suggested Future Enhancements (ideas, not yet built)
- Native mobile companion app for the staff dashboard.
- Column-mapping confirmation UI before processing.
- Multi-event switcher across dashboard/admin; digest delivery of held alerts.
- On-device cached lookup for true offline scoring at full scale.
- Duplicate-lead detection across a single event.
- CRM push (Salesforce/HubSpot) via the field mapping.
- Real-time delivered/failed rollups and per-staffer alert dashboards.
