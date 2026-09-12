# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hover-preview.spec.ts >> hover shows the actual canvas and live revisions while the workspace stays hidden
- Location: tests/e2e/hover-preview.spec.ts:242:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  173 |   await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  174 |   dataDir = mkdtempSync(join(tmpdir(), 'meeting-desktop-hover-'));
  175 |   const executablePath = process.env.MEETING_HOVER_EXECUTABLE;
  176 |   app = await electron.launch({
  177 |     ...(executablePath ? { executablePath, args: [] } : { args: [resolve('.')] }),
  178 |     env: {
  179 |       ...process.env,
  180 |       MEETING_DEV_INPUTS: '1',
  181 |       MEETING_SYSTEM_LOCALE: 'zh-CN',
  182 |       MEETING_DATA_DIR: dataDir,
  183 |       OPENAI_API_KEY: 'synthetic-only',
  184 |       MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
  185 |       MEETING_STT_API_KEY: '',
  186 |       MEETING_AUTOSTART_PROXY: '0',
  187 |       MEETING_MIN_BATCH_MS: '100',
  188 |     },
  189 |   });
  190 |   await expect
  191 |     .poll(async () => {
  192 |       const pages = await app.windows();
  193 |       workspace = pages.find((p) => p.url().includes('role=workspace'))!;
  194 |       launcher = pages.find((p) => p.url().includes('role=launcher'))!;
  195 |       preview = pages.find((p) => p.url().includes('role=preview'))!;
  196 |       return !!workspace && !!launcher && !!preview;
  197 |     })
  198 |     .toBe(true);
  199 |   await expect
  200 |     .poll(async () => (await workspace.evaluate(() => window.meeting.call('snapshot'))).ok)
  201 |     .toBe(true);
  202 |   await expect.poll(async () => (await native('launcher')).visible).toBe(true);
  203 |   preview.on('pageerror', (e) => console.log('Preview error:', e.message));
  204 |   // A controlled foreground surface verifies that showing the preview leaves focus alone.
  205 |   await app.evaluate(async ({ BrowserWindow }) => {
  206 |     const surface = new BrowserWindow({
  207 |       width: 300,
  208 |       height: 160,
  209 |       x: 30,
  210 |       y: 50,
  211 |       title: 'Synthetic meeting surface',
  212 |       show: false,
  213 |     });
  214 |     await surface.loadURL('data:text/html,<p>Synthetic meeting surface</p>');
  215 |     surface.show();
  216 |     surface.focus();
  217 |   });
  218 | });
  219 | 
  220 | test.afterEach(async () => {
  221 |   if (test.info().status !== test.info().expectedStatus) {
  222 |     console.log(
  223 |       'Hover failure state',
  224 |       JSON.stringify({
  225 |         meeting: (await call(workspace, 'snapshot')).meetings.map((m: any) => ({
  226 |           error: m.error,
  227 |           understoodVersion: m.understoodVersion,
  228 |           calls: m.calls,
  229 |         })),
  230 |         workspace: await native('workspace'),
  231 |         launcher: await native('launcher'),
  232 |         preview: await native('preview'),
  233 |         pointerEvents: await launcher.evaluate(() => (globalThis as any).__pointerEvents),
  234 |       }),
  235 |     );
  236 |   }
  237 |   await cleanupElectron(app, dataDir);
  238 |   server?.closeAllConnections();
  239 |   await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  240 | });
  241 | 
  242 | test('hover shows the actual canvas and live revisions while the workspace stays hidden', async () => {
  243 |   await create();
  244 |   const focusedBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null);
  245 |   await enter();
  246 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  247 |   await expect(preview.getByText('有值得整理的内容时，画板会在这里呈现。')).toBeVisible();
  248 |   expect((await native('workspace')).visible).toBe(false);
  249 |   expect((await native('preview')).focused).toBe(false);
  250 |   expect(
  251 |     await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null),
  252 |   ).toBe(focusedBefore);
  253 |   await ingest(1);
  254 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 1：容量仍待确认。');
  255 |   await expect(preview.locator('.relationship-canvas')).toBeVisible();
  256 |   await expect(preview.locator('table')).toHaveCount(1);
  257 |   await leave(launcher);
  258 |   await preview.mouse.move(40, 30);
  259 |   await preview.locator('.preview-scroll').evaluate((el) => {
  260 |     el.scrollTop = 140;
  261 |   });
  262 |   const before = await preview.locator('.preview-scroll').evaluate((el) => el.scrollTop);
  263 |   await ingest(2);
  264 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 2：容量仍待确认。');
  265 |   expect(await preview.locator('.preview-scroll').evaluate((el) => el.scrollTop)).toBe(before);
  266 |   expect((await native('preview')).visible).toBe(true);
  267 |   expect((await native('workspace')).visible).toBe(false);
  268 |   await preview.locator('.preview-scroll').evaluate((el) => {
  269 |     el.scrollTop = 0;
  270 |   });
  271 |   await preview.screenshot({ path: test.info().outputPath('hover-canvas.png') });
  272 |   await leave(preview);
