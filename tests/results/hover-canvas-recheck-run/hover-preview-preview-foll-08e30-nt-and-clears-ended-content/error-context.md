# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hover-preview.spec.ts >> preview follows display edges, stays readable at 200 percent, and clears ended content
- Location: tests/e2e/hover-preview.spec.ts:336:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /打开会议/ }).last()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: /打开会议/ }).last() with timeout 10000ms
  - waiting for getByRole('button', { name: /打开会议/ }).last()

```

```yaml
- region "会议画板":
  - text: 会议画板 会议已打开 · 未录音
  - heading "悬停画板 · 合成测试" [level=1]
  - article:
    - heading "如何推进客户试用？" [level=2]
    - paragraph: 合成更新 1：容量仍待确认。
    - heading "推进条件" [level=2]
    - 'button "查看来源: 推进条件"': "1"
    - text: Agent解释／建议 待核实 依赖与流程 2 个要点 · 1 条关联
    - button "确认支持容量"
    - button "邀请客户"
    - button "成立条件"
    - group: 查看文字关系
    - heading "方案比较" [level=2]
    - 'button "查看来源: 方案比较"': "1"
    - text: Agent解释／建议 待核实
    - table:
      - rowgroup:
        - row "选项 支持条件 当前状态":
          - columnheader "选项"
          - columnheader "支持条件"
          - columnheader "当前状态"
      - rowgroup:
        - row "小范围邀请 先确认容量 尚未决定 查看来源":
          - cell "小范围邀请"
          - cell "先确认容量"
          - cell "尚未决定 查看来源":
            - text: 尚未决定
            - button "查看来源": "[1]"
    - heading "待核实" [level=2]
    - 'button "查看来源: 待核实"': "1"
    - text: Agent解释／建议 待核实
    - list:
      - listitem: 核对项 1：支持容量仍需负责人确认。
      - listitem: 核对项 2：支持容量仍需负责人确认。
      - listitem: 核对项 3：支持容量仍需负责人确认。
      - listitem: 核对项 4：支持容量仍需负责人确认。
      - listitem: 核对项 5：支持容量仍需负责人确认。
      - listitem: 核对项 6：支持容量仍需负责人确认。
    - heading "继续讨论" [level=2]
    - 'button "查看来源: 继续讨论"': "1"
    - text: Agent解释／建议 待核实
    - button "比较试用路径"
  - button "打开工作页"
