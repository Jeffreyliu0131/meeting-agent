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

Matcher error: received value must not be null nor undefined

Received has value: undefined
```

# Test source

```ts
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
  136 |   await app.evaluate(({ BrowserWindow }) => {
  137 |     const w = BrowserWindow.getAllWindows().find((w) =>
  138 |       w.webContents.getURL().includes('role=workspace'),
  139 |     )!;
  140 |     w.show();
  141 |     w.focus();
  142 |   });
  143 |   await signal();
  144 |   await expect(bubble.getByText('You might be in a meeting')).toBeVisible();
  145 |   await expect(bubble.getByText('Click to start recording')).toBeVisible();
  146 |   expect(
  147 |     await app.evaluate(({ BrowserWindow }) =>
  148 |       BrowserWindow.getFocusedWindow()?.webContents.getURL(),
  149 |     ),
> 150 |   ).toContain('role=workspace');
      |     ^ Error: expect(received).toContain(expected) // indexOf
  151 |   expect((await state()).meetings).toHaveLength(0);
  152 |   await expect.poll(() => visible('reminder')).toBe(true);
  153 |   for (const locale of ['en', 'zh-CN']) {
  154 |     await preferences({ uiLanguage: locale });
  155 |     await expect(
  156 |       bubble.getByText(locale === 'en' ? 'You might be in a meeting' : '你可能正在开会'),
  157 |     ).toBeVisible();
  158 |     expect(await bubble.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  159 |       true,
  160 |     );
  161 |     const shot = await app.evaluate(async ({ BrowserWindow }) =>
  162 |       (
  163 |         await BrowserWindow.getAllWindows()
  164 |           .find((w) => w.webContents.getURL().includes('role=reminder'))!
  165 |           .webContents.capturePage()
  166 |       )
  167 |         .toPNG()
  168 |         .toString('base64'),
  169 |     );
  170 |     writeFileSync(test.info().outputPath(`reminder-${locale}.png`), Buffer.from(shot, 'base64'));
  171 |   }
  172 |   const bounds = await app.evaluate(({ BrowserWindow }) =>
  173 |     Object.fromEntries(
  174 |       ['launcher', 'reminder'].map((role) => [
  175 |         role,
  176 |         BrowserWindow.getAllWindows()
  177 |           .find((w) => w.webContents.getURL().includes(`role=${role}`))!
  178 |           .getBounds(),
  179 |       ]),
  180 |     ),
  181 |   );
  182 |   expect(bounds.reminder.x + bounds.reminder.width).toBeLessThanOrEqual(bounds.launcher.x);
  183 |   await bubble.getByRole('button', { name: '关闭提醒', exact: true }).click();
  184 |   await expect.poll(() => visible('reminder')).toBe(false);
  185 |   await signal('synthetic-episode', 2);
  186 |   expect((await fixture()).view).toBeNull();
  187 |   expect((await state()).meetings).toHaveLength(0);
  188 | });
  189 | test('bubble hover holds beyond eight seconds; moving away expires and stale click cannot start', async () => {
  190 |   await signal();
  191 |   await bubble.getByRole('button', { name: /Click to start recording/ }).hover();
  192 |   await page.waitForTimeout(8300);
  193 |   expect(await visible('reminder')).toBe(true);
  194 |   // CDP pointer movement outside an Electron window does not reliably emit native leave.
  195 |   // Dispatch the leave through the rendered component; the real hover above and timer remain exercised.
  196 |   await bubble.locator('.meeting-reminder').dispatchEvent('mouseout', { relatedTarget: null });
  197 |   await expect.poll(() => visible('reminder'), { timeout: 10000 }).toBe(false);
  198 |   const click = await bubble.evaluate(() =>
  199 |     window.meeting.call('reminderAccept', { id: 'synthetic-episode' }),
  200 |   );
  201 |   expect(click.value).toBe(false);
  202 |   expect((await state()).meetings).toHaveLength(0);
  203 | });
  204 | test('click starts one synthetic recording quietly; hide launcher and disable reminders preserve capture; preferences persist', async () => {
  205 |   await syntheticAudio();
  206 |   await signal();
  207 |   await bubble.getByRole('button', { name: /Click to start recording/ }).click();
  208 |   await expect.poll(async () => (await state()).meetings[0]?.capture).toBe('capturing');
  209 |   expect(await visible('workspace')).toBe(false);
  210 |   expect((await state()).meetings).toHaveLength(1);
  211 |   await preferences({ launcherVisible: false, meetingReminders: false });
  212 |   await expect.poll(() => visible('launcher')).toBe(false);
  213 |   expect((await state()).meetings[0].capture).toBe('capturing');
  214 |   await signal('another-synthetic');
  215 |   await expect.poll(async () => (await fixture()).view).toBeNull();
  216 |   const capture = (await app.windows()).find((p) => p.url().includes('role=capture'))!;
  217 |   expect(await capture.evaluate(() => (window as any).syntheticStarts)).toBe(1);
  218 |   // Restart restores preferences and data, never recording or reminders.
  219 |   await stopApp();
  220 |   await launch();
  221 |   expect((await state()).preferences.launcherVisible).toBe(false);
  222 |   expect(await visible('launcher')).toBe(false);
  223 |   expect((await state()).meetings[0].capture).not.toBe('capturing');
  224 |   await page.evaluate(() => window.meeting.call('open'));
  225 |   await page.getByRole('button', { name: 'Settings', exact: true }).click();
  226 |   await page.getByLabel('Show desktop launcher', { exact: true }).check();
  227 |   await page.getByRole('button', { name: 'Done', exact: true }).click();
  228 |   await expect.poll(() => visible('launcher')).toBe(true);
  229 | });
  230 | test('hidden launcher routes to native adapter: close/failure/expiry are inert; click records once without workspace', async () => {
  231 |   await syntheticAudio();
  232 |   await preferences({ launcherVisible: false, uiLanguage: 'zh-CN' });
  233 |   await signal('closed');
  234 |   let system = (await fixture()).notifications;
  235 |   expect(system).toHaveLength(1);
  236 |   expect(system[0]).toMatchObject({ title: '你可能正在开会', body: '点击开始记录', silent: true });
  237 |   expect(await visible('reminder')).toBe(false);
  238 |   await fixture({ nativeEvent: 'close' });
  239 |   await fixture({ nativeEvent: 'click' });
  240 |   expect((await state()).meetings).toHaveLength(0);
  241 |   await signal('failed');
  242 |   await fixture({ nativeEvent: 'failed' });
  243 |   expect((await state()).notificationUnavailable).toBe(true);
  244 |   expect(await visible('reminder')).toBe(false);
  245 |   await signal('expired', 1, 150);
  246 |   await page.waitForTimeout(200);
  247 |   await fixture({ nativeEvent: 'click' });
  248 |   expect((await state()).meetings).toHaveLength(0);
  249 |   await preferences({ uiLanguage: 'en' });
  250 |   await signal('clicked');
```