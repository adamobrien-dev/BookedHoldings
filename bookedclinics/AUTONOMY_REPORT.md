# BookedClinics — Autonomy Report
**Generated:** May 21, 2026  
**Prepared for:** Adam Obrien, BookedHoldings

---

## Executive Summary

BookedClinics is already more automated than most agencies at this revenue stage. A live dashboard, 5 AI Telegram employees sending daily briefings, real-time pipeline monitoring, and integrated billing/ads tracking are all in production. The gaps that remain are concentrated in three areas: **reaction speed** (things that happen hours or days after they should), **manual data entry** (hard-coded config that requires a code deploy to change), and **client-facing autonomy** (everything the client needs still routes through you). Fixing these puts the business on a path to running a full day without a single manual touchpoint.

---

## What Is Already Automated

### 1. Daily Intelligence Layer (8:00 AM EDT)
A Vercel cron job fires every morning and dispatches five AI employees to Telegram, each covering a specific domain:

| Bot | Domain | What It Reports |
|-----|---------|-----------------|
| Jordan | Operations overview | Red alerts, pipeline status, billing due, Meta ad health |
| Morgan | Billing | Per-client payment status, overdue invoices, Stripe balance |
| Alex | Meta Ads | 7-day spend, leads, CPL per account — color-coded thresholds |
| Riley | Agency sales pipeline | SC hot prospects, DC upcoming, no-shows, recovery queue |
| Casey | Client health | Workflow live/draft status, stuck lead %, lead → booked → sale funnel |

**Assessment:** This is the most valuable automation in the stack. It replaces a 30–45 minute morning review. The signal-to-noise ratio is high.

### 2. Real-Time Operations Dashboard (`/platform`)
A single-page dashboard pulls live data from GHL, Stripe, PayPal, and Meta on demand. Tabs cover:
- **Overview** — total leads, stuck %, collected revenue, Stripe balance
- **Billing** — per-client payment status, installment progress, next due dates
- **Clients** — workflow status, lead funnel per location
- **Recovery** — SC no-calls, DC no-shows, unsigned contracts with days aging

**Assessment:** Solid. The Recovery tab is the most recent addition and the highest-leverage view — it surfaces the money sitting in limbo.

### 3. Multi-Platform Revenue Tracking
Stripe payment intents + PayPal transaction API are aggregated into a single `totalCollected` figure. Failed payments surface automatically.

### 4. Meta Ads Health Monitoring
Live account status (DISABLED, UNSETTLED, or active) with 7-day spend, leads, and CPL. CPL thresholds trigger color flags (green < $40, yellow < $75, red > $75).

---

## Gaps — What Still Requires Manual Action

The following events are **detected** but **not acted upon automatically**. Every one of these currently requires you to read a Telegram message and then do something manually.

### Gap 1: Stale Contracts Are Hard-Coded in Source Code
**File:** `bookedclinics/api/dashboard-data.js` and `bookedclinics/api/recovery.js`, lines 67–75

The 7 unsigned contracts in the recovery queue are a static array in the JavaScript source. To add a new stale contract, you must edit the file and deploy. If a contract gets signed, you must edit the file and deploy again.

**Impact:** Delay between reality and dashboard. Risk of the list falling out of sync with what's actually in GHL.

### Gap 2: No Automated Follow-Up on Failed Payments
Morgan reports a failed Stripe payment every morning. Nothing happens automatically. The action (resending a payment link) still requires a manual step from you.

**Impact:** Cash flow delay. A failed payment on day 1 that isn't followed up for 2 days costs 2 days of collection cycle.

### Gap 3: No Automated Follow-Up on Stale Contracts
Riley reports unsigned contracts. Nothing in GHL triggers an automated sequence when a contract has been sitting for 3, 7, or 14 days. The follow-up is manual.

**Impact:** The 7 current stale contracts represent significant potential MRR. Each day of delay is a day of lost revenue.

### Gap 4: No Immediate Alert for Critical Events
The daily briefing at 8 AM is the only notification trigger. If a Meta ad account gets disabled at 2 PM, you won't know until 8 AM the next morning — 18 hours of wasted ad spend.

**Events that need immediate alerts, not daily summaries:**
- Meta ad account disabled or unsettled
- Stripe payment failure
- New SC-stage lead enters the pipeline (hot prospect)
- A DC no-show goes 48+ hours without re-booking

### Gap 5: Client Config Requires a Code Deploy to Change
**File:** `bookedclinics/api/dashboard-data.js`, lines 4–65

The `CLIENTS` array and `BILLING_CONFIG` array are hard-coded. Adding a new client, changing a deal structure, or updating a Stripe customer ID requires editing JavaScript and deploying to production. This is a bottleneck when onboarding is the revenue engine.

### Gap 6: No Client-Facing Reporting
Clients have no self-serve visibility into their own performance. Every reporting interaction routes through you: you check the dashboard, you decide what to share, you write the message or email. At 5 active clients this is manageable; at 15 it becomes a weekly time block.

