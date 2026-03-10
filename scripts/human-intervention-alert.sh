#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

message="${1:-<ALERT> human intervention required}"

# Always notify on Telegram when configured.
bash "${ROOT_DIR}/scripts/telegram-notify.sh" "${message}" || true

# Optional generic WhatsApp webhook fallback.
if [[ -n "${WHATSAPP_ALERT_WEBHOOK_URL:-}" ]]; then
  curl -sS --fail -X POST "${WHATSAPP_ALERT_WEBHOOK_URL}" \
    --data-urlencode "text=${message}" >/dev/null
  echo "human-intervention-alert: WhatsApp webhook notified."
  exit 0
fi

# Optional Twilio WhatsApp fallback.
if [[ -n "${TWILIO_ACCOUNT_SID:-}" && -n "${TWILIO_AUTH_TOKEN:-}" && -n "${TWILIO_WHATSAPP_FROM:-}" && -n "${WHATSAPP_TO:-}" ]]; then
  curl -sS --fail -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
    -X POST "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json" \
    --data-urlencode "From=whatsapp:${TWILIO_WHATSAPP_FROM}" \
    --data-urlencode "To=whatsapp:${WHATSAPP_TO}" \
    --data-urlencode "Body=${message}" >/dev/null
  echo "human-intervention-alert: Twilio WhatsApp notified."
  exit 0
fi

echo "human-intervention-alert: no WhatsApp config found; Telegram notification sent."
