/** Explicit local device probe: 3 seconds, no audio file and no provider request. */
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'meeting-real-mic-probe-'));
const application = await electron.launch({
  executablePath: resolve('release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent'),
  args: [],
  env: { ...process.env, MEETING_DATA_DIR: dir, OPENAI_API_KEY: '', MEETING_STT_API_KEY: '' },
});
try {
  let page, capture;
  for (let i = 0; i < 30; i++) {
    const pages = await application.windows();
    page = pages.find((p) => p.url().includes('role=workspace'));
    capture = pages.find((p) => p.url().includes('capture.html'));
    if (page && capture) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForFunction(() => !!window.meeting);
  const permissions = await page.evaluate(() => window.meeting.call('platform'));
  if (permissions.value.microphone !== 'granted')
    throw new Error(
      'Existing microphone permission is not granted; no permission change requested.',
    );
  const created = await page.evaluate(() =>
    window.meeting.call('command', {
      id: crypto.randomUUID(),
      meetingId: null,
      type: 'create',
      payload: {
        title: 'Local device probe, no transcript or model',
        mode: 'microphone',
        outputLocale: 'en',
        timezone: 'Asia/Singapore',
      },
    }),
  );
  if (!created.ok) throw new Error(created.error);
  const result = await capture.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const context = new AudioContext();
    try {
      const source = context.createMediaStreamSource(stream),
        analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      await context.resume();
      const levels = [],
        samples = new Float32Array(analyser.fftSize);
      for (let i = 0; i < 30; i++) {
        analyser.getFloatTimeDomainData(samples);
        levels.push(Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / samples.length));
        await new Promise((r) => setTimeout(r, 100));
      }
      return {
        audioTracks: stream.getAudioTracks().length,
        sampleRate: context.sampleRate,
        contextState: context.state,
        peakRms: Math.max(...levels),
        meanRms: levels.reduce((a, b) => a + b, 0) / levels.length,
      };
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
    }
  });
  const report = {
    ...result,
    realPhysicalMicrophone: true,
    seconds: 3,
    providerCalls: 0,
    rawAudioSaved: false,
    speechRecognitionTested: false,
    multispeakerQualityTested: false,
    screenPermission: permissions.value.screen,
    ranAt: new Date().toISOString(),
  };
  writeFileSync('tests/results/microphone-probe.json', JSON.stringify(report, null, 2));
  console.log(report);
} finally {
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