### Gap 7: No Automated Weekly Performance Email to Clients
The `/api/weekly-report` endpoint exists and returns pipeline metrics. Nothing sends that data to the client automatically. A weekly email showing leads booked, qualified, and closed would demonstrate value without any manual preparation.

### Gap 8: Workflows Are Monitored But Not Enforced
Casey flags when a GHL workflow is in DRAFT instead of LIVE. But there is no automated consequence — no re-activation attempt, no escalating alert, no block on onboarding completion. Leads can enter a client's funnel with zero follow-up automation running.

### Gap 9: No Test Coverage or CI/CD
There are zero automated tests in the codebase. Every deploy to production relies on manual verification. Given that the dashboard is the operational nerve center, a broken API (broken API key format, malformed GHL response, new Stripe field) would go undetected until the morning briefing fails to send or you notice something is wrong.

---

## Recommendations — Prioritized by Impact vs. Effort

### Priority 1 — HIGH IMPACT / LOW EFFORT

#### 1A. Instant Telegram Alerts via a New Cron or Webhook
Add a second cron at a higher frequency (e.g., every hour, or every 4 hours) that only fires when it detects a new critical condition: Meta account disabled, Stripe payment failed, new SC lead with no call booked. This requires ~50 lines of new code in a new API endpoint.

**What to build:** `/api/bots/alert-check` — runs on a `0 */4 * * *` schedule (every 4 hours), checks Meta account status and Stripe failed payments, sends a message to Jordan only if something changed since the last check.

#### 1B. Pull Stale Contracts Dynamically from GHL
Replace the hard-coded `STALE_CONTRACTS` array with a GHL query: find all opportunities in the agency pipeline with a `contract_sent` tag or custom field where status is not won/lost and the tag was set more than 3 days ago. This removes a manual maintenance burden and makes the data always accurate.

**What to build:** Add a GHL custom field `contract_sent_date` to opportunities. Query those opportunities in `/api/recovery.js` instead of reading the static array.

#### 1C. Add an End-of-Day Summary Cron (5:00 PM EDT)
The 8 AM briefing is a start-of-day plan. A 5 PM check-in from Riley would summarize what moved today: new opportunities, stage changes, calls that ran. This closes the loop on daily activity without adding any manual work.

**What to build:** Add `"0 21 * * *"` to `vercel.json` crons (21:00 UTC = 5 PM EDT), filtered to only send if something changed that day.

---

### Priority 2 — HIGH IMPACT / MEDIUM EFFORT

#### 2A. Automated Stale Contract Follow-Up Sequence (GHL Workflow)
Build a GHL workflow triggered when a contact has `contract_sent_date` set and is not in Won/Lost status. At 3 days: send a friendly check-in SMS. At 7 days: send a follow-up email from your persona. At 14 days: trigger a Telegram alert to Riley flagging as critical. At 30 days: auto-move to Lost with a note.

**Implementation:** This is entirely inside GHL — no code changes. Requires creating one workflow with 4 steps and a custom field trigger.

#### 2B. Automated Payment Failure Recovery (GHL + Stripe)
When Morgan detects a failed Stripe payment, the system should automatically:
1. Send a Stripe payment link to the client via GHL email/SMS (Stripe has a `payment_intents/{id}/confirm` API and hosted payment pages)
2. Log the outreach in the GHL contact timeline

**Implementation:** Extend `/api/bots/daily-briefing.js` — when a failed payment is detected, use the GHL messaging API to send the client an SMS with a Stripe-generated payment link.

#### 2C. Move Client Config to Environment Variables / Vercel Config
Replace the `CLIENTS` and `BILLING_CONFIG` hard-coded arrays with a JSON file loaded at runtime (or environment variables for sensitive IDs). Adding a new client then requires only updating a config file, not touching API logic.

**What to build:** Create `bookedclinics/config/clients.json` (committed to repo, non-sensitive data) and `bookedclinics/config/billing.json`. API files import these instead of defining inline. Stripe IDs and GHL PITs remain in environment variables.

---

### Priority 3 — MEDIUM IMPACT / MEDIUM EFFORT

#### 3A. Automated Weekly Client Performance Email
Every Monday morning, auto-generate and send each client their weekly metrics: leads this week, calls booked, qualified, show rate, and CPL if Meta is running. The data already exists in `/api/weekly-report`.

**What to build:** Add a Monday-morning cron (`0 14 * * 1` = 9 AM EDT Monday), a new `/api/bots/weekly-client-report` endpoint that calls `/api/weekly-report` per client and sends via GHL email API.

#### 3B. Workflow Draft Auto-Alert Escalation
Casey already flags draft workflows. Extend this: if a workflow has been in DRAFT for more than 7 days after a client went live, escalate to a second Telegram message later in the day and add a red badge to the dashboard client card.

