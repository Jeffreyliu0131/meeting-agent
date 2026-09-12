# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hover-preview.spec.ts >> union-region grace, pending hover cancellation, drag and native menu do not open the workspace
- Location: tests/e2e/hover-preview.spec.ts:259:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  183 |   });
  184 |   await expect
  185 |     .poll(async () => {
  186 |       const pages = await app.windows();
  187 |       workspace = pages.find((p) => p.url().includes('role=workspace'))!;
  188 |       launcher = pages.find((p) => p.url().includes('role=launcher'))!;
  189 |       preview = pages.find((p) => p.url().includes('role=preview'))!;
  190 |       return !!workspace && !!launcher && !!preview;
  191 |     })
  192 |     .toBe(true);
  193 |   await expect
  194 |     .poll(async () => (await workspace.evaluate(() => window.meeting.call('snapshot'))).ok)
  195 |     .toBe(true);
  196 |   await expect.poll(async () => (await native('launcher')).visible).toBe(true);
  197 |   // A controlled foreground surface verifies that showing the preview leaves focus alone.
  198 |   await app.evaluate(async ({ BrowserWindow }) => {
  199 |     const surface = new BrowserWindow({
  200 |       width: 300,
  201 |       height: 160,
  202 |       x: 30,
  203 |       y: 50,
  204 |       title: 'Synthetic meeting surface',
  205 |       show: false,
  206 |     });
  207 |     await surface.loadURL('data:text/html,<p>Synthetic meeting surface</p>');
  208 |     surface.show();
  209 |     surface.focus();
  210 |   });
  211 | });
  212 | 
  213 | test.afterEach(async () => {
  214 |   await cleanupElectron(app, dataDir);
  215 |   server?.closeAllConnections();
  216 |   await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  217 | });
  218 | 
  219 | test('hover shows the actual canvas and live revisions while the workspace stays hidden', async () => {
  220 |   await create();
  221 |   await enter();
  222 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  223 |   await expect(preview.getByText('有值得整理的内容时，画板会在这里呈现。')).toBeVisible();
  224 |   expect((await native('workspace')).visible).toBe(false);
  225 |   expect((await native('preview')).focused).toBe(false);
  226 |   expect(
  227 |     await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle()),
  228 |   ).toBe('Synthetic meeting surface');
  229 |   await ingest(1);
  230 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 1：容量仍待确认。');
  231 |   await expect(preview.locator('.relationship-canvas')).toBeVisible();
  232 |   await expect(preview.locator('table')).toHaveCount(1);
  233 |   await leave(launcher);
  234 |   await preview.mouse.move(40, 30);
  235 |   await preview.locator('.preview-scroll').evaluate((el) => {
  236 |     el.scrollTop = 140;
  237 |   });
  238 |   const before = await preview.locator('.preview-scroll').evaluate((el) => el.scrollTop);
  239 |   await ingest(2);
  240 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 2：容量仍待确认。');
  241 |   expect(await preview.locator('.preview-scroll').evaluate((el) => el.scrollTop)).toBe(before);
  242 |   expect((await native('preview')).visible).toBe(true);
  243 |   expect((await native('workspace')).visible).toBe(false);
  244 |   await preview.locator('.preview-scroll').evaluate((el) => {
  245 |     el.scrollTop = 0;
  246 |   });
  247 |   await preview.screenshot({ path: test.info().outputPath('hover-canvas.png') });
  248 |   await leave(preview);
  249 |   await expect.poll(async () => (await native('preview')).visible).toBe(false);
  250 |   await ingest(3);
  251 |   await enter();
  252 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  253 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 3：容量仍待确认。');
  254 |   const state = await call(workspace, 'snapshot');
  255 |   expect(state.meetings[0].status).toBe('active');
  256 |   expect(state.meetings[0].capture).toBe('idle');
  257 | });
  258 | 
  259 | test('union-region grace, pending hover cancellation, drag and native menu do not open the workspace', async () => {
  260 |   await create();
  261 |   await enter();
  262 |   await leave(launcher);
  263 |   await new Promise((r) => setTimeout(r, 400));
  264 |   expect((await native('preview')).visible).toBe(false);
  265 |   await enter();
  266 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  267 |   await leave(launcher);
  268 |   await preview.mouse.move(30, 30);
  269 |   await new Promise((r) => setTimeout(r, 400));
  270 |   expect((await native('preview')).visible).toBe(true);
  271 |   await leave(preview);
  272 |   await launcher.mouse.move(20, 20);
  273 |   await new Promise((r) => setTimeout(r, 400));
  274 |   expect((await native('preview')).visible).toBe(true);
  275 |   await launcher.mouse.down();
  276 |   await launcher.mouse.move(35, 20, { steps: 3 });
  277 |   await call(launcher, 'hover', true); // A queued native enter during a drag cannot show it.
  278 |   await new Promise((r) => setTimeout(r, 400));
  279 |   expect((await native('preview')).visible).toBe(false);
  280 |   await launcher.mouse.up();
  281 |   expect((await native('workspace')).visible).toBe(false);
  282 |   await enter();
> 283 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
      |                                                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  284 |   await app.evaluate(({ Menu }) => {
  285 |     const original = Menu.prototype.popup;
  286 |     Menu.prototype.popup = function (options) {
  287 |       (globalThis as any).__hoverMenu = this;
  288 |       original.call(this, options);
  289 |     };
  290 |   });
  291 |   await call(launcher, 'menu');
  292 |   await call(launcher, 'hover', true);
  293 |   await new Promise((r) => setTimeout(r, 400));
  294 |   expect((await native('preview')).visible).toBe(false);
  295 |   await app.evaluate(() => (globalThis as any).__hoverMenu.closePopup());
  296 |   expect((await native('workspace')).visible).toBe(false);
  297 |   // Explicit click still opens exactly one persistent workspace.
  298 |   await launcher.locator('.launcher').click();
  299 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  300 |   await leave(launcher);
  301 |   await new Promise((r) => setTimeout(r, 400));
  302 |   expect((await native('workspace')).visible).toBe(true);
  303 | });
  304 | 
  305 | test('sources open the displayed revision and suggested actions only prepare a draft', async () => {
  306 |   await create();
  307 |   await ingest(1);
  308 |   await enter();
  309 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  310 |   await preview.getByRole('button', { name: '查看来源: 推进条件', exact: true }).click();
  311 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  312 |   await expect(workspace.locator('.source-panel')).toContainText('合成发言 1');
  313 |   expect((await native('preview')).visible).toBe(false);
  314 |   await call(workspace, 'hide');
  315 |   await enter();
  316 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  317 |   await preview.getByRole('button', { name: '比较试用路径', exact: true }).click();
  318 |   await expect(workspace.locator('textarea.ask-input')).toHaveValue('请比较不同试用路径。');
  319 |   const state = await call(workspace, 'snapshot');
  320 |   expect(state.meetings[0].segments).toHaveLength(1);
  321 |   expect(state.meetings[0].requests).toHaveLength(0);
  322 | });
  323 | 
  324 | test('preview follows display edges, stays readable at 200 percent, and clears ended content', async () => {
  325 |   await create();
  326 |   await ingest(1);
  327 |   for (const side of ['left', 'right']) {
  328 |     await call(launcher, 'hover', false);
  329 |     await call(preview, 'hover', false);
  330 |     await expect.poll(async () => (await native('preview')).visible).toBe(false);
  331 |     await app.evaluate(({ BrowserWindow, screen }, side) => {
  332 |       const w = BrowserWindow.getAllWindows().find((w) =>
  333 |         w.webContents.getURL().includes('role=launcher'),
  334 |       )!;
  335 |       const a = screen.getPrimaryDisplay().workArea;
  336 |       w.setPosition(side === 'left' ? a.x + 12 : a.x + a.width - 56, a.y + a.height - 60);
  337 |     }, side);
  338 |     await enter();
  339 |     await expect.poll(async () => (await native('preview')).visible).toBe(true);
  340 |     const p = (await native('preview')).bounds,
  341 |       b = (await native('launcher')).bounds;
  342 |     const a = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  343 |     expect(p.x).toBeGreaterThanOrEqual(a.x);
  344 |     expect(p.y + p.height).toBeLessThanOrEqual(a.y + a.height);
  345 |     expect(side === 'left' ? p.x >= b.x + b.width : p.x + p.width <= b.x).toBe(true);
  346 |   }
  347 |   await app.evaluate(({ BrowserWindow }) =>
  348 |     BrowserWindow.getAllWindows()
  349 |       .find((w) => w.webContents.getURL().includes('role=preview'))!
  350 |       .webContents.setZoomFactor(2),
  351 |   );
  352 |   await expect
  353 |     .poll(() => preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  354 |     .toBe(true);
  355 |   await expect(preview.getByRole('button', { name: /打开会议/ }).last()).toBeVisible();
  356 |   await preview.screenshot({ path: test.info().outputPath('hover-canvas-200.png') });
  357 |   await app.evaluate(({ BrowserWindow }) =>
  358 |     BrowserWindow.getAllWindows()
  359 |       .find((w) => w.webContents.getURL().includes('role=preview'))!
  360 |       .webContents.setZoomFactor(1),
  361 |   );
  362 |   await command('end');
  363 |   await expect(preview.locator('.preview-canvas')).toHaveCount(0);
  364 |   await expect(preview.getByText('还没有正在进行的会议')).toBeVisible();
  365 |   await command('preferencesPatch', { uiLanguage: 'en' }, null);
  366 |   await expect(preview.getByText('No meeting in progress')).toBeVisible();
  367 | });
  368 | 
```