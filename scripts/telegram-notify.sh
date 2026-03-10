#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "telegram-notify: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured; skipping."
  exit 0
fi

default_message="✅ Task completed in $(basename "${ROOT_DIR}") on $(date '+%Y-%m-%d %H:%M:%S %Z')"
message="${1:-${default_message}}"

curl -sS --fail \
  -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${message}" \
  -d "disable_web_page_preview=true" >/dev/null

echo "telegram-notify: sent."
