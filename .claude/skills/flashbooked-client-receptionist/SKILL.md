---
name: flashbooked-client-receptionist
description: Build a new FlashBooked AI receptionist (Retell voice agent + dedicated GHL sub-account + Twilio phone number) for a new FlashBooked client or prospect. Use this whenever asked to set up an AI receptionist/agent for a new client, wire up a newly-bought phone number, "build one like Sarah/Katie/Aoife for [business]", onboard a new FlashBooked prospect, or anything involving a client's Retell agent, conversation flow, or the flashbooked/api/*-lead.js endpoint pattern. Also use it when debugging an existing FlashBooked client agent that's misbehaving on calls (talks over the caller, won't hang up, saves bad data) — the known-issues section covers the actual root causes already found and fixed once, so don't rediscover them from scratch. Don't skip this for what sounds like a small ask ("just give him a number") — the working pattern has several non-obvious platform gotchas that are easy to get wrong by improvising from Retell's docs alone.
---

# FlashBooked client receptionist

Every FlashBooked client/prospect gets a dedicated AI receptionist: a Retell voice agent with its
own phone number, wired to write leads straight into that client's own GHL sub-account. Aoife
(`agent_e0978154673e260de2cf8e6f96`) is FlashBooked's own marketing demo line and the original
template this pattern was cloned from. Sarah (Western Renewables) and Katie (CB Scaffolding) are
the two client builds this skill was extracted from — read `flashbooked/api/western-renewables-lead.js`
or `flashbooked/api/cb-scaffolding-lead.js` as your literal code template, don't write the endpoint
from scratch.

Everything below was earned the hard way, live, on real phone calls. Skipping a step here means
re-discovering the same bug on a real call with a real prospect.

## Before building anything: get real business context

Don't invent services, service area, or pricing rules. Check the client-lookup pattern first (GHL
contact search, Fathom call transcripts, Gmail threads with proposal docs) — Adam has usually
already had a discovery call and/or sent a proposal doc that specifies the actual pipeline stages,
fields to capture, and domain specifics the client agreed to. Building generic content when a real
spec exists means redoing the work.

You'll need from Adam only what you can't find yourself: the client's base city (for the GHL
location record — don't guess from a broad service area like "Leinster" or "the Dublin area"), and
which spare Twilio number to use if more than one is available.

## The build, in order

### 1. GHL sub-account

```
POST https://www.bookedclinics.ca/api/provision
{ "name", "businessName", "email", "phone", "niche", "city", "state", "zip", "country", "timezone", "website" }
```

Pass `country` explicitly (2-letter ISO, e.g. `"IE"`) — omitting it used to default to `"US"` and
silently mislabel non-US clients, which matters for SMS/A2P compliance later, not just cosmetics.
This is already fixed in `bookedclinics/api/provision.js` (accepts `country`, defaults to `"US"`
only if omitted). `zip` is still required by the request validation even though GHL doesn't
validate its format — use a placeholder like `"N/A"` if there's no real postal code.

The contact-creation step inside `/api/provision` will 401 — that's expected, the agency PIT can't
create contacts in the new sub-account. The `locationId` in the response is what you need.

### 2. Ask Adam for that sub-account's own PIT

GHL → the new sub-account → Settings → Integrations → Private Integrations → create a token
(contacts/opportunities/pipelines/tags/custom-fields scopes). **Pipeline creation specifically 401s
on the agency-wide PIT even though location creation works fine on it** — it needs the
sub-account's own PIT. This is a real wait-for-Adam step, not something to work around.

### 3. Pipeline, tags, custom fields — with the client's own PIT

Check whether Adam already has a spec (a proposal doc, a discovery-call summary) for pipeline
stages and fields to capture — CB Scaffolding's 10-stage pipeline (New Enquiry → Qualified → Site
Visit → Quote → Follow-Up → Won → Scheduled → Live → Dismantle → Complete) came straight from the
actual proposal doc sent to that client, not a generic template. If there's no spec, a reasonable
default is: New Enquiry → Contact Required → Survey Booked → Quote Sent → Follow-Up → Won → Lost.

