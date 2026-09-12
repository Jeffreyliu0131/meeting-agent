# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: meeting-reminder.spec.ts >> bilingual bubble anchors beside launcher, does not steal focus, closes without recording and stays deduplicated
- Location: tests/e2e/meeting-reminder.spec.ts:135:1

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "role=workspace"
Received string:    "file:///Users/jeff/Library/Mobile%20Documents/com~apple~CloudDocs/%E9%BB%91%E5%AE%A2%E6%9D%BE/meeting-agent/dist/ui/index.html?role=launcher"

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  48  |     .poll(async () => {
  49  |       try {
  50  |         return (await bubble.evaluate(() => window.meeting.call('snapshot'))).ok;
  51  |       } catch {
  52  |         return false;
  53  |       }
  54  |     })
  55  |     .toBe(true);
  56  | }
  57  | const state = () => page.evaluate(async () => (await window.meeting.call('snapshot')).value);
  58  | const fixture = (args: any = {}) =>
  59  |   page.evaluate(async (args) => (await window.meeting.call('reminderTest', args)).value, args);
  60  | const signal = (id = 'synthetic-episode', revision = 1, ttl = 60000, present = true) =>
  61  |   fixture({ signal: { id, revision, present, expiresAt: Date.now() + ttl } });
  62  | const visible = (role: string) =>
  63  |   app.evaluate(
  64  |     ({ BrowserWindow }, role) =>
  65  |       BrowserWindow.getAllWindows()
  66  |         .find((w) => w.webContents.getURL().includes(`role=${role}`))
  67  |         ?.isVisible(),
  68  |     role,
  69  |   );
  70  | async function preferences(patch: any) {
  71  |   const snapshot = await state();
  72  |   const result = await page.evaluate(
  73  |     (payload) =>
  74  |       window.meeting.call('command', {
  75  |         id: crypto.randomUUID(),
  76  |         meetingId: null,
  77  |         type: 'preferences',
  78  |         payload,
  79  |       }),
  80  |     { ...snapshot.preferences, ...patch },
  81  |   );
  82  |   expect(result.ok).toBe(true);
  83  | }
  84  | async function syntheticAudio() {
  85  |   const capture = (await app.windows()).find((p) => p.url().includes('role=capture'))!;
  86  |   await capture.evaluate(() => {
  87  |     (window as any).syntheticStarts = 0;
  88  |     navigator.mediaDevices.getUserMedia = async () => {
  89  |       (window as any).syntheticStarts++;
  90  |       const ctx = new AudioContext(),
  91  |         oscillator = ctx.createOscillator(),
  92  |         output = ctx.createMediaStreamDestination();
  93  |       oscillator.connect(output);
  94  |       oscillator.start();
  95  |       await ctx.resume();
  96  |       (window as any).syntheticContext = ctx;
  97  |       return output.stream;
  98  |     };
  99  |   });
  100 |   await preferences({
  101 |     audio: {
  102 |       deviceId: 'default',
  103 |       deviceLabel: 'Synthetic audio fixture',
  104 |       includeComputerAudio: false,
  105 |       setupCompleted: true,
  106 |     },
  107 |   });
  108 | }
  109 | async function stopApp() {
  110 |   if (!app || app.process().exitCode !== null) return;
  111 |   const closed = app.waitForEvent('close', { timeout: 10000 });
  112 |   await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  113 |   await closed;
  114 | }
  115 | test.beforeEach(async () => {
  116 |   dir = mkdtempSync(join(tmpdir(), 'meeting-reminder-e2e-'));
  117 |   server = createServer((req, res) => {
  118 |     req.resume();
  119 |     req.on('end', () => {
  120 |       res.setHeader('content-type', 'application/json');
  121 |       res.end(JSON.stringify({ text: '' }));
  122 |     });
  123 |   });
  124 |   await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  125 |   base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  126 |   await launch();
  127 | });
  128 | test.afterEach(async () => {
  129 |   await stopApp();
  130 |   server.closeAllConnections();
  131 |   await new Promise<void>((resolve) => server.close(() => resolve()));
  132 |   rmSync(dir, { recursive: true, force: true });
  133 | });
  134 | 
  135 | test('bilingual bubble anchors beside launcher, does not steal focus, closes without recording and stays deduplicated', async () => {
  136 |   await app.evaluate(({ app }) => app.focus({ steal: true }));
  137 |   await app.evaluate(({ BrowserWindow }) => {
  138 |     const w = BrowserWindow.getAllWindows().find((w) =>
  139 |       w.webContents.getURL().includes('role=workspace'),
  140 |     )!;
  141 |     w.show();
  142 |     w.focus();
  143 |   });
  144 |   await expect
  145 |     .poll(() =>
  146 |       app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL()),
  147 |     )
> 148 |     .toContain('role=workspace');
      |      ^ Error: expect(received).toContain(expected) // indexOf
  149 |   await signal();
  150 |   await expect(bubble.getByText('You might be in a meeting')).toBeVisible();
  151 |   await expect(bubble.getByText('Click to start recording')).toBeVisible();
  152 |   expect(
  153 |     await app.evaluate(({ BrowserWindow }) =>
  154 |       BrowserWindow.getFocusedWindow()?.webContents.getURL(),
  155 |     ),
  156 |   ).toContain('role=workspace');
  157 |   expect((await state()).meetings).toHaveLength(0);
  158 |   await expect.poll(() => visible('reminder')).toBe(true);
  159 |   for (const locale of ['en', 'zh-CN']) {
  160 |     await preferences({ uiLanguage: locale });
  161 |     await expect(
  162 |       bubble.getByText(locale === 'en' ? 'You might be in a meeting' : '你可能正在开会'),
  163 |     ).toBeVisible();
  164 |     expect(await bubble.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  165 |       true,
  166 |     );
  167 |     const shot = await app.evaluate(async ({ BrowserWindow }) =>
  168 |       (
  169 |         await BrowserWindow.getAllWindows()
  170 |           .find((w) => w.webContents.getURL().includes('role=reminder'))!
  171 |           .webContents.capturePage()
  172 |       )
  173 |         .toPNG()
  174 |         .toString('base64'),
  175 |     );
  176 |     writeFileSync(test.info().outputPath(`reminder-${locale}.png`), Buffer.from(shot, 'base64'));
  177 |   }
  178 |   const bounds = await app.evaluate(({ BrowserWindow }) =>
  179 |     Object.fromEntries(
  180 |       ['launcher', 'reminder'].map((role) => [
  181 |         role,
  182 |         BrowserWindow.getAllWindows()
  183 |           .find((w) => w.webContents.getURL().includes(`role=${role}`))!
  184 |           .getBounds(),
  185 |       ]),
  186 |     ),
  187 |   );
  188 |   expect(bounds.reminder.x + bounds.reminder.width).toBeLessThanOrEqual(bounds.launcher.x);
  189 |   await bubble.getByRole('button', { name: '关闭提醒', exact: true }).click();
  190 |   await expect.poll(() => visible('reminder')).toBe(false);
  191 |   await signal('synthetic-episode', 2);
  192 |   expect((await fixture()).view).toBeNull();
  193 |   expect((await state()).meetings).toHaveLength(0);
  194 | });
  195 | test('bubble hover holds beyond eight seconds; moving away expires and stale click cannot start', async () => {
  196 |   await signal();
  197 |   await bubble.getByRole('button', { name: /Click to start recording/ }).hover();
  198 |   await page.waitForTimeout(8300);
  199 |   expect(await visible('reminder')).toBe(true);
  200 |   // CDP pointer movement outside an Electron window does not reliably emit native leave.
  201 |   // Dispatch the leave through the rendered component; the real hover above and timer remain exercised.
  202 |   await bubble.locator('.meeting-reminder').dispatchEvent('mouseout', { relatedTarget: null });
  203 |   await expect.poll(() => visible('reminder'), { timeout: 10000 }).toBe(false);
  204 |   const click = await bubble.evaluate(() =>
  205 |     window.meeting.call('reminderAccept', { id: 'synthetic-episode' }),
  206 |   );
  207 |   expect(click.value).toBe(false);
  208 |   expect((await state()).meetings).toHaveLength(0);
  209 | });
  210 | test('click starts one synthetic recording quietly; hide launcher and disable reminders preserve capture; preferences persist', async () => {
  211 |   await syntheticAudio();
  212 |   await signal();
  213 |   await bubble.getByRole('button', { name: /Click to start recording/ }).click();
  214 |   await expect.poll(async () => (await state()).meetings[0]?.capture).toBe('capturing');
  215 |   expect(await visible('workspace')).toBe(false);
  216 |   expect((await state()).meetings).toHaveLength(1);
  217 |   await preferences({ launcherVisible: false, meetingReminders: false });
  218 |   await expect.poll(() => visible('launcher')).toBe(false);
  219 |   expect((await state()).meetings[0].capture).toBe('capturing');
  220 |   await signal('another-synthetic');
  221 |   await expect.poll(async () => (await fixture()).view).toBeNull();
  222 |   const capture = (await app.windows()).find((p) => p.url().includes('role=capture'))!;
  223 |   expect(await capture.evaluate(() => (window as any).syntheticStarts)).toBe(1);
  224 |   // Restart restores preferences and data, never recording or reminders.
  225 |   await stopApp();
  226 |   await launch();
  227 |   expect((await state()).preferences.launcherVisible).toBe(false);
  228 |   expect(await visible('launcher')).toBe(false);
  229 |   expect((await state()).meetings[0].capture).not.toBe('capturing');
  230 |   await page.evaluate(() => window.meeting.call('open'));
  231 |   await page.getByRole('button', { name: 'Settings', exact: true }).click();
  232 |   await page.getByLabel('Show desktop launcher', { exact: true }).check();
  233 |   await page.getByRole('button', { name: 'Done', exact: true }).click();
  234 |   await expect.poll(() => visible('launcher')).toBe(true);
  235 | });
  236 | test('hidden launcher routes to native adapter: close/failure/expiry are inert; click records once without workspace', async () => {
  237 |   await syntheticAudio();
  238 |   await preferences({ launcherVisible: false, uiLanguage: 'zh-CN' });
  239 |   await signal('closed');
  240 |   let system = (await fixture()).notifications;
  241 |   expect(system).toHaveLength(1);
  242 |   expect(system[0]).toMatchObject({ title: '你可能正在开会', body: '点击开始记录', silent: true });
  243 |   expect(await visible('reminder')).toBe(false);
  244 |   await fixture({ nativeEvent: 'close' });
  245 |   await fixture({ nativeEvent: 'click' });
  246 |   expect((await state()).meetings).toHaveLength(0);
  247 |   await signal('failed');
  248 |   await fixture({ nativeEvent: 'failed' });
```