```

# Test source

```ts
  267 |   await create();
  268 |   await enter();
  269 |   await leave(launcher);
  270 |   await new Promise((r) => setTimeout(r, 400));
  271 |   expect((await native('preview')).visible).toBe(false);
  272 |   await enter();
  273 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  274 |   await leave(launcher);
  275 |   await preview.mouse.move(30, 30);
  276 |   await new Promise((r) => setTimeout(r, 400));
  277 |   expect((await native('preview')).visible).toBe(true);
  278 |   await leave(preview);
  279 |   await launcher.mouse.move(20, 20);
  280 |   await new Promise((r) => setTimeout(r, 400));
  281 |   expect((await native('preview')).visible).toBe(true);
  282 |   await launcher.evaluate(() => {
  283 |     (globalThis as any).__pointerEvents = [];
  284 |     for (const type of ['pointerdown', 'pointermove', 'pointerup', 'lostpointercapture', 'pointercancel', 'mouseover', 'mouseout'])
  285 |       document.addEventListener(type, (e) => (globalThis as any).__pointerEvents.push({ type, buttons: (e as PointerEvent).buttons, x: (e as PointerEvent).screenX, y: (e as PointerEvent).screenY }));
  286 |   });
  287 |   await launcher.mouse.down();
  288 |   await launcher.mouse.move(35, 20, { steps: 3 });
  289 |   await call(launcher, 'hover', true); // A queued native enter during a drag cannot show it.
  290 |   await new Promise((r) => setTimeout(r, 400));
  291 |   expect((await native('preview')).visible).toBe(false);
  292 |   await launcher.mouse.up();
  293 |   expect((await native('workspace')).visible).toBe(false);
  294 |   await enter();
  295 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  296 |   await app.evaluate(({ Menu }) => {
  297 |     const original = Menu.prototype.popup;
  298 |     Menu.prototype.popup = function (options) {
  299 |       (globalThis as any).__hoverMenu = this;
  300 |       original.call(this, options);
  301 |     };
  302 |   });
  303 |   await call(launcher, 'menu');
  304 |   await call(launcher, 'hover', true);
  305 |   await new Promise((r) => setTimeout(r, 400));
  306 |   expect((await native('preview')).visible).toBe(false);
  307 |   await app.evaluate(() => (globalThis as any).__hoverMenu.closePopup());
  308 |   expect((await native('workspace')).visible).toBe(false);
  309 |   // Explicit click still opens exactly one persistent workspace.
  310 |   await launcher.locator('.launcher').click();
  311 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  312 |   await leave(launcher);
  313 |   await new Promise((r) => setTimeout(r, 400));
  314 |   expect((await native('workspace')).visible).toBe(true);
  315 | });
  316 | 
  317 | test('sources open the displayed revision and suggested actions only prepare a draft', async () => {
  318 |   await create();
  319 |   await ingest(1);
  320 |   await enter();
  321 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  322 |   await preview.getByRole('button', { name: '查看来源: 推进条件', exact: true }).click();
  323 |   await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  324 |   await expect(workspace.locator('.source-panel')).toContainText('合成发言 1');
  325 |   expect((await native('preview')).visible).toBe(false);
  326 |   await call(workspace, 'hide');
  327 |   await enter();
  328 |   await expect.poll(async () => (await native('preview')).visible).toBe(true);
  329 |   await preview.getByRole('button', { name: '比较试用路径', exact: true }).click();
  330 |   await expect(workspace.locator('textarea.ask-input')).toHaveValue('请比较不同试用路径。');
  331 |   const state = await call(workspace, 'snapshot');
  332 |   expect(state.meetings[0].segments).toHaveLength(1);
  333 |   expect(state.meetings[0].requests).toHaveLength(0);
  334 | });
  335 | 
  336 | test('preview follows display edges, stays readable at 200 percent, and clears ended content', async () => {
  337 |   await create();
  338 |   await ingest(1);
  339 |   for (const side of ['left', 'right']) {
  340 |     await call(launcher, 'hover', false);
  341 |     await call(preview, 'hover', false);
  342 |     await expect.poll(async () => (await native('preview')).visible).toBe(false);
  343 |     await app.evaluate(({ BrowserWindow, screen }, side) => {
  344 |       const w = BrowserWindow.getAllWindows().find((w) =>
  345 |         w.webContents.getURL().includes('role=launcher'),
  346 |       )!;
  347 |       const a = screen.getPrimaryDisplay().workArea;
  348 |       w.setPosition(side === 'left' ? a.x + 12 : a.x + a.width - 56, a.y + a.height - 60);
  349 |     }, side);
  350 |     await enter();
  351 |     await expect.poll(async () => (await native('preview')).visible).toBe(true);
  352 |     const p = (await native('preview')).bounds,
  353 |       b = (await native('launcher')).bounds;
  354 |     const a = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  355 |     expect(p.x).toBeGreaterThanOrEqual(a.x);
  356 |     expect(p.y + p.height).toBeLessThanOrEqual(a.y + a.height);
  357 |     expect(side === 'left' ? p.x >= b.x + b.width : p.x + p.width <= b.x).toBe(true);
  358 |   }
  359 |   await app.evaluate(({ BrowserWindow }) =>
  360 |     BrowserWindow.getAllWindows()
  361 |       .find((w) => w.webContents.getURL().includes('role=preview'))!
  362 |       .webContents.setZoomFactor(2),
  363 |   );
  364 |   await expect
  365 |     .poll(() => preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  366 |     .toBe(true);
> 367 |   await expect(preview.getByRole('button', { name: /打开会议/ }).last()).toBeVisible();
      |                                                                      ^ Error: expect(locator).toBeVisible() failed
  368 |   await preview.screenshot({ path: test.info().outputPath('hover-canvas-200.png') });
  369 |   await app.evaluate(({ BrowserWindow }) =>
  370 |     BrowserWindow.getAllWindows()
  371 |       .find((w) => w.webContents.getURL().includes('role=preview'))!
  372 |       .webContents.setZoomFactor(1),
  373 |   );
  374 |   await command('end');
  375 |   await expect(preview.locator('.preview-canvas')).toHaveCount(0);
  376 |   await expect(preview.getByText('还没有正在进行的会议')).toBeVisible();
  377 |   await command('preferencesPatch', { uiLanguage: 'en' }, null);
  378 |   await expect(preview.getByText('No meeting in progress')).toBeVisible();
  379 | });
  380 | 
```