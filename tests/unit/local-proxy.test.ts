import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startLocalProxy, stopLocalProxy, usesLocalEndpoint } from '../../src/desktop/local-proxy';

test('proxy is opt-in, loopback only, and cancellation during startup cannot spawn later', async () => {
  const before = process.env.MEETING_AUTOSTART_PROXY;
  try {
    delete process.env.MEETING_AUTOSTART_PROXY;
    assert.deepEqual(await startLocalProxy('http://127.0.0.1:1'), {
      started: false,
      reason: 'AUTOSTART_DISABLED',
    });
    process.env.MEETING_AUTOSTART_PROXY = '1';
    assert.equal((await startLocalProxy('https://example.invalid')).started, false);
    assert.equal(usesLocalEndpoint('https://localhost.example.invalid'), false);
    assert.deepEqual(await startLocalProxy('http://name:secret@localhost:4000'), {
      started: false,
      reason: 'INVALID_BASE',
    });
    const pending = startLocalProxy('http://127.0.0.1:1');
    stopLocalProxy();
    assert.deepEqual(await pending, { started: false, reason: 'START_CANCELLED' });
  } finally {
    if (before === undefined) delete process.env.MEETING_AUTOSTART_PROXY;
    else process.env.MEETING_AUTOSTART_PROXY = before;
  }
});

test(
  'owned local proxy handles a path with spaces and never logs configured key values',
  { skip: process.platform === 'win32' },
  async () => {
    const previous = {
      auto: process.env.MEETING_AUTOSTART_PROXY,
      dir: process.env.MEETING_PROXY_DIR,
    };
    const dir = mkdtempSync(join(tmpdir(), 'synthetic proxy '));
    const holder = createServer();
    holder.listen(0, '127.0.0.1');
    await once(holder, 'listening');
    const port = (holder.address() as any).port;
    await new Promise<void>((r) => holder.close(() => r()));
    mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(dir, 'config.yaml'), 'model_list: []\n');
    const key = 'synthetic-proxy-review-secret';
    writeFileSync(join(dir, 'provider.env'), `OPENAI_API_KEY="${key}"\n`);
    const executable = join(dir, '.venv', 'bin', 'litellm');
    writeFileSync(
      executable,
      `#!/usr/bin/env node\nconst http=require('node:http');console.log(process.env.OPENAI_API_KEY);http.createServer((q,s)=>{s.end('ready')}).listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1');\n`,
    );
    chmodSync(executable, 0o755);
    const logs: string[] = [];
    try {
      process.env.MEETING_AUTOSTART_PROXY = '1';
      process.env.MEETING_PROXY_DIR = dir;
      assert.equal(
        (await startLocalProxy(`http://127.0.0.1:${port}`, (message) => logs.push(message)))
          .started,
        true,
      );
      assert.ok(logs.some((message) => message.includes('[redacted]')));
      assert.ok(logs.every((message) => !message.includes(key)));
    } finally {
      stopLocalProxy();
      for (const [name, value] of [
        ['MEETING_AUTOSTART_PROXY', previous.auto],
        ['MEETING_PROXY_DIR', previous.dir],
      ]) {
        if (value === undefined) delete process.env[name!];
        else process.env[name!] = value;
      }
    }
  },
);
