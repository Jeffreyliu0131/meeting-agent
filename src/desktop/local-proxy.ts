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
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line);
    if (match) out[match[1]] = match[2];
  }
  return out;
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

export type ProxyStart =
  | { started: true; port: number }
  | { started: false; reason: string };

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

  let port: number;
  try {
    port = Number(new URL(base).port || 80);
  } catch {
    return { started: false, reason: 'INVALID_BASE' };
  }
  if (await healthy(port, 1500)) {
    log(`local proxy already running on ${port}`);
    return { started: true, port };
  }

  // Repo-relative, because the repository must not depend on a parent directory
  // (AGENTS.md). Only meaningful for a dev run from the repo root: a packaged app
  // ships dist/ alone and is not expected to autostart a local proxy anyway.
  const dir = process.env.MEETING_PROXY_DIR
    ? resolve(process.env.MEETING_PROXY_DIR)
    : resolve(process.cwd(), 'tools', 'litellm-proxy');
  if (!existsSync(join(dir, 'config.yaml')))
    return { started: false, reason: 'PROXY_DIR_NOT_FOUND' };

  const keyFile = join(dir, 'provider.env');
  if (!existsSync(keyFile)) return { started: false, reason: 'PROVIDER_ENV_MISSING' };
  const keys = parseEnvFile(keyFile);
  if (!keys.DEEPSEEK_API_KEY && !keys.OPENAI_API_KEY)
    return { started: false, reason: 'PROVIDER_KEYS_MISSING' };

  // Antivirus HTTPS scanning re-signs TLS; Python needs the Windows store
  // exported as a bundle. start.ps1 writes this file. Absent elsewhere, and
  // harmless on macOS where the interception does not happen.
  const caBundle = join(dir, 'windows-cas.pem');

  try {
    child = spawn(
      'litellm',
      // Relative config path with cwd set: no quoting problems with spaces, and
      // the same arguments work on both platforms.
      ['--config', 'config.yaml', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: dir,
        // .cmd shims need a shell on Windows; the binary is directly runnable elsewhere.
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...keys,
          PYTHONUTF8: '1',
          ...(existsSync(caBundle)
            ? { SSL_CERT_FILE: caBundle, REQUESTS_CA_BUNDLE: caBundle }
            : {}),
        },
      },
    );
  } catch (error) {
    return {
      started: false,
      reason: error instanceof Error ? error.message : 'SPAWN_FAILED',
    };
  }

  child.stdout?.on('data', (d: Buffer) => log(`[proxy] ${d.toString().trimEnd()}`));
  child.stderr?.on('data', (d: Buffer) => log(`[proxy] ${d.toString().trimEnd()}`));
  child.on('exit', (code) => {
    // Only report an unexpected exit; a deliberate stop is not a failure.
    if (!stopping) log(`[proxy] exited with code ${code}`);
    child = null;
  });

  if (await healthy(port, 30000)) {
    log(`local proxy started on ${port}`);
    return { started: true, port };
  }
  stopLocalProxy();
  return { started: false, reason: 'PROXY_UNHEALTHY' };
}

/** Idempotent, and safe to call from a process-exit handler. */
export function stopLocalProxy(): void {
  const running = child;
  if (!running) return;
  stopping = true;
  child = null;
  try {
    running.kill();
  } catch {
    // Already gone.
  }
}
