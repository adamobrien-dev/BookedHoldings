#!/bin/bash
# Run this once to sync all env vars to Vercel production.
# Usage: VERCEL_TOKEN=your_token bash scripts/set-vercel-env.sh

TOKEN="${VERCEL_TOKEN:?Set VERCEL_TOKEN}"
PROJECT="prj_5Ur5IuNJOCcEVwwcvRvv9EqVKNr1"
TEAM="team_Ee21S08M7ebY2ZUpGIcZnLI4"

set_env() {
  local key="$1" val="$2"
  curl -sf -X POST "https://api.vercel.com/v10/projects/${PROJECT}/env?teamId=${TEAM}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"${key}\",\"value\":\"${val}\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\"]}" \
    > /dev/null && echo "✅ ${key}" || echo "⚠️  ${key} (may already exist — update manually if needed)"
}

set_env DROPBOX_SIGN_API_KEY    "1243371e31240ba90848514ddf2baa36f84537d60b3065aa9a7e227524385068"
set_env META_SYSTEM_TOKEN       "EAHZBk0XzvOTsBRsOlUWOfo2ZCFhtGobe8ZCbskYS4VyqsuZCWKDq8IiCIZBPoCQnuOdqYRKiU8qrdYXi2Fd2CVadrlCS8ZAxZBktDNHKNLtPbSfULo79nJDrJCFiD84H9yClP1RuxrBYyXcSrZBxDZCJoZAin9jKa9KVu1PKpM6nj6CeBMYmHUW0jlHMIDpdMFzvtw5wZDZD"
set_env GHL_PIT_AGENCY          "pit-6aacb9ad-ed6a-4266-beb3-e261c49afe6b"
set_env GHL_COMPANY_ID          "MSYotuf1a5FAsGdPRMfP"
set_env GHL_PIT_TERRI           "pit-24605178-993f-438a-867e-70e7586ddd2c"
set_env GHL_PIT_ALLAPHIA        "pit-38331ef9-0e08-476c-ba9c-b25ddd951aee"
set_env GHL_PIT_THANIA          "pit-194e1e0c-1a90-432e-8841-8db3f1fd864b"
set_env GHL_PIT_AGUILERA        "pit-4eaa170b-6379-40fd-8e09-e0483c97d31e"
set_env GHL_PIT_GLENDALE        "pit-a41f6a22-9043-4c03-9054-f7e9653db059"
set_env TELEGRAM_JORDAN_TOKEN   "8771494231:AAFT_ZRdsbWSwdKwIJaWDtpzQAtBxLAgPe0"
set_env TELEGRAM_MORGAN_TOKEN   "8899483749:AAGXZdCVRo3jaThfyMpZfaJMNlCessVFMrM"
set_env TELEGRAM_ALEX_TOKEN     "8905096760:AAHXlji_ikvc5ZMxJeJm1Pv-TyjdfNd6p3c"
set_env TELEGRAM_RILEY_TOKEN    "8702295549:AAGg89jbz2VlV4TvoH4DCgbuYRNSmUUr7YQ"
set_env TELEGRAM_CASEY_TOKEN    "8699165857:AAFYiekbfu_yZ77WUoHIBgB03KF3SL4Wtik"
set_env TELEGRAM_CHAT_ID        "6472421098"
set_env RTB_LOCATION_ID         "jXhJSq0AENZ4RGbeT4O7"

echo ""
echo "Done. Redeploy Vercel for env vars to take effect:"
echo "  Push any commit, or run: curl -X POST https://api.vercel.com/v13/deployments ..."
