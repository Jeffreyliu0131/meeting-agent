# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hover-preview.spec.ts >> hover remains open over sandboxed generated SVG without giving the frame desktop access
- Location: tests/e2e/hover-preview.spec.ts:423:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  333 |     };
  334 |   });
  335 |   await call(launcher, 'menu');
  336 |   await call(launcher, 'hover', true);
  337 |   await new Promise((r) => setTimeout(r, 400));
  338 |   expect((await native('preview')).visible).toBe(false);
  339 |   await app.evaluate(() => (globalThis as any).__hoverMenu.closePopup());
  340 |   expect((await native('workspace')).visible).toBe(false);
  341 |   // Explicit click still opens exactly one persistent workspace.
  342 |   await launcher.locator('.launcher').click();
  343 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  344 |   await leave(launcher);
  345 |   await new Promise((r) => setTimeout(r, 400));
  346 |   expect((await native('workspace')).visible).toBe(true);
  347 | });
  348 | 
  349 | test('sources open the displayed revision and suggested actions only prepare a draft', async () => {
  350 |   await create();
  351 |   await ingest(1);
  352 |   await enter();
  353 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  354 |   await preview.getByRole('button', { name: '查看来源: 推进条件', exact: true }).click();
  355 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  356 |   await expect(workspace.locator('.source-panel')).toContainText('合成发言 1');
  357 |   expect((await native('preview')).visible).toBe(false);
  358 |   await call(workspace, 'hide');
  359 |   await enter();
  360 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  361 |   await leave(launcher);
  362 |   await preview.mouse.move(30, 30);
  363 |   await preview.getByRole('button', { name: '比较试用路径', exact: true }).click();
  364 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  365 |   await expect(workspace.locator('.ask-bar textarea')).toHaveValue('请比较不同试用路径。');
  366 |   const state = await call(workspace, 'snapshot');
  367 |   expect(state.meetings[0].segments).toHaveLength(1);
  368 |   expect(state.meetings[0].segments.filter((s: any) => s.kind === 'request')).toHaveLength(0);
  369 | });
  370 | 
  371 | test('preview follows display edges, stays readable at 200 percent, and clears ended content', async () => {
  372 |   await create();
  373 |   await ingest(1);
  374 |   for (const side of ['left', 'right']) {
  375 |     await call(launcher, 'hover', false);
  376 |     await call(preview, 'hover', false);
  377 |     await expect.poll(async () => (await native('preview')).visible).toBe(false);
  378 |     await app.evaluate(({ BrowserWindow, screen }, side) => {
  379 |       const w = BrowserWindow.getAllWindows().find((w) =>
  380 |         w.webContents.getURL().includes('role=launcher'),
  381 |       )!;
  382 |       const a = screen.getPrimaryDisplay().workArea;
  383 |       w.setPosition(side === 'left' ? a.x + 12 : a.x + a.width - 56, a.y + a.height - 60);
  384 |     }, side);
  385 |     await enter();
  386 |     await expect.poll(async () => (await native('preview')).visible).toBe(true);
  387 |     const p = (await native('preview')).bounds,
  388 |       b = (await native('launcher')).bounds;
  389 |     const a = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  390 |     expect(p.x).toBeGreaterThanOrEqual(a.x);
  391 |     expect(p.y + p.height).toBeLessThanOrEqual(a.y + a.height);
  392 |     expect(side === 'left' ? p.x >= b.x + b.width : p.x + p.width <= b.x).toBe(true);
  393 |   }
  394 |   await app.evaluate(({ BrowserWindow }) =>
  395 |     BrowserWindow.getAllWindows()
  396 |       .find((w) => w.webContents.getURL().includes('role=preview'))!
  397 |       .webContents.setZoomFactor(2),
  398 |   );
  399 |   await expect
  400 |     .poll(() => preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  401 |     .toBe(true);
  402 |   await expect(preview.getByRole('button', { name: '打开工作页', exact: true })).toBeVisible();
  403 |   const zoomPng = await app.evaluate(async ({ BrowserWindow }) => {
  404 |     const w = BrowserWindow.getAllWindows().find((w) =>
  405 |       w.webContents.getURL().includes('role=preview'),
  406 |     )!;
  407 |     return (await w.capturePage()).toPNG().toString('base64');
  408 |   });
  409 |   writeFileSync(test.info().outputPath('hover-canvas-200.png'), Buffer.from(zoomPng, 'base64'));
  410 |   await app.evaluate(({ BrowserWindow }) =>
  411 |     BrowserWindow.getAllWindows()
  412 |       .find((w) => w.webContents.getURL().includes('role=preview'))!
  413 |       .webContents.setZoomFactor(1),
  414 |   );
  415 |   await command('end');
  416 |   await expect(preview.locator('.preview-canvas')).toHaveCount(0);
  417 |   await expect(preview.getByText('还没有正在进行的会议')).toBeVisible();
  418 |   await command('preferencesPatch', { uiLanguage: 'en' }, null);
  419 |   await expect(preview.getByText('No meeting in progress')).toBeVisible();
  420 | });
  421 | 
  422 | 
  423 | test('hover remains open over sandboxed generated SVG without giving the frame desktop access', async () => {
  424 |   includeMarkup = true;
  425 |   await create();
  426 |   await ingest(1);
  427 |   await enter();
  428 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  429 |   await leave(launcher);
  430 |   const svg = preview.frameLocator('iframe.generated-frame').locator('svg');
  431 |   await svg.hover();
  432 |   await new Promise((r) => setTimeout(r, 450));
> 433 |   expect((await native('preview')).visible).toBe(true);
      |                                             ^ Error: expect(received).toBe(expected) // Object.is equality
  434 |   expect((await native('workspace')).visible).toBe(false);
  435 |   expect((await native('preview')).focused).toBe(false);
  436 |   expect(await svg.evaluate(() => typeof (window as any).meeting)).toBe('undefined');
  437 |   await leave(preview);
  438 |   await expect.poll(async () => (await native('preview')).visible).toBe(false);
  439 | });
  440 | 
```