#Requires -Version 5.1
<#
  Starts a local LiteLLM proxy in front of Google AI Studio (Gemini).

  Exposes, for the Meeting Agent app:
      POST /v1/chat/completions        -> gemini-chat
      POST /v1/audio/transcriptions    -> gemini-transcribe

  Binds to 127.0.0.1 only. The app explicitly permits http://localhost
  (src/agent/provider.ts, endpoint()) while rejecting other plain-HTTP hosts,
  so this works without touching application code.

  Usage:  .\start.ps1
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:LITELLM_PORT) { $env:LITELLM_PORT } else { '4000' }

# Python defaults to the system locale encoding (GBK on Chinese Windows) when
# reading files. Force UTF-8 so a stray non-ASCII byte in config.yaml can never
# crash startup with UnicodeDecodeError again.
$env:PYTHONUTF8 = '1'

# --- 0. trust the machine's own certificate store ---------------------------
# Antivirus HTTPS scanning (Kaspersky here) re-signs TLS with its own root CA.
# curl uses the Windows store and works; Python uses the bundled certifi list and
# fails with CERTIFICATE_VERIFY_FAILED. Export the Windows store and point Python
# at it - this still VERIFIES certificates, just against the right bundle.
$caBundle = Join-Path $here 'windows-cas.pem'
if (-not (Test-Path $caBundle)) {
  Write-Host "Exporting the Windows certificate store to windows-cas.pem..." -ForegroundColor DarkGray
  $sb = New-Object System.Text.StringBuilder
  foreach ($store in 'Cert:\LocalMachine\Root', 'Cert:\LocalMachine\CA') {
    Get-ChildItem $store -ErrorAction SilentlyContinue | ForEach-Object {
      [void]$sb.AppendLine("# $($_.Subject)")
      [void]$sb.AppendLine("-----BEGIN CERTIFICATE-----")
      $b64 = [Convert]::ToBase64String($_.RawData)
      for ($i = 0; $i -lt $b64.Length; $i += 64) {
        [void]$sb.AppendLine($b64.Substring($i, [Math]::Min(64, $b64.Length - $i)))
      }
      [void]$sb.AppendLine("-----END CERTIFICATE-----")
    }
  }
  [IO.File]::WriteAllText($caBundle, $sb.ToString())
}
$env:SSL_CERT_FILE = $caBundle
$env:REQUESTS_CA_BUNDLE = $caBundle
$env:CURL_CA_BUNDLE = $caBundle

# --- 1. load the key --------------------------------------------------------
$envFile = Join-Path $here 'provider.env'
if (-not (Test-Path $envFile)) {
  Write-Host "Missing provider.env" -ForegroundColor Red
  Write-Host "Run:  Copy-Item provider.env.example provider.env   then paste your key into it." -ForegroundColor Yellow
  exit 1
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$') {
    Set-Item -Path "Env:$($matches[1])" -Value $matches[2]
  }
}

# config.yaml needs both: DeepSeek for understanding, OpenAI for transcription.
$missing = @()
if (-not $env:DEEPSEEK_API_KEY) { $missing += 'DEEPSEEK_API_KEY' }
if (-not $env:OPENAI_API_KEY) { $missing += 'OPENAI_API_KEY' }
if ($missing.Count) {
  Write-Host ("provider.env is missing: " + ($missing -join ', ')) -ForegroundColor Red
  exit 1
}

# Show enough to confirm the right keys are loaded, never the whole thing.
foreach ($name in 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY') {
  $k = [Environment]::GetEnvironmentVariable($name, 'Process')
  $preview = if ($k.Length -ge 12) { $k.Substring(0, 6) + '...' + $k.Substring($k.Length - 4) } else { '(unusually short)' }
  Write-Host ("Loaded {0} {1}  ({2} chars)" -f $name, $preview, $k.Length) -ForegroundColor DarkGray
  if ($k.Length -lt 30) { Write-Host "  ^ looks too short; double-check provider.env" -ForegroundColor Yellow }
}

# --- 2. ensure litellm is installed ----------------------------------------
$litellm = Get-Command litellm -ErrorAction SilentlyContinue
if (-not $litellm) {
  Write-Host "litellm not found - installing litellm[proxy], this takes a minute..." -ForegroundColor Yellow
  pip install "litellm[proxy]"
  $litellm = Get-Command litellm -ErrorAction SilentlyContinue
  if (-not $litellm) {
    Write-Host "Install finished but litellm is still not on PATH. Open a new terminal and retry." -ForegroundColor Red
    exit 1
  }
}

# --- 3. start ---------------------------------------------------------------
Write-Host ""
Write-Host "LiteLLM listening on http://127.0.0.1:$port" -ForegroundColor Green
Write-Host "  master key  sk-1234            -> set this as OPENAI_API_KEY in the app's .env"
Write-Host "  chat        meeting-chat       -> set this as MEETING_MODEL"
Write-Host "  transcribe  meeting-transcribe -> set this as MEETING_STT_MODEL"
Write-Host ""
Write-Host "Both MEETING_API_BASE and MEETING_STT_API_BASE go to http://127.0.0.1:$port/v1"
Write-Host "Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

& $litellm.Source --config (Join-Path $here 'config.yaml') --host 127.0.0.1 --port $port
