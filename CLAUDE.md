# BookedHoldings — Business Context

## Who We Are

**Adam O'Brien** runs a digital marketing and client acquisition agency operating under three brands:

- **BookedClinics** (`bookedclinics.ca`) — the main agency brand. Runs paid Meta/Facebook/Instagram ad campaigns, builds booking funnels (quiz → landing page → booking), manages GoHighLevel CRM sub-accounts, and handles all automations for health & wellness clients. Dashboard at bookedclinics.ca. Repo: `bookedclinics/`
- **BookedNow** (`bookednow.app`) — the white-label booking platform built for clients. Replaces clients' existing booking software (Squarespace, Mindbody, etc.) with a custom site + calendar + automation stack. Subdomains per client (e.g. `unwind-sound-lounge.bookednow.app`). Repo: `bookednow/`
- **BookedJobs** (`bookedjobs.ca`) — the parent company. Adam's email: adam@bookedjobs.ca

**Standard offer:** $500/mo flat retainer (no onboarding fee during promos), client pays their own ad spend separately. Some clients are on profit-share or per-patient models instead.

**Stack:** GoHighLevel (CRM, automations, sub-accounts), Meta Ads Manager, BookedNow (custom booking), Stripe (billing), Dropbox Sign (contracts), Fathom (call recording), Vercel (hosting for bookedclinics and bookednow), GitHub (adamobrien-dev/BookedHoldings).

---

## Active Clients

All clients are in `bookedclinics/config/clients.json`. Key ones:

| Key | Name | Business | Status | Deal |
|-----|------|----------|--------|------|
| terri | Terri Mignot | Get Body Sculpted · Body Contouring · Tucker, GA | live | $500/mo |
| allaphia | Allaphia Richards | Paradise Healing LLC · Boston, MA | live | $500/mo |
| thania | Thania Ramirez | Tiali Beauty Lounge · Med-Spa · Warwick, RI | live | 10% revenue share |
| aguilera | Frank Aguilera | Aguilera Health & Wellness · Chiro · Bakersfield, CA | setup | $500/mo |
| fletcher | Fletcher Munksgard | Dane Functional Health · GLP-1/Functional Medicine | live | $500/mo |
| sandy | Sandy Sullivan | My Adult Primary Care · StemWave · Fayetteville, TN | setup | $500/mo |
| stephanie | Stephanie Alvarenga | RTB Spa · Massage · Houston, TX | live | $40/patient |
| carlos | Carlos Meneses | Health & Wellness · Miami, FL | setup | $50/sale |
| sarah | Sarah Purdy | Today Telemedicine · Women's Telepsychiatry · Florida | live | $500/mo |

**Notable prospect (not yet a client):**
- **Japa Kullar** / Unwind Sound Lounge — vibroacoustic therapy studio, LA. Signed contract June 4 2026, requested cancellation and refund. Potential chargeback situation — strong evidence exists (4 Fathom call recordings, signed Dropbox Sign contract, GHL messages). Do NOT refund; dispute any chargeback with evidence.

---

## Connected Tools (MCP)

All of these are pre-approved and should work without permission prompts:

| Tool | What it's for |
|------|--------------|
| **Fathom** | All call recordings. Use `search_meetings` to find a client, `get_meeting_transcript` for full transcripts. All recordings are of Adam's sales/strategy calls. |
| **Gmail** | adam@bookedjobs.ca inbox. Use `search_threads` to find client emails. |
| **Slack** | Team/client communications. |
| **Google Drive** | Shared docs, client files, ad strategy forms. |
| **Google Calendar** | Adam's schedule and client calls. |
| **Vercel** | Hosting for bookedclinics and bookednow. Use to deploy, check deployment status, fetch production URLs. Projects: `booked-clinics`, `bookednow`. Team: "adam's projects". |
| **Facebook Ads** | Meta Ads MCP — can search Ad Library, check campaign performance, manage ad accounts for clients. |
| **Canva** | Design assets and creatives. |
| **Cloudflare** | DNS and edge infrastructure. |
| **GitHub** | Repo: `adamobrien-dev/BookedHoldings`. Dev branch convention: `claude/[feature]-[id]`. Always push to the feature branch first, then merge to main for production deploy. |

