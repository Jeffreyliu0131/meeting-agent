# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: meeting-reminder.spec.ts >> bubble hover holds beyond eight seconds; moving away expires and stale click cannot start
- Location: tests/e2e/meeting-reminder.spec.ts:195:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
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
  148 |     .toContain('role=workspace');
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
> 199 |   expect(await visible('reminder')).toBe(true);
      |                                     ^ Error: expect(received).toBe(expected) // Object.is equality
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
  249 |   expect((await state()).notificationUnavailable).toBe(true);
  250 |   expect(await visible('reminder')).toBe(false);
  251 |   await signal('expired', 1, 150);
  252 |   await page.waitForTimeout(200);
  253 |   await fixture({ nativeEvent: 'click' });
  254 |   expect((await state()).meetings).toHaveLength(0);
  255 |   await preferences({ uiLanguage: 'en' });
  256 |   await signal('clicked');
  257 |   system = (await fixture()).notifications;
  258 |   expect(system.at(-1).title).toBe('You might be in a meeting');
  259 |   await fixture({ nativeEvent: 'click' });
  260 |   await fixture({ nativeEvent: 'click' });
  261 |   await expect.poll(async () => (await state()).meetings[0]?.capture).toBe('capturing');
  262 |   expect((await state()).meetings).toHaveLength(1);
  263 |   expect(await visible('workspace')).toBe(false);
  264 | });
  265 | test('setup exception is explicit; reminder renderer has least privilege; production IPC cannot inject detections', async () => {
  266 |   await signal();
  267 |   expect(
  268 |     (await bubble.evaluate(() => window.meeting.call('command', { type: 'preferences' }))).error,
  269 |   ).toBe('PERMISSION_DENIED');
  270 |   expect(
  271 |     (await page.evaluate(() => window.meeting.call('reminderAccept', { id: 'synthetic-episode' })))
  272 |       .ok,
  273 |   ).toBe(false);
  274 |   await bubble.getByRole('button', { name: /Click to start recording/ }).click();
  275 |   await expect(page.getByRole('dialog', { name: 'Meeting audio' })).toBeVisible();
  276 |   expect((await state()).meetings).toHaveLength(0);
  277 |   await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  278 |   expect((await state()).meetings).toHaveLength(0);
  279 |   await stopApp();
  280 |   await launch(false);
  281 |   const injected = await page.evaluate(() =>
  282 |     window.meeting.call('reminderTest', {
  283 |       signal: { id: 'injected', revision: 1, present: true, expiresAt: Date.now() + 60000 },
  284 |     }),
  285 |   );
  286 |   expect(injected.error).toBe('PERMISSION_DENIED');
  287 |   expect(await visible('reminder')).toBe(false);
  288 | });
  289 | 
```