import dotenv from 'dotenv';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Supervises a local LiteLLM proxy so the desktop app can be started on its own,
 * with no terminal step.
 *
 * This is deliberately OPT-IN (MEETING_AUTOSTART_PROXY=1) and dev-only. The
 * product talks to any OpenAI-compatible provider through ModelPort and
 * credentials; a local Python proxy is a property of one developer's machine,
 * not a product capability. Leaving it off by default keeps that boundary.
 *
 * It also never blocks startup: if the proxy cannot be started, the app still
 * opens and shows its normal "provider not connected" state, which is honest.
 */

let child: ChildProcess | null = null;
let stopping = false;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** True when the app is pointed at a loopback endpoint, i.e. a local proxy. */
export function usesLocalEndpoint(base: string): boolean {
  try {
    return LOOPBACK.has(new URL(base).hostname);
  } catch {
    return false;
  }
}

function parseEnvFile(path: string): Record<string, string> {
  return dotenv.parse(readFileSync(path));
}

async function healthy(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/readiness`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export type ProxyStart = { started: true; port: number } | { started: false; reason: string };

/**
 * Starts the proxy if it is not already running. A proxy already listening is a
 * success, not a conflict: the user may have started it themselves, and the app
 * must adopt it rather than fight over the port.
 */
export async function startLocalProxy(
  base: string,
  log: (message: string) => void = () => {},
): Promise<ProxyStart> {
  if (process.env.MEETING_AUTOSTART_PROXY !== '1')
    return { started: false, reason: 'AUTOSTART_DISABLED' };
  if (!usesLocalEndpoint(base)) return { started: false, reason: 'REMOTE_PROVIDER' };

  stopping = false;
  let port: number;
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' || url.username || url.password)
      return { started: false, reason: 'INVALID_BASE' };
    port = Number(url.port || 80);
  } catch {
    return { started: false, reason: 'INVALID_BASE' };
  }
  if (await healthy(port, 1500)) {
    if (stopping) return { started: false, reason: 'START_CANCELLED' };
    log(`local proxy already running on ${port}`);
    return { started: true, port };
  }

  // Repo-relative, because the repository must not depend on a parent directory
  // (AGENTS.md). Only meaningful for a dev run from the repo root: a packaged app
  // ships dist/ alone and is not expected to autostart a local proxy anyway.
  if (stopping) return { started: false, reason: 'START_CANCELLED' };
  const dir = process.env.MEETING_PROXY_DIR
    ? resolve(process.env.MEETING_PROXY_DIR)
    : resolve(process.cwd(), 'tools', 'litellm-proxy');
  if (!existsSync(join(dir, 'config.yaml')))
    return { started: false, reason: 'PROXY_DIR_NOT_FOUND' };

  const keyFile = join(dir, 'provider.env');
  if (!existsSync(keyFile)) return { started: false, reason: 'PROVIDER_ENV_MISSING' };
  const keys = parseEnvFile(keyFile);
  const originalLog = log;
  log = (message) =>
    originalLog(
      Object.values(keys)
        .filter((v) => v.length >= 4)
        .reduce((text, key) => text.split(key).join('[redacted]'), message),
    );
  if (!keys.DEEPSEEK_API_KEY && !keys.OPENAI_API_KEY)
    return { started: false, reason: 'PROVIDER_KEYS_MISSING' };

  // Generated on demand rather than assumed: a fresh clone has no bundle, and
  // without it the failure surfaces as an opaque CERTIFICATE_VERIFY_FAILED.
  const caBundle = await ensureCaBundle(dir);
  if (caBundle) log('Python TLS will trust the Windows certificate store');

  const launcher = await resolveLitellm(dir, log);
  if ('error' in launcher) return { started: false, reason: launcher.error };
  if (stopping) return { started: false, reason: 'START_CANCELLED' };

  try {
    child = spawn(
      launcher.command,
      // Relative config path with cwd set: no quoting problems with spaces, and
      // the same arguments work on both platforms.
      ['--config', 'config.yaml', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: dir,
        // .cmd shims need a shell on Windows; the binary is directly runnable elsewhere.
        shell: launcher.shell,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...keys,
          PYTHONUTF8: '1',
          ...(caBundle ? { SSL_CERT_FILE: caBundle, REQUESTS_CA_BUNDLE: caBundle } : {}),
        },
      },
    );
  } catch (error) {
    return {
      started: false,
      reason: error instanceof Error ? error.message : 'SPAWN_FAILED',
    };
  }

  const ownedChild = child;
  child.on('error', () => log('[proxy] process failed to start'));
  child.stdout?.on('data', (d: Buffer) => log(`[proxy] ${d.toString().trimEnd()}`));
  child.stderr?.on('data', (d: Buffer) => log(`[proxy] ${d.toString().trimEnd()}`));
  child.on('exit', (code) => {
    // Only report an unexpected exit; a deliberate stop is not a failure.
    if (!stopping) log(`[proxy] exited with code ${code}`);
    if (child === ownedChild) child = null;
  });

  if (await healthy(port, 30000)) {
    log(`local proxy started on ${port}`);
    return { started: true, port };
  }
  stopLocalProxy();
  return { started: false, reason: 'PROXY_UNHEALTHY' };
}

const isWindows = process.platform === 'win32';

function run(
  command: string,
  args: string[],
  cwd: string,
  log: (message: string) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 120000);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    child.on('exit', (code) => done(code === 0));
    child.on('error', () => done(false));
  });
}

function venvBinary(dir: string, name: string): string {
  return isWindows ? join(dir, '.venv', 'Scripts', `${name}.exe`) : join(dir, '.venv', 'bin', name);
}

/**
 * Finds litellm, installing it into a PRIVATE venv if it is nowhere to be found.
 *
 * A venv rather than a system install on purpose: current macOS ships a
 * Homebrew Python that refuses `pip install` outright with
 * externally-managed-environment (PEP 668), so a "just pip install it" would
 * fail on exactly the platform this needs to work on. A venv under the proxy
 * directory also cannot disturb whatever else the machine uses Python for.
 *
 * An existing PATH install is preferred and left alone, so a machine that
 * already has it (the Windows dev box) is not rebuilt.
 */
async function resolveLitellm(
  dir: string,
  log: (message: string) => void,
): Promise<{ command: string; shell: boolean } | { error: string }> {
  const local = venvBinary(dir, 'litellm');
  if (existsSync(local)) return { command: local, shell: false };

  const probe = await run(isWindows ? 'litellm' : 'litellm', ['--version'], dir, log);
  if (probe) return { command: 'litellm', shell: isWindows };

  log('litellm not found - creating a private virtualenv (first run only, ~1 minute)');
  const python = isWindows ? 'python' : 'python3';
  if (!(await run(python, ['-m', 'venv', '.venv'], dir, log)))
    return { error: 'VENV_CREATE_FAILED' };

  log('installing litellm[proxy] into .venv');
  const venvPython = venvBinary(dir, 'python');
  if (!(await run(venvPython, ['-m', 'pip', 'install', '--quiet', 'litellm[proxy]'], dir, log)))
    return { error: 'PIP_INSTALL_FAILED' };

  if (!existsSync(local)) return { error: 'LITELLM_MISSING_AFTER_INSTALL' };
  log('litellm installed');
  return { command: local, shell: false };
}

/**
 * Antivirus HTTPS scanning re-signs TLS with its own root CA. curl reads the
 * Windows store and works; Python reads the bundled certifi list and fails with
 * CERTIFICATE_VERIFY_FAILED - a message that says nothing about the real cause.
 * Exporting the store and pointing Python at it keeps verification ON, unlike
 * ssl_verify=false.
 *
 * Windows-only by nature: macOS has no store to export and does not need this.
 * Generated on demand so a fresh clone works with no manual step.
 */
async function ensureCaBundle(dir: string): Promise<string | null> {
  const bundle = join(dir, 'windows-cas.pem');
  if (existsSync(bundle)) return bundle;
  if (process.platform !== 'win32') return null;

  const script = [
    '$sb = New-Object System.Text.StringBuilder',
    "foreach ($s in 'Cert:\\LocalMachine\\Root','Cert:\\LocalMachine\\CA') {",
    '  Get-ChildItem $s -ErrorAction SilentlyContinue | ForEach-Object {',
    '    [void]$sb.AppendLine("# $($_.Subject)")',
    "    [void]$sb.AppendLine('-----BEGIN CERTIFICATE-----')",
    '    $b64 = [Convert]::ToBase64String($_.RawData)',
    '    for ($i=0; $i -lt $b64.Length; $i+=64) { [void]$sb.AppendLine($b64.Substring($i,[Math]::Min(64,$b64.Length-$i))) }',
    "    [void]$sb.AppendLine('-----END CERTIFICATE-----')",
    '  }',
    '}',
    '[IO.File]::WriteAllText($env:MEETING_CA_OUT, $sb.ToString())',
  ].join('\n');

  await new Promise<void>((resolve) => {
    const ps = spawn(
      'powershell',
      // -Command rather than a script file, so no execution-policy flag is needed.
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, MEETING_CA_OUT: bundle }, stdio: 'ignore' },
    );
    ps.on('exit', () => resolve());
    ps.on('error', () => resolve());
  });

  if (existsSync(bundle)) return bundle;
  // Not fatal: without a bundle the proxy still starts. The upstream calls are
  // what fail, and their error is reported through the normal call path.
  return null;
}

/** Idempotent, and safe to call from a process-exit handler. */
export function stopLocalProxy(): void {
  stopping = true;
  const running = child;
  if (!running) return;
  child = null;
  try {
    running.kill();
  } catch {
    // Already gone.
  }
}