**What to build:** In `dashboard-data.js`, add a `workflowStaleDraftDays` field per client. In the daily briefing, have Casey add an explicit call-to-action with the GHL deep link to activate the workflow.

#### 3C. New Lead Instant Notification via GHL Webhook
Configure a GHL webhook to POST to a new Vercel endpoint when a new opportunity enters the DC Upcoming or SC Upcoming stages. That endpoint fires a Telegram message to Riley immediately — not at 8 AM the next day.

**What to build:** New endpoint `/api/webhooks/ghl-opportunity` that validates the webhook signature and sends a Telegram message to Riley when stage = SC_UPCOMING.

---

### Priority 4 — LOWER PRIORITY / HIGHER EFFORT

#### 4A. Client-Facing Performance Portal
A simple authenticated page (`/clients/[name]`) showing each client's own metrics: leads, booked, sales, ad spend, CPL. Authentication via a unique token in the URL (no password required for simplicity). This reduces inbound reporting questions.

#### 4B. Onboarding Intake Form
A web form (can be a GHL form or a simple Vercel serverless function) where new clients submit: business name, location, target market, ad budget, payment info. Data auto-populates a GHL contact and creates the onboarding checklist tasks. Currently this is all manual back-and-forth.

#### 4C. Basic Integration Tests
Add a `/api/health` endpoint that tests all upstream API connections (GHL, Stripe, Meta, PayPal) and returns a pass/fail per service. Set up a GitHub Actions workflow that hits this endpoint after each deploy. This catches broken API tokens before the morning briefing fails silently.

---

## Autonomy Score by Domain

| Domain | Current State | After Priority 1+2 | After All |
|--------|--------------|---------------------|-----------|
| Morning awareness | 9/10 — fully automated | 9/10 | 9/10 |
| Critical alerting | 3/10 — daily delay | 8/10 | 9/10 |
| Payment collection | 2/10 — fully manual | 7/10 | 9/10 |
| Contract pipeline | 3/10 — static data, manual follow-up | 7/10 | 9/10 |
| Client reporting | 1/10 — fully manual | 4/10 | 8/10 |
| New client onboarding | 2/10 — fully manual | 3/10 | 7/10 |
| System reliability | 2/10 — no tests | 2/10 | 7/10 |
| **Overall** | **4/10** | **6.5/10** | **8.5/10** |

---

## Quick Wins — Do These First

These can be done in a single working session with minimal risk:

1. **Add the 4-hour alert cron** — 50 lines of code, catches Meta disables and payment failures within hours not 24 hours.
2. **Add the 5 PM end-of-day cron** — 10 lines in `vercel.json` + minor additions to the existing briefing builder.
3. **Build the stale-contracts GHL workflow** — zero code changes, done entirely inside GHL. Activates automated follow-up on 7 existing stale contracts immediately.
4. **Move `STALE_CONTRACTS` to a GHL query** — removes a permanent maintenance burden; the list updates itself.

---

## What Autonomous Looks Like at Full Build-Out

A typical day with all recommendations implemented:

- **8:00 AM** — Jordan, Morgan, Alex, Riley, Casey send briefings. No new alerts because the 4-hour check caught and acted on everything overnight.
- **During the day** — A new SC-stage lead books via the website. Riley gets an instant Telegram notification. GHL launches the SC confirmation sequence automatically.
- **2:30 PM** — A client's Meta ad account goes unsettled. Jordan sends an immediate alert. You fix the billing issue before the afternoon campaign spend is impacted.
- **4:00 PM** — A stale contract hits day 7. GHL automatically sends a follow-up email with the contract link.
- **5:00 PM** — Riley sends an end-of-day summary: 2 DC calls ran, 1 no-showed (GHL re-booking sequence triggered), 1 SC confirmed for tomorrow.
- **Monday 9:00 AM** — Each client receives their automated weekly performance email.

**Your role shifts from operator to exception handler** — you act on things that the system cannot resolve autonomously, not on things it simply hasn't been told to watch.

---

## Technical Debt to Address

| Item | Risk | Fix |
|------|------|-----|
| Hard-coded client/billing config | Medium — deploy required to add clients | Extract to `config/` JSON files |
| Hard-coded stale contracts list | High — always stale | Query GHL dynamically |
| No test coverage | Medium — silent failures | Add `/api/health` + GitHub Actions |
| CORS `*` on all API routes | Low (internal only) — but surface area | Restrict to bookedclinics.ca origin |
| No rate limiting on APIs | Low now — scales badly | Add Vercel Edge Config rate limit |
| Single Stripe API key (no restricted key) | Medium — full account access | Create a restricted key with read-only permissions |

---

*This report was generated by analyzing the full BookedHoldings codebase including all serverless API functions, dashboard logic, Telegram bot configuration, GHL integration patterns, Stripe/PayPal billing flows, and Meta ads monitoring.*
