# HudlUp provider CRM and website

## Public website
The root route presents an original responsive provider-focused marketing page for MSOs,
RPM providers, specialty pharmacies and infusion providers. Signed-in users retain the
existing Launcher; /home remains available. Sign-in, kiosk, event and campaign routes remain.
Product-preview content is clearly illustrative and interactive service tabs show different examples.

Positioning: **CRM for 340B & RPM with referral tracking.**
Demo requests validate business contact information, organization type, selected services and
permission to contact. A successful request creates a New website-sourced CRM lead with an
unassigned owner for managers to review. No email is automatically sent by this new route itself;
existing lead-created automations retain their existing behavior. A honeypot, per-peer rate limit
and one-day duplicate check reduce unwanted submissions. Responses do not expose CRM identifiers.

## CRM
- /crm/clients: filter client profiles by name, client status and service; administrators can add custom services.
- Every CRM lead includes a Client onboarding & services panel. Saving enrolls that lead in the client/services view.
- Client readiness remains independent of sales stages. DTCM completion is a manually tracked milestone.
- Each enrolled service has its own status, partner and update timestamp.
- Defaults: Specialty pharmacy 340B, RPM, Infusion.
- Exact requested milestones: DTCM Form Completed; Client is sending Infusion;
  Started with Caregenix for RPM; Started writing prescription.
- Custom services use Not Started, Onboarding, Active, On Hold and Inactive.
- /crm/service-referrals: record referrals linked to an existing client/lead, service,
  receiving organization and internal reference. Filter by service, status or client.
- Referral statuses: Submitted, Contacted, Accepted, In Progress, Completed, Declined.
- Referral history preserves the previous status, new status, timestamp and user id.
- Updates appear in the existing lead activity timeline.
- Lists are capped at 500 records and explicitly disclose the cap in the UI.

## Access and data
New CRM routes require existing CRM roles. Staff visibility follows created-by/owner restrictions;
managers retain the repository's existing shared-lead access model. Custom catalog changes are admin-only.
The existing application is a shared workspace; this change does not introduce separate customer tenants.
Referral records hold business workflow metadata. Use opaque internal references, not patient data.
These features manually record activity; no clinical referral delivery, Caregenix API integration,
340B eligibility determination or prescription transmission is implemented or claimed.

No migration of sales stages is required. Existing leads gain a profile only when saved.
MongoDB additions: crm_service_catalog, crm_service_referrals and website_rate_limits.
Startup creates referral, profile-status and rate-limit expiry indexes.

## Validation
Run:
- python -m pytest -c /dev/null backend/tests/test_client_services.py -q
- cd frontend && yarn install --frozen-lockfile && yarn build

The isolated API suite uses a fake database and tests validation, service independence,
staff ownership, admin catalog restrictions, referral history, website ingestion and rate limits.
It requires no production secrets. It does not replace integration testing against MongoDB.
The PR workflow runs these API checks and the frontend build.

Before production rollout, test the page at desktop/mobile sizes, submit a demo request,
assign the website lead, set all three service milestones, record a referral and change
its status. Check administrator and staff accounts. Deploy through the existing Emergent
environment with its normal backend/frontend configuration.