API gotchas:
- `POST /opportunities/pipelines` — the **create** body needs `locationId`; a later **update**
  (`PUT`) must NOT include `locationId` (422s: "property locationId should not exist").
- Each stage object needs an explicit integer `position` — omitting it 422s.
- Tags: `POST /locations/{id}/tags` with `{"name": "..."}`, one call per tag.
- Custom fields: `POST /locations/{id}/customFields` with `{"name", "dataType", "model": "contact"}`.
  Typical set: Enquiry Type, Location/Eircode, [domain-specific fields like Property Type/Storeys],
  Existing Customer, AI Call Summary (`LARGE_TEXT`), Priority, Requested Next Step.

### 4. The lead-capture endpoint

Copy `flashbooked/api/western-renewables-lead.js` (or `cb-scaffolding-lead.js`) as your starting
point — same structure, new location ID / pipeline ID / stage ID / field IDs / tag names hardcoded
for the new client. Two things in that template exist specifically because they were bugs once —
don't simplify them away:

**Retell wraps function-call arguments, don't destructure `req.body` directly.** Retell's default
webhook payload for a custom tool call is `{ name, call, args }` — the actual parameters are nested
under `args`, not flat on the body. Destructuring `req.body` directly means every field (including
`phone`) is always `undefined` regardless of what the caller said, and it fails silently — the tool
call still "succeeds" from the LLM's perspective, it just saves nothing useful. Always do:
```js
const params = req.body?.args || req.body || {};
const { name, phone, ... } = params;
```

**A truthy phone check isn't enough — require a plausible number of digits.** `if (!phone)` lets an
obviously-incomplete number through (a caller cut off mid-number, e.g. `"778"`, 3 digits) — it
passed validation, got saved as the contact's real phone number, and the agent immediately ended
the call right after asking for the rest of it, before the caller could answer. Require at least 7
digits after stripping non-digit characters:
```js
const phoneDigits = (phone || '').replace(/\D/g, '');
if (phoneDigits.length < 7) {
  return res.status(200).json({ ok: false, message: 'That number sounded incomplete — ask the caller to repeat their full callback number before saving their details.' });
}
```

Add the new client's PIT as a Vercel env var on the `flashbooked` project (`GHL_PIT_<CLIENT>`),
same pattern as `GHL_PIT_WESTERN_RENEWABLES` / `GHL_PIT_CB_SCAFFOLDING`. `RETELL_API_KEY`,
`TWILIO_ACCOUNT_SID`, and `TWILIO_AUTH_TOKEN` should already be set on that project from earlier
builds — check before assuming you need to add them again.

### 5. The Retell conversation flow (prompt)

Read `references/prompt-template.md` for the full structure to clone — it's Aoife's actual proven
skeleton (role, speaking style, opening, domain-specific enquiry sections, urgent/safety handling,
existing customers, quotes, price questions, service area, human transfer, "if you don't know," AI
disclosure, interruptions, names/addresses/phones, conversation rules, example dialogues, end of
call) with the two hard-learned behavioral fixes already built in — don't start from a shorter
paraphrase, the section-by-section depth is what makes it sound like a real receptionist rather
than a generic bot.

**The opening line never includes a name.** Aoife never says "Aoife speaking" — she says "Hi,
[Business], how can I help?" The agent's dashboard/internal name (Sarah, Katie, whatever) is for
your own reference only, never spoken on the call.

