import type { ElectronApplication } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export async function cleanupElectron(app: ElectronApplication | undefined, directory?: string) {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app?.close();
  if (!directory) return;
  const target = resolve(directory);
  if (
    dirname(target).toLowerCase() !== resolve(tmpdir()).toLowerCase() ||
    !/^meeting-(desktop|provider-test|live-stt|interface|reliability-ui)-/.test(basename(target))
  )
    throw new Error('INVALID_TEST_CLEANUP_PATH');
  // Windows Chromium helpers may release database handles just after the main process exits.
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
