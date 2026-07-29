---
name: bookednow-client-site
description: Build or add a new BookedNow client site (the small brochure site at [client].bookednow.app that every BookedClinics.ca client gets, used as their verified business page for A2P/TCR SMS registration). Use this whenever asked to build, create, add, launch, or fix a client's BookedNow site, "his/her site", "the site we submit for A2P", a landing page for a new client sub-account, or anything involving the bookednow/ directory. Also use it when reviewing or debugging an existing client site in bookednow/ to check it matches the house pattern. Don't skip this even if the request sounds small ("just add his site") — the layout has a specific standard pattern that's easy to get wrong by copying the wrong existing site as a template.
---

# BookedNow client site

Every BookedClinics.ca client gets a small static site at `bookednow/[client-key]/`, served at
`[client-key].bookednow.app` via a host-rewrite in `bookednow/vercel.json`. It exists for two reasons:
lead capture, and — just as important — it's what gets submitted as the client's verified business
website when registering their phone number for A2P/TCR (10DLC) SMS. A2P/TCR checks that the
registered business name, address, and website are real and consistent with each other, so accuracy
here isn't cosmetic — a wrong or placeholder address is exactly what gets a registration rejected or a
number flagged.

## Before writing anything: get real business info from Adam

Never fabricate or guess a street address, phone number, legal business name, or business hours for
these pages. If Adam hasn't given you a real street address, ask for it rather than filling in a
placeholder "to be confirmed later" — a previous session did this for one client and it caused their
A2P/TCR submission to get flagged for resubmission, because the placeholder address made it to
production and nobody caught it before it was submitted to the carrier. If you only have a city/state,
say so in the site rather than inventing a street. If you don't have real business hours, use "By
Appointment" rather than inventing a schedule.

You need, at minimum: legal/DBA business name, street address (or confirmation there isn't one, e.g. a
fully virtual practice), phone number, and an email. A website URL isn't needed from Adam — the site
you're building *becomes* that.

## Site structure

```
bookednow/[client-key]/
├── index.html          (home — required)
├── about/index.html    (required)
├── contact/index.html  (required)
├── privacy/index.html  (required)
├── terms/index.html    (required)
├── services/index.html (optional — see below)
└── assets/site.css     (required)
```

`services/` is for local, in-person businesses with a real service menu (massage, chiropractic,
compounding pharmacy) — see `bookednow/paradise-healing/services/` or
`bookednow/my503aconnect/services/`. Fully virtual/telehealth practices that describe their offering in
prose on the About page usually skip it — see `bookednow/empowerpsychiatry/` (no services folder).
Use your judgment based on the business type, and ask Adam if it's not obvious.

## The homepage: use paradise-healing as your template, not rtb-spa

Read `bookednow/paradise-healing/index.html` first — copy its structure and adapt content, not just
its vibe. It's representative of how 6 of the 8 real client sites are built:

- Single-column hero (`.page { grid-template-columns: 1fr; }`) with a gradient background, badge,
  headline, sub-headline, a benefits list, a testimonial, and a `.hero-cta` button that's a `tel:` link
  ("📞 Call to Book Your Free Consultation") — not a form.
- Below the hero: a `.home-sections` block with a 3-card services teaser and an `.about-split` section,
  identical structure to the about-page content.
- The **LeadConnector chat widget** (see below) is the only interactive lead-capture mechanism on the
  page.

`bookednow/rtb-spa/` and `bookednow/escape-zgm/` are the only two sites that instead use a split-panel
layout with a big embedded SMS opt-in form (name/phone/email fields, consent checkbox, JS validation).
That pattern looks more sophisticated and it's tempting to reach for it as "the good one," but it's the
outlier, not the standard — a prior session made exactly this mistake by copying rtb-spa as the
reference template. Don't copy it for a new client unless Adam specifically asks for a full opt-in
form instead of a phone-CTA + chat-widget site.

The about/contact/privacy/terms pages are structurally uniform across every site regardless of which
homepage style is used — `.page-hero`, `.content`, `.about-grid`, `.contact-grid` are all shared classes
from `assets/site.css`, so those pages are lower-risk to build from any existing site as reference.

## assets/site.css

Copy an existing client's `site.css` wholesale and change only the CSS custom properties at the top —
`--accent`, `--accent-hover`, `--accent-soft`, and the hero gradient colors used inline in `index.html`'s
`<style>` block. Everything else (`.header`, `.business-bar`, `.info-footer`, `.footer`, `.content`,
`.service-card`, `.hours-card`, `.contact-card`, etc.) should be copied verbatim — these are a shared
design system across all client sites, not something to redesign per client. Pick a color that doesn't
collide with an existing client's palette if you want the sites to feel visually distinct in a shared
dashboard/portfolio view, but this is a nice-to-have, not a requirement.

## Privacy and Terms pages

These carry the actual compliance language and are read by carriers during A2P/TCR review, so get the
specifics right rather than lightly rewording a template:

- Real SMS consent language: what the messages will be about, "Message frequency varies. Message and
  data rates may apply," STOP to unsubscribe / HELP for help, "Consent is not a condition of purchase."
- The business name, address, phone, and email in the footer/contact sections must match exactly what's
  in the header/business-bar and what's registered in GHL for that client's location — inconsistency
  between pages is itself something A2P review can flag.
- Use `bookednow/rtb-spa/privacy/index.html` and `terms/index.html` as the copy template — despite
  rtb-spa's homepage being the outlier, its legal-page language is standard and fine to reuse.

## Wiring it up

1. Add the subdomain rewrite to `bookednow/vercel.json`, following the existing pattern:
   ```json
   {
     "source": "/(.*)",
     "has": [{ "type": "host", "value": "[client-key].bookednow.app" }],
     "destination": "/[client-key]/$1"
   }
   ```
   Insert it before the final catch-all rewrite to `/home/$1`.

2. Get the LeadConnector chat widget snippet from Adam — it's per-GHL-sub-account
   (`data-widget-id="..."` in GHL under Sites → Chat Widget for that client's location). **Never reuse
   another client's widget ID** — it's tied to that other client's GHL sub-account, so a copied ID would
   route this client's website chat messages into someone else's inbox. If Adam hasn't provided one yet,
   ship the site without it and say so explicitly, rather than guessing or leaving in a leftover ID from
   whatever site you used as a reference.

3. This site's only job is passing A2P/TCR — it's not meant to become the client's primary marketing
   or booking destination. If the client has no real website of their own, update the `website` field in
   `bookedclinics/config/clients.json` and the GHL location record to point at
   `https://[client-key].bookednow.app`, since that's the only real business page available to submit
   for A2P/TCR. But if the client already has a real, live website (with genuine content, reviews,
   history), leave that as the canonical `website` field — don't overwrite it with the new bookednow.app
   URL, which as a brand-new domain is a weaker A2P submission than an established site anyway. Track the
   bookednow.app URL separately instead (e.g. a `bookedNowUrl` field in `clients.json`).

## Testing note

Opening these files directly via `file://` in a browser will look unstyled — the CSS and nav links use
root-relative paths (`/assets/site.css`, `/about/`) that only resolve once served from a real domain
root on Vercel. This is normal and matches how every other client site behaves under the same test; it
is not a bug in a new build.

## Local sanity checks before committing

- Grep the new site's files for any leftover reference-site content (business name, city, phone) you
  forgot to replace — this has happened before.
- Confirm phone/email/address are identical across all pages.
- Confirm the vercel.json rewrite was added and the `website` field update is queued for
  `clients.json` + GHL.
