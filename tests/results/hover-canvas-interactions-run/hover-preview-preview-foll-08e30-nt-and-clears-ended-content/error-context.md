# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hover-preview.spec.ts >> preview follows display edges, stays readable at 200 percent, and clears ended content
- Location: tests/e2e/hover-preview.spec.ts:340:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('还没有正在进行的会议')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('还没有正在进行的会议') with timeout 10000ms
  - waiting for getByText('还没有正在进行的会议')

```

# Test source

```ts
  280 |   await launcher.mouse.move(20, 20);
  281 |   await new Promise((r) => setTimeout(r, 400));
  282 |   expect((await native('preview')).visible).toBe(true);
  283 |   await launcher.evaluate(() => {
  284 |     (globalThis as any).__pointerEvents = [];
  285 |     for (const type of ['pointerdown', 'pointermove', 'pointerup', 'lostpointercapture', 'pointercancel', 'mouseover', 'mouseout'])
  286 |       document.addEventListener(type, (e) => (globalThis as any).__pointerEvents.push({ type, buttons: (e as PointerEvent).buttons, x: (e as PointerEvent).screenX, y: (e as PointerEvent).screenY }));
  287 |   });
  288 |   await launcher.mouse.down();
  289 |   await launcher.mouse.move(35, 20, { steps: 3 });
  290 |   await call(launcher, 'hover', true); // A queued native enter during a drag cannot show it.
  291 |   await new Promise((r) => setTimeout(r, 400));
  292 |   expect((await native('preview')).visible).toBe(false);
  293 |   await launcher.mouse.up();
  294 |   expect((await native('workspace')).visible).toBe(false);
  295 |   await enter();
  296 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  297 |   await app.evaluate(({ Menu }) => {
  298 |     const original = Menu.prototype.popup;
  299 |     Menu.prototype.popup = function (options) {
  300 |       (globalThis as any).__hoverMenu = this;
  301 |       original.call(this, options);
  302 |     };
  303 |   });
  304 |   await call(launcher, 'menu');
  305 |   await call(launcher, 'hover', true);
  306 |   await new Promise((r) => setTimeout(r, 400));
  307 |   expect((await native('preview')).visible).toBe(false);
  308 |   await app.evaluate(() => (globalThis as any).__hoverMenu.closePopup());
  309 |   expect((await native('workspace')).visible).toBe(false);
  310 |   // Explicit click still opens exactly one persistent workspace.
  311 |   await launcher.locator('.launcher').click();
  312 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  313 |   await leave(launcher);
  314 |   await new Promise((r) => setTimeout(r, 400));
  315 |   expect((await native('workspace')).visible).toBe(true);
  316 | });
  317 | 
  318 | test('sources open the displayed revision and suggested actions only prepare a draft', async () => {
  319 |   await create();
  320 |   await ingest(1);
  321 |   await enter();
  322 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  323 |   await preview.getByRole('button', { name: '查看来源: 推进条件', exact: true }).click();
  324 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  325 |   await expect(workspace.locator('.source-panel')).toContainText('合成发言 1');
  326 |   expect((await native('preview')).visible).toBe(false);
  327 |   await call(workspace, 'hide');
  328 |   await enter();
  329 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  330 |   await leave(launcher);
  331 |   await preview.mouse.move(30, 30);
  332 |   await preview.getByRole('button', { name: '比较试用路径', exact: true }).click();
  333 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  334 |   await expect(workspace.locator('.ask-bar textarea')).toHaveValue('请比较不同试用路径。');
  335 |   const state = await call(workspace, 'snapshot');
  336 |   expect(state.meetings[0].segments).toHaveLength(1);
  337 |   expect(state.meetings[0].requests).toHaveLength(0);
  338 | });
  339 | 
  340 | test('preview follows display edges, stays readable at 200 percent, and clears ended content', async () => {
  341 |   await create();
  342 |   await ingest(1);
  343 |   for (const side of ['left', 'right']) {
  344 |     await call(launcher, 'hover', false);
  345 |     await call(preview, 'hover', false);
  346 |     await expect.poll(async () => (await native('preview')).visible).toBe(false);
  347 |     await app.evaluate(({ BrowserWindow, screen }, side) => {
  348 |       const w = BrowserWindow.getAllWindows().find((w) =>
  349 |         w.webContents.getURL().includes('role=launcher'),
  350 |       )!;
  351 |       const a = screen.getPrimaryDisplay().workArea;
  352 |       w.setPosition(side === 'left' ? a.x + 12 : a.x + a.width - 56, a.y + a.height - 60);
  353 |     }, side);
  354 |     await enter();
  355 |     await expect.poll(async () => (await native('preview')).visible).toBe(true);
  356 |     const p = (await native('preview')).bounds,
  357 |       b = (await native('launcher')).bounds;
  358 |     const a = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  359 |     expect(p.x).toBeGreaterThanOrEqual(a.x);
  360 |     expect(p.y + p.height).toBeLessThanOrEqual(a.y + a.height);
  361 |     expect(side === 'left' ? p.x >= b.x + b.width : p.x + p.width <= b.x).toBe(true);
  362 |   }
  363 |   await app.evaluate(({ BrowserWindow }) =>
  364 |     BrowserWindow.getAllWindows()
  365 |       .find((w) => w.webContents.getURL().includes('role=preview'))!
  366 |       .webContents.setZoomFactor(2),
  367 |   );
  368 |   await expect
  369 |     .poll(() => preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  370 |     .toBe(true);
  371 |   await expect(preview.getByRole('button', { name: '打开工作页', exact: true })).toBeVisible();
  372 |   await preview.screenshot({ path: test.info().outputPath('hover-canvas-200.png') });
  373 |   await app.evaluate(({ BrowserWindow }) =>
  374 |     BrowserWindow.getAllWindows()
  375 |       .find((w) => w.webContents.getURL().includes('role=preview'))!
  376 |       .webContents.setZoomFactor(1),
  377 |   );
  378 |   await command('end');
  379 |   await expect(preview.locator('.preview-canvas')).toHaveCount(0);
> 380 |   await expect(preview.getByText('还没有正在进行的会议')).toBeVisible();
      |                                                 ^ Error: expect(locator).toBeVisible() failed
  381 |   await command('preferencesPatch', { uiLanguage: 'en' }, null);
  382 |   await expect(preview.getByText('No meeting in progress')).toBeVisible();
  383 | });
  384 | 
```