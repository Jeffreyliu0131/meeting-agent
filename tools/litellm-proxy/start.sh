#!/usr/bin/env bash
# macOS / Linux counterpart of start.ps1.
#
# Exposes DeepSeek (understanding) and OpenAI (transcription) in OpenAI wire
# shape for the Meeting Agent app. Binds to 127.0.0.1 only - the app explicitly
# permits http://localhost while rejecting other plain-HTTP hosts.
#
# Usage:  chmod +x start.sh && ./start.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port="${LITELLM_PORT:-4000}"

# Python reads files as UTF-8 by default on macOS, so unlike Windows there is no
# GBK trap here. Kept anyway so both platforms behave identically.
export PYTHONUTF8=1

# macOS does not need the Windows certificate-store export: that exists only
# because antivirus HTTPS scanning re-signs TLS on the Windows machine. If a
# corporate proxy does intercept traffic here, export its CA and set:
#   export SSL_CERT_FILE=/path/to/ca.pem
# Do NOT set ssl_verify=false instead - that disables verification entirely.

env_file="$here/provider.env"
if [ ! -f "$env_file" ]; then
  echo "Missing provider.env" >&2
  echo "Run:  cp provider.env.example provider.env   then paste your keys." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; . "$env_file"; set +a

missing=()
[ -n "${DEEPSEEK_API_KEY:-}" ] || missing+=("DEEPSEEK_API_KEY")
[ -n "${OPENAI_API_KEY:-}" ] || missing+=("OPENAI_API_KEY")
if [ ${#missing[@]} -gt 0 ]; then
  echo "provider.env is missing: ${missing[*]}" >&2
  exit 1
fi

for name in DEEPSEEK_API_KEY OPENAI_API_KEY; do
  v="${!name}"
  printf 'Loaded %s %s...%s  (%d chars)\n' "$name" "${v:0:6}" "${v: -4}" "${#v}"
done

if ! command -v litellm >/dev/null 2>&1; then
  echo "litellm not found - installing litellm[proxy]..." >&2
  python3 -m pip install "litellm[proxy]"
fi

echo
echo "LiteLLM listening on http://127.0.0.1:$port"
echo "  master key  sk-1234            -> set this as OPENAI_API_KEY in the app's .env"
echo "  chat        meeting-chat       -> set this as MEETING_MODEL"
echo "  transcribe  meeting-transcribe -> set this as MEETING_STT_MODEL"
echo
echo "Ctrl+C to stop."
echo

exec litellm --config "$here/config.yaml" --host 127.0.0.1 --port "$port"
