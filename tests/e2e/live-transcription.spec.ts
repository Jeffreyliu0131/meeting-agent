import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanupElectron } from './cleanup';

// Synthetic oscillator + local protocol server. No real microphone or external API.
test('live audio shows drafts, drains short tails on pause/end, and resumes with a new connection', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  let connections = 0,
    app: ElectronApplication | undefined;
  const audioLengths: number[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), 'meeting-live-stt-'));
  server.on('connection', (ws) => {
    const connection = ++connections;
    let item = 0,
      draft = false;
    ws.on('message', (bytes) => {
      const e = JSON.parse(bytes.toString());
      if (e.type === 'session.update') ws.send(JSON.stringify({ type: 'session.updated' }));
      if (e.type === 'input_audio_buffer.append') {
        audioLengths.push(Buffer.from(e.audio, 'base64').length);
        if (!draft) {
          draft = true;
          ws.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.delta',
              item_id: `item-${item}`,
              delta: 'Synthetic provisional words',
            }),
          );
        }
      }
      if (e.type === 'input_audio_buffer.commit') {
        const item_id = `item-${item++}`;
        draft = false;
        ws.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id }));
        setTimeout(
          () =>
            ws.send(
              JSON.stringify({
                type: 'conversation.item.input_audio_transcription.completed',
                item_id,
                transcript: `Synthetic final words ${connection}`,
              }),
            ),
          100,
        );
      }
    });
  });
  try {
    app = await electron.launch({
      args: [resolve('.')],
      env: {
        ...process.env,
        MEETING_DATA_DIR: dataDir,
        MEETING_SYSTEM_LOCALE: 'en',
        OPENAI_API_KEY: '',
        MEETING_STT_API_KEY: 'test-only',
        MEETING_STT_MODEL: 'gpt-live-transcribe',
        MEETING_STT_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
        MEETING_DEV_INPUTS: '1',
      },
    });
    let page!: Page, capture!: Page;
    await expect
      .poll(async () => {
        const windows = await app!.windows();
        page = windows.find((p) => p.url().includes('role=workspace'))!;
        capture = windows.find((p) => p.url().includes('capture.html'))!;
        return !!page && !!capture;
      })
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('role=workspace'))
        ?.show(),
    );
    await capture.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext(),
          oscillator = ctx.createOscillator(),
          output = ctx.createMediaStreamDestination();
        oscillator.connect(output);
        oscillator.start();
        await ctx.resume();
        (window as any).testTrack = output.stream.getAudioTracks()[0];
        (window as any).testContexts ??= [];
        (window as any).testContexts.push(ctx);
        return output.stream;
      };
    });
    await page.getByRole('button', { name: 'Start meeting' }).first().click();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Start meeting' }).first().click();
    const initial = await page.evaluate(() => window.meeting.call('snapshot'));
    const id = initial.value.meetings[0].id;
    await expect
      .poll(async () => {
        const state = await page.evaluate(() => window.meeting.call('snapshot'));
        return {
          capture: state.value.meetings[0].capture,
          error: state.value.meetings[0].captureError,
        };
      })
      .toEqual({ capture: 'capturing', error: null });
    await expect(page.getByText(/Synthetic provisional words/)).toBeVisible();
    expect(audioLengths[0]).toBeLessThanOrEqual(5000);
    let state = await page.evaluate(() => window.meeting.call('snapshot'));
    expect(state.value.meetings[0].segments).toHaveLength(0);
    const paused = await page.evaluate(
      (id) => window.meeting.call('capture', { action: 'pause', meetingId: id }),
      id,
    );
    expect(paused.ok).toBe(true);
    state = await page.evaluate(() => window.meeting.call('snapshot'));
    expect(state.value.liveTranscripts).toHaveLength(0);
    expect(state.value.meetings[0].segments[0].text).toBe('Synthetic final words 1');
    expect(state.value.meetings[0].inputGaps).toHaveLength(0);
    expect(await capture.evaluate(() => (window as any).testTrack.readyState)).toBe('ended');
    await page.evaluate(
      (id) => window.meeting.call('capture', { action: 'start', meetingId: id }),
      id,
    );
    await expect(page.getByText(/Synthetic provisional words/)).toBeVisible();
    // A previous drain watchdog must not stop newly resumed input.
    await page.waitForTimeout(2200);
    expect(await capture.evaluate(() => (window as any).testTrack.readyState)).toBe('live');
    const ended = await page.evaluate(
      (id) =>
        window.meeting.call('command', {
          id: crypto.randomUUID(),
          meetingId: id,
          type: 'end',
          payload: {},
        }),
      id,
    );
    expect(ended.ok).toBe(true);
    state = await page.evaluate(() => window.meeting.call('snapshot'));
    expect(state.value.meetings[0].segments.map((s: any) => s.text)).toEqual([
      'Synthetic final words 1',
      'Synthetic final words 2',
    ]);
    expect(state.value.meetings[0].inputGaps).toHaveLength(0);
    expect(
      state.value.meetings[0].calls
        .filter((c: any) => c.kind === 'transcribe')
        .every((c: any) => c.audioSeconds > 0),
    ).toBe(true);
    expect(connections).toBe(2);
    expect(await capture.evaluate(() => (window as any).testTrack.readyState)).toBe('ended');
    await capture.evaluate(() =>
      Promise.all((window as any).testContexts.map((ctx: AudioContext) => ctx.close())),
    );
  } finally {
    await cleanupElectron(app, dataDir);
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
