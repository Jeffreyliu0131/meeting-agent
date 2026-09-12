# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: provider-contract.spec.ts >> provider transport, isolated preflight, generated structure, source binding, updates and personal calculator
- Location: tests/e2e/provider-contract.spec.ts:248:1

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'View sources: Two routes, one unresolved condition', exact: true })

```

# Test source

```ts
  222 |   base = `http://127.0.0.1:${(server.address() as any).port}`;
  223 |   dir = mkdtempSync(join(tmpdir(), 'meeting-provider-test-'));
  224 |   app = await electron.launch({
  225 |     args: [resolve('.'), '--use-fake-device-for-media-stream'],
  226 |     env: {
  227 |       ...process.env,
  228 |       MEETING_DEV_INPUTS: test.info().title.startsWith('normal') ? '' : '1',
  229 |       MEETING_SYSTEM_LOCALE: 'en',
  230 |       MEETING_DATA_DIR: dir,
  231 |       OPENAI_API_KEY: 'test-transport-only',
  232 |       MEETING_API_BASE: base,
  233 |       MEETING_STT_API_KEY: 'test-transport-only',
  234 |       MEETING_STT_API_BASE: base,
  235 |     },
  236 |   });
  237 | });
  238 | test.afterEach(async () => {
  239 |   if (app && app.process().exitCode === null) {
  240 |     const closed = app.waitForEvent('close', { timeout: 10000 });
  241 |     await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  242 |     await closed;
  243 |   }
  244 |   server.closeAllConnections();
  245 |   await new Promise<void>((r) => server.close(() => r()));
  246 |   if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  247 | });
  248 | test('provider transport, isolated preflight, generated structure, source binding, updates and personal calculator', async () => {
  249 |   let page: any;
  250 |   await expect
  251 |     .poll(async () => {
  252 |       page = (await app.windows()).find((p) => p.url().includes('role=workspace'));
  253 |       return !!page;
  254 |     })
  255 |     .toBe(true);
  256 |   await app.evaluate(({ BrowserWindow }) => {
  257 |     const w = BrowserWindow.getAllWindows().find((w) =>
  258 |       w.webContents.getURL().includes('role=workspace'),
  259 |     );
  260 |     w?.show();
  261 |     w?.focus();
  262 |   });
  263 |   await page.getByText('Development tools', { exact: true }).click();
  264 |   await page.getByRole('button', { name: 'Development input', exact: true }).click();
  265 |   await page.getByRole('dialog').getByRole('button', { name: 'Start meeting' }).click();
  266 |   await page.getByRole('button', { name: 'Add a transcript excerpt' }).click();
  267 |   await page
  268 |     .getByRole('textbox', { name: 'Original words…' })
  269 |     .fill('Synthetic transport fixture, not a live meeting.');
  270 |   await page.getByRole('button', { name: 'Add source', exact: true }).click();
  271 |   await expect(
  272 |     page.getByRole('heading', { name: 'Who should join the pilot? · Protocol test' }),
  273 |   ).toBeVisible();
  274 |   expect(calls).toBe(1);
  275 |   await page.getByRole('button', { name: 'Calculate with these assumptions' }).click();
  276 |   await expect(page.getByText('Result: 510 SGD')).toBeVisible();
  277 |   await page.getByLabel('People (people)', { exact: true }).fill('40');
  278 |   await page.getByRole('button', { name: 'Calculate with these assumptions' }).click();
  279 |   await expect(page.getByText('Result: 630 SGD')).toBeVisible();
  280 |   await page.getByRole('button', { name: 'Save this scenario', exact: true }).click();
  281 |   await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  282 |   await page.getByRole('button', { name: 'Explore this', exact: true }).click();
  283 |   await page
  284 |     .getByRole('textbox', { name: 'Ask about this meeting…' })
  285 |     .fill('Draft kept while a new version arrives');
  286 |   await page
  287 |     .getByRole('textbox', { name: 'Original words…' })
  288 |     .fill('Synthetic fixture correction: support capacity is still unknown.');
  289 |   await page.getByRole('button', { name: 'Add source', exact: true }).click();
  290 |   await expect
  291 |     .poll(async () => {
  292 |       const state = await page.evaluate(() => window.meeting.call('snapshot'));
  293 |       return state.value.meetings[0].artifacts.length;
  294 |     })
  295 |     .toBe(2);
  296 |   await expect(page.getByRole('button', { name: 'Show latest version' })).toHaveCount(0);
  297 |   await expect(page.getByRole('textbox', { name: 'Ask about this meeting…' })).toHaveValue(
  298 |     'Draft kept while a new version arrives',
  299 |   );
  300 |   await expect(page.getByLabel('People (people)', { exact: true })).toHaveValue('40');
  301 |   await page.getByRole('button', { name: 'Remove context', exact: true }).click();
  302 |   await expect(page.locator('.context-chip')).toHaveCount(0);
  303 |   await expect(page.getByRole('textbox', { name: 'Ask about this meeting…' })).toHaveValue(
  304 |     'Draft kept while a new version arrives',
  305 |   );
  306 |   await page.getByRole('button', { name: 'Contents', exact: true }).click();
  307 |   await page
  308 |     .getByRole('navigation', { name: 'Contents' })
  309 |     .getByRole('button', { name: 'Key condition' })
  310 |     .click();
  311 |   await expect(page.locator('[data-block-id="dependency"]')).toBeFocused();
  312 | 
  313 |   await expect(
  314 |     page.getByText('Synthetic provider output. Batch 2 — transport only.', { exact: true }),
  315 |   ).toBeVisible();
  316 |   await expect(page.getByText('Current focus', { exact: false }).first()).toBeVisible();
  317 |   await page
  318 |     .getByRole('button', {
  319 |       name: 'View sources: Two routes, one unresolved condition',
  320 |       exact: true,
  321 |     })
> 322 |     .click();
      |      ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  323 |   await expect(
  324 |     page
  325 |       .getByRole('dialog', { name: 'View sources' })
  326 |       .getByText('Two routes, one unresolved condition', { exact: true }),
  327 |   ).toBeVisible();
  328 |   await page.screenshot({ path: test.info().outputPath('refresh-sources.png') });
  329 |   await page
  330 |     .getByRole('dialog', { name: 'View sources' })
  331 |     .getByRole('button', { name: 'Close', exact: true })
  332 |     .click();
  333 | 
  334 |   for (const size of [
  335 |     { width: 1440, height: 1024 },
  336 |     { width: 1024, height: 768 },
  337 |     { width: 800, height: 600 },
  338 |   ]) {
  339 |     await app.evaluate(
  340 |       ({ BrowserWindow }, size) =>
  341 |         BrowserWindow.getAllWindows()
  342 |           .find((w) => w.webContents.getURL().includes('role=workspace'))
  343 |           ?.setSize(size.width, size.height),
  344 |       size,
  345 |     );
  346 |     await expect
  347 |       .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  348 |       .toBe(true);
  349 |     await page.screenshot({
  350 |       path: test.info().outputPath(`contract-workspace-${size.width}.png`),
  351 |       fullPage: true,
  352 |     });
  353 |   }
  354 |   const state = await page.evaluate(() => window.meeting.call('snapshot'));
  355 |   expect(state.value.meetings[0].artifacts).toHaveLength(2);
  356 |   expect(state.value.meetings[0].artifacts[0].id).toBe(state.value.meetings[0].artifacts[1].id);
  357 |   expect(state.value.meetings[0].scenarios[0].result).toBe('630');
  358 |   expect(state.value.meetings[0].decisions).toHaveLength(0);
  359 |   await app.evaluate(({ BrowserWindow }) =>
  360 |     BrowserWindow.getAllWindows()
  361 |       .find((w) => w.webContents.getURL().includes('role=workspace'))
  362 |       ?.webContents.setZoomFactor(2),
  363 |   );
  364 |   await expect
  365 |     .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  366 |     .toBe(true);
  367 |   await expect(page.locator('.relationship-list')).toBeVisible();
  368 |   // Electron zoom affects CDP screenshot cropping; use the native surface at 200%.
  369 |   const zoomCapture = await app.evaluate(async ({ BrowserWindow }) =>
  370 |     (
  371 |       await BrowserWindow.getAllWindows()
  372 |         .find((w) => w.webContents.getURL().includes('role=workspace'))!
  373 |         .webContents.capturePage()
  374 |     )
  375 |       .toPNG()
  376 |       .toString('base64'),
  377 |   );
  378 |   writeFileSync(
  379 |     test.info().outputPath('refresh-workspace-200.png'),
  380 |     Buffer.from(zoomCapture, 'base64'),
  381 |   );
  382 | });
  383 | test('synthetic oscillator keeps capturing through a slow STT response and stops cleanly', async () => {
  384 |   sttDelay = 6500;
  385 |   let page: any, capture: any;
  386 |   await expect
  387 |     .poll(async () => {
  388 |       const windows = await app.windows();
  389 |       page = windows.find((p) => p.url().includes('role=workspace'));
  390 |       capture = windows.find((p) => p.url().includes('capture.html'));
  391 |       return !!page && !!capture;
  392 |     })
  393 |     .toBe(true);
  394 |   await capture.evaluate(() => {
  395 |     // Only this test replaces physical devices. Production never installs this override.
  396 |     navigator.mediaDevices.getUserMedia = async () => {
  397 |       const ctx = new AudioContext();
  398 |       const oscillator = ctx.createOscillator();
  399 |       oscillator.frequency.value = 220;
  400 |       const output = ctx.createMediaStreamDestination();
  401 |       oscillator.connect(output);
  402 |       oscillator.start();
  403 |       await ctx.resume();
  404 |       (window as any).testTrack = output.stream.getAudioTracks()[0];
  405 |       (window as any).testAudioContext = ctx;
  406 |       return output.stream;
  407 |     };
  408 |   });
  409 |   const created = await page.evaluate(() =>
  410 |     window.meeting.call('command', {
  411 |       id: crypto.randomUUID(),
  412 |       meetingId: null,
  413 |       type: 'create',
  414 |       payload: {
  415 |         title: 'Synthetic oscillator input test',
  416 |         mode: 'microphone',
  417 |         outputLocale: 'en',
  418 |         timezone: 'UTC',
  419 |       },
  420 |     }),
  421 |   );
  422 |   expect(created.ok).toBe(true);
```