**Stripe, GHL, and Dropbox Sign — use the Vercel API endpoints:**

These are NOT MCP connectors but are accessible through Vercel serverless functions (which CAN reach external APIs). Use `mcp__Vercel__web_fetch_vercel_url` to call them.

| Endpoint | What it returns |
|----------|----------------|
| `https://www.bookedclinics.ca/api/client-lookup?name=japa` | GHL contacts + pipeline + conversations, Stripe payment history + disputes, Dropbox Sign contracts — all for one person |
| `https://www.bookedclinics.ca/api/dashboard-data` | Full dashboard: all clients' GHL leads/workflows + Stripe billing summary + Dropbox Sign unsigned contracts |
| `https://www.bookedclinics.ca/api/recovery` | Agency GHL pipeline (SC upcoming, DC no-shows) + stale unsigned contracts |
| `https://www.bookedclinics.ca/api/meta-ads` | All clients' Meta ad performance |
| `https://www.bookedclinics.ca/api/meta-ads?adlib=telepsychiatry&countries=US` | Ad Library competitor search |

**To look up a specific person across all platforms:**
```
mcp__Vercel__web_fetch_vercel_url("https://www.bookedclinics.ca/api/client-lookup?name=PERSON_NAME")
```
This searches GHL (agency + all client locations), Stripe, and Dropbox Sign simultaneously.

---

## Repo Structure

```
BookedHoldings/
├── bookedclinics/          # Agency dashboard & API (deployed to bookedclinics.ca)
│   ├── api/
│   │   ├── meta-ads.js     # Meta Ads API proxy + Ad Library search (?adlib= param)
│   │   └── notifications.js
│   └── config/
│       └── clients.json    # All client records — source of truth
├── bookednow/              # Booking platform (deployed to bookednow.app)
│   ├── vercel.json         # Host-based rewrites per client subdomain
│   └── [client-key]/       # One folder per client (index.html, etc.)
└── CLAUDE.md               # This file
```

---

## Key Workflows

**Adding a new client:**
1. Add entry to `bookedclinics/config/clients.json`
2. Create `bookednow/[client-key]/index.html` for their BookedNow site
3. Add subdomain rewrite to `bookednow/vercel.json`
4. Commit, push to feature branch, merge to main → auto-deploys to Vercel

**Checking Meta ad performance:**
- Hit `https://www.bookedclinics.ca/api/meta-ads` for all clients
- Add `?preset=last_7d` (or `last_30d`, `this_month`) for date range
- Add `?adlib=<search terms>&countries=US` for Ad Library competitor research (requires Meta Ad Library API access — identity verification pending at facebook.com/ads/library/api)

**Looking up a client's calls:**
- Use Fathom `search_meetings` with the client name or business name
- Then `get_meeting_transcript` with the recording_id for full details

**Chargeback/dispute preparation:**
- Fathom call recordings = strongest evidence (timestamped, full transcript)
- Dropbox Sign audit trail = proof of signing (IP, timestamp, document ID)
- GHL conversation screenshots = cardholder's own words explaining why they cancelled
- Submit all three to Stripe dispute portal

---

## Important Notes

- `META_SYSTEM_TOKEN` env var is in Vercel **Production only** — not in Preview deployments. Test Meta API features via the live production URL.
- GHL sub-accounts use environment variables per client (`GHL_PIT_[KEY]`).
- A2P text verification (TCR) is pending for: RTB Spa, Paradise Healing, My Adult Primary Care — needs resubmission with correct business pages.
- The `claude/notifications-feature-GCehi` branch is the designated dev branch for this session. Always use it for development, then merge to main for production.