> 273 |   await expect.poll(async () => (await native('preview')).visible).toBe(false);
      |                                                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  274 |   await ingest(3);
  275 |   await enter();
  276 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  277 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 3：容量仍待确认。');
  278 |   const state = await call(workspace, 'snapshot');
  279 |   expect(state.meetings[0].status).toBe('active');
  280 |   expect(state.meetings[0].capture).toBe('idle');
  281 | });
  282 | 
  283 | test('union-region grace, pending hover cancellation, drag and native menu do not open the workspace', async () => {
  284 |   await create();
  285 |   await enter();
  286 |   await leave(launcher);
  287 |   await new Promise((r) => setTimeout(r, 400));
  288 |   expect((await native('preview')).visible).toBe(false);
  289 |   await enter();
  290 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  291 |   await leave(launcher);
  292 |   await preview.mouse.move(30, 30);
  293 |   await new Promise((r) => setTimeout(r, 400));
  294 |   expect((await native('preview')).visible).toBe(true);
  295 |   await leave(preview);
  296 |   await launcher.mouse.move(20, 20);
  297 |   await new Promise((r) => setTimeout(r, 400));
  298 |   expect((await native('preview')).visible).toBe(true);
  299 |   await launcher.evaluate(() => {
  300 |     (globalThis as any).__pointerEvents = [];
  301 |     for (const type of [
  302 |       'pointerdown',
  303 |       'pointermove',
  304 |       'pointerup',
  305 |       'lostpointercapture',
  306 |       'pointercancel',
  307 |       'mouseover',
  308 |       'mouseout',
  309 |     ])
  310 |       document.addEventListener(type, (e) =>
  311 |         (globalThis as any).__pointerEvents.push({
  312 |           type,
  313 |           buttons: (e as PointerEvent).buttons,
  314 |           x: (e as PointerEvent).screenX,
  315 |           y: (e as PointerEvent).screenY,
  316 |         }),
  317 |       );
  318 |   });
  319 |   await launcher.mouse.down();
  320 |   await launcher.mouse.move(35, 20, { steps: 3 });
  321 |   await call(launcher, 'hover', true); // A queued native enter during a drag cannot show it.
  322 |   await new Promise((r) => setTimeout(r, 400));
  323 |   expect((await native('preview')).visible).toBe(false);
  324 |   await launcher.mouse.up();
  325 |   expect((await native('workspace')).visible).toBe(false);
  326 |   await enter();
  327 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  328 |   await app.evaluate(({ Menu }) => {
  329 |     const original = Menu.prototype.popup;
  330 |     Menu.prototype.popup = function (options) {
  331 |       (globalThis as any).__hoverMenu = this;
  332 |       original.call(this, options);
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
```