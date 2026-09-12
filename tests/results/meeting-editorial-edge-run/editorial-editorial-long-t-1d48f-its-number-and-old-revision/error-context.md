# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editorial.spec.ts >> editorial: long transcript preserves scroll and corrected source keeps its number and old revision
- Location: tests/e2e/editorial.spec.ts:314:1

# Error details

```
TimeoutError: electronApplication.waitForEvent: Timeout 30000ms exceeded while waiting for event "close"
```

# Test source

```ts
  64  |         question: '首批试点应该邀请谁？',
  65  |         summary:
  66  |           c.segments.length > 3
  67  |             ? '有新的原话，支持容量仍待确认。'
  68  |             : '两种路径仍在比较，支持容量是关键条件。',
  69  |         layout: 'stack',
  70  |         objectIds: [],
  71  |         sources,
  72  |         formulas: [],
  73  |         blocks: [
  74  |           {
  75  |             ...common,
  76  |             id: 'comparison',
  77  |             type: 'table',
  78  |             title: '方案比较',
  79  |             columns: ['比较维度', '内部试用', '白名单客户试用'],
  80  |             rows: [
  81  |               {
  82  |                 id: 'feedback',
  83  |                 cells: ['反馈价值', '快速发现基础问题', '验证真实客户场景'],
  84  |                 sources: sources.slice(0, 1),
  85  |               },
  86  |               {
  87  |                 id: 'support',
  88  |                 cells: ['支持条件', '支持负担较低', '需确认支持容量'],
  89  |                 sources: [support],
  90  |               },
  91  |               {
  92  |                 id: 'scope',
  93  |                 cells: ['开放方式', '内部团队', '邀请范围待定'],
  94  |                 sources: sources.slice(0, 1),
  95  |               },
  96  |             ],
  97  |           },
  98  |           {
  99  |             ...common,
  100 |             id: 'pending',
  101 |             type: 'text',
  102 |             title: '待核实',
  103 |             items: [
  104 |               '支持容量：支持团队是否能承接客户试用？',
  105 |               '邀请范围：具体客户与邀请规模尚未确定。',
  106 |               '帮助中心文案：负责人尚未确定。',
  107 |             ],
  108 |           },
  109 |         ],
  110 |       },
  111 |     };
  112 |     res.setHeader('Content-Type', 'application/json');
  113 |     res.end(
  114 |       JSON.stringify({
  115 |         choices: [{ message: { content: JSON.stringify(reply) } }],
  116 |         usage: { prompt_tokens: 10, completion_tokens: 10 },
  117 |       }),
  118 |     );
  119 |   });
  120 |   await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  121 |   const dir = mkdtempSync(join(tmpdir(), 'editorial-synthetic-'));
  122 |   app = await electron.launch({
  123 |     args: [resolve('.')],
  124 |     env: {
  125 |       ...process.env,
  126 |       MEETING_DEV_INPUTS: '1',
  127 |       MEETING_SYSTEM_LOCALE: 'zh-CN',
  128 |       MEETING_DATA_DIR: dir,
  129 |       OPENAI_API_KEY: 'synthetic-only',
  130 |       MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
  131 |       MEETING_STT_API_KEY: '',
  132 |       MEETING_MIN_BATCH_MS: '100',
  133 |     },
  134 |   });
  135 |   await expect
  136 |     .poll(async () => {
  137 |       page = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
  138 |       return !!page;
  139 |     })
  140 |     .toBe(true);
  141 |   await page.waitForFunction(() => !!window.meeting);
  142 |   await app.evaluate(({ BrowserWindow }) => {
  143 |     const w = BrowserWindow.getAllWindows().find((w) =>
  144 |       w.webContents.getURL().includes('role=workspace'),
  145 |     );
  146 |     w?.show();
  147 |   });
  148 |   await viewport(1488, 1056);
  149 |   await page.getByText('开发测试工具', { exact: true }).click();
  150 |   await page.getByRole('button', { name: '开发测试输入', exact: true }).click();
  151 |   await page.getByRole('dialog').locator('input').first().fill('试点开放范围讨论 · 合成演示');
  152 |   await page.getByRole('dialog').locator('select').last().selectOption('zh-CN');
  153 |   await page.getByRole('dialog').getByRole('button', { name: '开始会议', exact: true }).click();
  154 |   meetingId = (await snapshot()).meetings[0].id;
  155 |   for (const quote of quotes) await ingest(quote);
  156 |   await expect
  157 |     .poll(async () => (await snapshot()).meetings[0].artifacts.at(-1)?.sources.length)
  158 |     .toBe(3);
  159 |   await expect(page.getByText('方案比较', { exact: true })).toBeVisible();
  160 | });
  161 | test.afterEach(async () => {
  162 |   await cdp?.detach().catch(() => {});
  163 |   if (app && app.process().exitCode === null) {
> 164 |     const closed = app.waitForEvent('close');
      |                        ^ TimeoutError: electronApplication.waitForEvent: Timeout 30000ms exceeded while waiting for event "close"
  165 |     await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  166 |     await closed;
  167 |   }
  168 |   server.closeAllConnections();
  169 |   await new Promise<void>((r) => server.close(() => r()));
  170 | });
  171 | test('editorial: stable split, exact numbered sources, preserved reading and contextual feedback draft', async () => {
  172 |   const errors: string[] = [];
  173 |   page.on('pageerror', (e) => errors.push(e.message));
  174 |   const workspace = page.locator('.workspace'),
  175 |     before = await workspace.boundingBox();
  176 |   const source = page
  177 |     .getByRole('row')
  178 |     .filter({ hasText: '支持条件' })
  179 |     .getByRole('button', { name: '查看来源', exact: true });
  180 |   await expect(source).toHaveText('[2]');
  181 |   await source.click();
  182 |   const drawer = page.getByRole('dialog', { name: '查看来源' });
  183 |   await expect(drawer.locator('blockquote')).toHaveText(quotes[1]);
  184 |   const panelBox = (await drawer.boundingBox())!;
  185 |   expect(panelBox.width).toBe(372);
  186 |   expect(panelBox.x).toBe(1116);
  187 |   expect((await workspace.boundingBox())!.x).toBe(before!.x);
  188 |   expect((await workspace.boundingBox())!.width).toBe(before!.width);
  189 |   expect(await drawer.getAttribute('aria-modal')).toBeNull();
  190 |   await drawer.getByRole('button', { name: '查看全部转写' }).click();
  191 |   await expect(drawer.locator('blockquote')).toHaveCount(3);
  192 |   await expect(drawer.locator('[data-cited="true"] blockquote')).toHaveText(quotes[1]);
  193 |   await expect.poll(() => page.locator('.expression-changed').count()).toBe(0);
  194 |   await page.evaluate(() => scrollTo(0, 0));
  195 |   await page.screenshot({ scale: 'css', path: join(output, 'desktop-sources.png') });
  196 |   const originalSummary = await page.locator('.focus-summary').innerText();
  197 |   await ingest('新的补充：支持容量仍未确认。');
  198 |   await expect(page.locator('.reading-update')).toBeVisible();
  199 |   await expect(page.locator('.focus-summary')).toHaveText(originalSummary);
  200 |   await page.getByRole('button', { name: '查看新内容', exact: true }).click();
  201 |   await expect(page.locator('.focus-summary')).toHaveText('有新的原话，支持容量仍待确认。');
  202 |   await drawer.locator('[data-cited="true"]').getByRole('button', { name: '反馈理解' }).click();
  203 |   await expect(drawer).toBeHidden();
  204 |   await expect(page.locator('.ask-bar textarea')).toBeFocused();
  205 |   expect(await page.locator('.ask-bar textarea').inputValue()).toContain(quotes[1]);
  206 |   // Feedback is only a draft; no request was sent to the model.
  207 |   expect(
  208 |     (await snapshot()).meetings[0].segments.filter((s: any) => s.kind === 'request'),
  209 |   ).toHaveLength(0);
  210 |   expect(errors).toEqual([]);
  211 |   writeFileSync(
  212 |     join(output, 'geometry.json'),
  213 |     JSON.stringify(
  214 |       {
  215 |         viewport: { width: 1488, height: 1056 },
  216 |         sourcePanel: panelBox,
  217 |         before,
  218 |         after: await workspace.boundingBox(),
  219 |         errors,
  220 |         synthetic: true,
  221 |         audio: false,
  222 |       },
  223 |       null,
  224 |       2,
  225 |     ),
  226 |   );
  227 | });
  228 | test('editorial: narrow overlay, focus, correction draft, readable zoom and English shell', async () => {
  229 |   await viewport(800, 600);
  230 |   await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  231 |   const drawer = page.getByRole('dialog', { name: '查看来源' });
  232 |   await expect(drawer).toHaveAttribute('aria-modal', 'true');
  233 |   expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  234 |   await drawer.getByRole('button', { name: '纠正来源', exact: true }).first().click();
  235 |   await drawer
  236 |     .getByRole('textbox', { name: '原始发言', exact: true })
  237 |     .fill('纠错草稿：保留这句话。');
  238 |   await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  239 |   await expect(drawer).toBeHidden();
  240 |   expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  241 |   await expect(
  242 |     page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }),
  243 |   ).toBeFocused();
  244 |   await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  245 |   await expect(drawer.getByRole('textbox', { name: '原始发言', exact: true })).toHaveValue(
  246 |     '纠错草稿：保留这句话。',
  247 |   );
  248 |   await page.screenshot({ scale: 'css', path: join(output, 'narrow-correction.png') });
  249 |   await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  250 |   const prefs = (await snapshot()).preferences;
  251 |   await page.evaluate(
  252 |     ({ prefs }) =>
  253 |       window.meeting.call('command', {
  254 |         id: crypto.randomUUID(),
  255 |         meetingId: null,
  256 |         type: 'preferencesPatch',
  257 |         payload: { uiLanguage: 'en' },
  258 |       }),
  259 |     { prefs },
  260 |   );
  261 |   await expect(
  262 |     page.getByRole('navigation').getByRole('button', { name: 'View sources', exact: true }),
  263 |   ).toBeVisible();
  264 |   await page
```