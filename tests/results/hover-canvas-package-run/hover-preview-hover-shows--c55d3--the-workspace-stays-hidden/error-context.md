# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hover-preview.spec.ts >> hover shows the actual canvas and live revisions while the workspace stays hidden
- Location: tests/e2e/hover-preview.spec.ts:227:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "Synthetic meeting surface"
Received: undefined
```

# Test source

```ts
  136 |             id: 'comparison',
  137 |             type: 'table',
  138 |             title: '方案比较',
  139 |             columns: ['选项', '支持条件', '当前状态'],
  140 |             rows: [{ id: 'row', cells: ['小范围邀请', '先确认容量', '尚未决定'], sources }],
  141 |           },
  142 |           {
  143 |             ...common,
  144 |             id: 'notes',
  145 |             type: 'text',
  146 |             title: '待核实',
  147 |             items: Array.from({ length: 6 }, (_, i) => `核对项 ${i + 1}：支持容量仍需负责人确认。`),
  148 |           },
  149 |           {
  150 |             ...common,
  151 |             id: 'next',
  152 |             type: 'actions',
  153 |             title: '继续讨论',
  154 |             items: [{ id: 'explore', label: '比较试用路径', prompt: '请比较不同试用路径。', sources }],
  155 |           },
  156 |         ],
  157 |       },
  158 |     };
  159 |     res.setHeader('Content-Type', 'application/json');
  160 |     res.end(
  161 |       JSON.stringify({
  162 |         choices: [{ message: { content: JSON.stringify(proposal) } }],
  163 |         usage: { prompt_tokens: 10, completion_tokens: 10 },
  164 |       }),
  165 |     );
  166 |   });
  167 |   await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  168 |   dataDir = mkdtempSync(join(tmpdir(), 'meeting-desktop-hover-'));
  169 |   const executablePath = process.env.MEETING_HOVER_EXECUTABLE;
  170 |   app = await electron.launch({
  171 |     ...(executablePath ? { executablePath, args: [] } : { args: [resolve('.')] }),
  172 |     env: {
  173 |       ...process.env,
  174 |       MEETING_DEV_INPUTS: '1',
  175 |       MEETING_SYSTEM_LOCALE: 'zh-CN',
  176 |       MEETING_DATA_DIR: dataDir,
  177 |       OPENAI_API_KEY: 'synthetic-only',
  178 |       MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
  179 |       MEETING_STT_API_KEY: '',
  180 |       MEETING_AUTOSTART_PROXY: '0',
  181 |       MEETING_MIN_BATCH_MS: '100',
  182 |     },
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
  197 |   preview.on('pageerror', (e) => console.log('Preview error:', e.message));
  198 |   // A controlled foreground surface verifies that showing the preview leaves focus alone.
  199 |   await app.evaluate(async ({ BrowserWindow }) => {
  200 |     const surface = new BrowserWindow({
  201 |       width: 300,
  202 |       height: 160,
  203 |       x: 30,
  204 |       y: 50,
  205 |       title: 'Synthetic meeting surface',
  206 |       show: false,
  207 |     });
  208 |     await surface.loadURL('data:text/html,<p>Synthetic meeting surface</p>');
  209 |     surface.show();
  210 |     surface.focus();
  211 |   });
  212 | });
  213 | 
  214 | test.afterEach(async () => {
  215 |   if (test.info().status !== test.info().expectedStatus) {
  216 |     console.log('Hover failure state', JSON.stringify({
  217 |       meeting: (await call(workspace, 'snapshot')).meetings.map((m: any) => ({ error: m.error, understoodVersion: m.understoodVersion, calls: m.calls })),
  218 |       workspace: await native('workspace'), launcher: await native('launcher'), preview: await native('preview'),
  219 |       pointerEvents: await launcher.evaluate(() => (globalThis as any).__pointerEvents),
  220 |     }));
  221 |   }
  222 |   await cleanupElectron(app, dataDir);
  223 |   server?.closeAllConnections();
  224 |   await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  225 | });
  226 | 
  227 | test('hover shows the actual canvas and live revisions while the workspace stays hidden', async () => {
  228 |   await create();
  229 |   await enter();
  230 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  231 |   await expect(preview.getByText('有值得整理的内容时，画板会在这里呈现。')).toBeVisible();
  232 |   expect((await native('workspace')).visible).toBe(false);
  233 |   expect((await native('preview')).focused).toBe(false);
  234 |   expect(
  235 |     await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle()),
> 236 |   ).toBe('Synthetic meeting surface');
      |     ^ Error: expect(received).toBe(expected) // Object.is equality
  237 |   await ingest(1);
  238 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 1：容量仍待确认。');
  239 |   await expect(preview.locator('.relationship-canvas')).toBeVisible();
  240 |   await expect(preview.locator('table')).toHaveCount(1);
  241 |   await leave(launcher);
  242 |   await preview.mouse.move(40, 30);
  243 |   await preview.locator('.preview-scroll').evaluate((el) => {
  244 |     el.scrollTop = 140;
  245 |   });
  246 |   const before = await preview.locator('.preview-scroll').evaluate((el) => el.scrollTop);
  247 |   await ingest(2);
  248 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 2：容量仍待确认。');
  249 |   expect(await preview.locator('.preview-scroll').evaluate((el) => el.scrollTop)).toBe(before);
  250 |   expect((await native('preview')).visible).toBe(true);
  251 |   expect((await native('workspace')).visible).toBe(false);
  252 |   await preview.locator('.preview-scroll').evaluate((el) => {
  253 |     el.scrollTop = 0;
  254 |   });
  255 |   await preview.screenshot({ path: test.info().outputPath('hover-canvas.png') });
  256 |   await leave(preview);
  257 |   await expect.poll(async () => (await native('preview')).visible).toBe(false);
  258 |   await ingest(3);
  259 |   await enter();
  260 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  261 |   await expect(preview.locator('.preview-summary')).toHaveText('合成更新 3：容量仍待确认。');
  262 |   const state = await call(workspace, 'snapshot');
  263 |   expect(state.meetings[0].status).toBe('active');
  264 |   expect(state.meetings[0].capture).toBe('idle');
  265 | });
  266 | 
  267 | test('union-region grace, pending hover cancellation, drag and native menu do not open the workspace', async () => {
  268 |   await create();
  269 |   await enter();
  270 |   await leave(launcher);
  271 |   await new Promise((r) => setTimeout(r, 400));
  272 |   expect((await native('preview')).visible).toBe(false);
  273 |   await enter();
  274 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  275 |   await leave(launcher);
  276 |   await preview.mouse.move(30, 30);
  277 |   await new Promise((r) => setTimeout(r, 400));
  278 |   expect((await native('preview')).visible).toBe(true);
  279 |   await leave(preview);
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
```