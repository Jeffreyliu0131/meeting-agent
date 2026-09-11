import { _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'meeting-package-smoke-'));
const application = await electron.launch({
  executablePath: resolve('release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent'),
  args: [],
  env: { ...process.env, MEETING_DATA_DIR: dir, OPENAI_API_KEY: '', MEETING_STT_API_KEY: '' },
});
try {
  let page;
  for (let i = 0; i < 30; i++) {
    page = (await application.windows()).find((p) => p.url().includes('role=workspace'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error('Workspace missing');
  let state;
  for (let i = 0; i < 30; i++) {
    try {
      state = await page.evaluate(() => window.meeting.call('snapshot'));
      if (state.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!state?.ok) throw new Error('Service not available from packaged app');
  const platform = await page.evaluate(() => window.meeting.call('platform'));
  const result = {
    packaged: true,
    platform: platform.value.os,
    release: platform.value.release,
    microphonePermission: platform.value.microphone,
    screenPermission: platform.value.screen,
    events: state.value.meetings.length,
    modelConfigured: state.value.capabilities.modelConfigured,
    rawAudioCaptured: false,
    ranAt: new Date().toISOString(),
  };
  writeFileSync('tests/results/package-smoke.json', JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