**Node structure** (3 core nodes, function-based capture, matches
`flashbooked/api/*.js`'s single `capture_lead` tool):
```
Welcome Node (conversation) → Capture Lead (function) → Goodbye (conversation) → End Call (end)
```

Build this via `POST /create-conversation-flow`, then `POST /create-agent` referencing it.

### 6. The Retell agent settings — set these explicitly, don't rely on defaults

New agents do **not** inherit Aoife's tuning just because you copied her prompt structure. Every
one of these needs to be set on `create-agent` (or a follow-up `update-agent` + `publish-agent`):

| Setting | Value | Why |
|---|---|---|
| `voice_id` | `"retell-Willa"` | matches the house voice |
| `language` | `"en-GB"` | |
| `handbook_config` | `{"default_personality": true, "ai_disclosure": true}` | Retell's baseline "sound human" tuning layer — omitting this is a real, noticeable quality gap versus Aoife, confirmed by diffing two agent configs side by side |
| `interruption_sensitivity` | `0.9` | how fast the agent yields once the caller starts talking |
| `responsiveness` | `0.75` | how fast the agent replies after a pause — 1.0 (max) cuts callers off ~0.6s after asking a question; 0.5 produces 3-4.5s dead air. 0.75 is the working middle ground found by testing both extremes |
| `stt_mode` | `"custom"` | needed to set endpointing below |
| `custom_stt_config` | `{"provider": "deepgram", "endpointing_ms": 500}` | default fast STT mode fires on ~250ms pauses, which reads as end-of-turn during a hesitant multi-part answer like a phone number ("at... [pause] ...seven seven eight") and causes the agent to interrupt mid-answer. 500ms gives more room without feeling laggy |

`responsiveness` and `interruption_sensitivity` govern pacing *after* a turn is detected as over;
`custom_stt_config.endpointing_ms` governs *detecting* that the turn is over in the first place —
they're different failure modes and tuning one doesn't fix the other. If a caller keeps getting cut
off specifically on multi-part answers (phone numbers, addresses), it's the STT setting, not
responsiveness.

Also keep the phone-number question itself short in the prompt — a single clause ("What's the best
number for you?"), not a longer justified version ("...just in case the team needs to call you
back"). A longer question gives more time for the caller to start answering before the agent
finishes asking, which is exactly the collision that triggers interruptions.

**The Capture Lead node must not ask follow-up questions.** Its instruction should say: call the
tool, then say nothing more than a bare acknowledgment ("Perfect, thanks") — no "anything else?"
and no closing remarks. If it asks an open question there, the flow can transition toward ending
the call before the caller answers it, and the call ends mid-sentence.

**Getting the agent to actually say goodbye before hanging up** needs two separate fixes, both
already in this pattern — see `references/goodbye-node.md` for the full worked example and exact
JSON shape, because the API's validation is picky about this one:

1. A `type: "end"` node never generates speech, regardless of what its `instruction` says — it
   hangs up immediately on entry. Never point an edge directly at an end-type node from anywhere
   that needs a final spoken line; route through a `type: "conversation"` node that says the line
   first.
2. That conversation node then needs `skip_response_edge` set (not a normal `edges` entry) so it
   transitions immediately after speaking instead of waiting for a reply that will never come —
   the caller thinks the call is already over once they hear "bye." The transition condition's
   `prompt` field must be the **literal string `"Skip response"`** (a fixed marker Retell's schema
   validates against, not freeform text — confirmed by the API's own error message).

### 7. Twilio → Retell wiring

Reuse the existing "Retell AI" IP ACL (`AL5b2fb5cab7cb3cb86042a20125871cb0`) rather than creating a
new one — it already whitelists Retell's IPs.

```bash
# 1. Create a trunk
POST https://trunking.twilio.com/v1/Trunks
  FriendlyName=FlashBooked <Client>
  DomainName=flashbooked-<client>.pstn.twilio.com

# 2. Point it at Retell
POST .../Trunks/{sid}/OriginationUrls
  FriendlyName=Retell  SipUrl=sip:sip.retellai.com  Priority=1  Weight=1  Enabled=true

# 3. Attach the shared IP ACL
POST .../Trunks/{sid}/IpAccessControlLists
  IpAccessControlListSid=AL5b2fb5cab7cb3cb86042a20125871cb0

# 4. Assign the phone number to the trunk
POST .../Trunks/{sid}/PhoneNumbers
  PhoneNumberSid=<from GET /IncomingPhoneNumbers.json?PhoneNumber=...>

# 5. Clear any leftover demo Voice URL on the number — it can conflict with trunk-based routing
POST https://api.twilio.com/2010-04-01/Accounts/{sid}/IncomingPhoneNumbers/{numberSid}.json
  VoiceUrl=
```

Then import the number into Retell:
```
POST /import-phone-number
{
  "phone_number": "+353...",
  "termination_uri": "flashbooked-<client>.pstn.twilio.com",  // must match the trunk's DomainName
  "sip_trunk_auth_username": "", "sip_trunk_auth_password": "",
  "inbound_agents": [{"agent_id": "...", "weight": 1}],  // array — the older singular
                                                          // inbound_agent_id field is deprecated
                                                          // and the API now rejects it outright
  "nickname": "<Client> - <Agent name> - IE"
}
```

Publish the agent (`POST /publish-agent/{id}`) after any config or flow change — changes don't
reach live phone calls until published.

## Testing: pull the transcript, don't guess

You have no audio in/out — you cannot verify conversation quality yourself, and a browser-based
test-call feature is not worth building (see below). Ask for a real phone-call test, then debug
from Retell's own call records rather than guessing at what might be wrong:

```
POST /v2/list-calls  {"filter_criteria": {"agent_id": [...]}, "sort_order": "descending", "limit": 3}
GET /v2/get-call/{call_id}
```

`get-call` returns `transcript_with_tool_calls` — each utterance has `words[].start`/`words[].end`
in seconds. Compute the gap between one utterance ending and the next starting to diagnose timing
complaints precisely instead of guessing:
- gap **under ~0.5s** overlapping the caller's response start → interruption (tune STT endpointing
  or responsiveness, see the table above)
- gap **over ~1.5s** → dead air (responsiveness too low)
- check `tool_call_invocation`/`tool_call_result` entries to confirm `capture_lead` actually fired
  and succeeded, and check the resulting GHL contact directly (fetch it by the returned
  `contactId`) to confirm the data that landed matches what was said, not just that the tool
  reported `ok: true`

Don't build a browser "call to test" feature via the Retell Web SDK for internal testing — it was
tried and reverted. The SDK's own UMD build throws on load in a plain `<script>` tag (needs
jsDelivr's `+esm` bundle instead), and even once loading, getting microphone permission timing
right in a click handler is its own rabbit hole. A plain `tel:` link to the real number (same as
how Aoife is dialed from `flashbooked/index.html`) is simpler and already proven to work.

## Known issues already found and fixed — check here before re-diagnosing

| Symptom | Actual cause | Fix |
|---|---|---|
| Agent sounds noticeably worse/flatter than Aoife | `handbook_config` unset (doesn't default to Aoife's setting) | set explicitly, see table above |
| Agent talks over the caller mid-answer, especially on phone numbers | STT endpointing fires on short in-answer pauses (default ~250ms) | `stt_mode: "custom"`, `endpointing_ms: 500` |
| Agent replies noticeably slowly, dead air | `responsiveness` too low | raise toward 0.75-1, balance against the interruption issue above |
| Agent saves a 2-4 digit phone fragment as real data | endpoint only checked `!phone`, not digit count | `phoneDigits.length < 7` check |
| Agent asks "anything else?" then hangs up before you can answer | Capture Lead node instruction wasn't restricted, raced the End Call transition | restrict Capture Lead node to a bare acknowledgment only |
| Agent never says goodbye, or says it then never actually hangs up | `end`-type nodes don't speak; `conversation`-type nodes wait for a reply before advancing | goodbye conversation node + `skip_response_edge`, see step 6 |
| `capture_lead` tool always reports missing fields even though the caller said them | destructuring `req.body` instead of `req.body.args` | see the endpoint template |
| GHL location comes back mislabeled as US for a non-US client | `country` omitted from `/api/provision` call | pass `country` explicitly |
| `POST /opportunities/pipelines` 401s | used the agency PIT instead of the new sub-account's own PIT | wait for Adam to generate and share the sub-account's PIT |
