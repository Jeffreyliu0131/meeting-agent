# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editorial.spec.ts >> editorial: narrow overlay, focus, correction draft, readable zoom and English shell
- Location: tests/e2e/editorial.spec.ts:224:1

# Error details

```
Test timeout of 60000ms exceeded while running "afterEach" hook.
```

# Test source

```ts
  61  |       artifact: {
  62  |         id: 'work',
  63  |         purposeKey: 'pilot',
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
> 161 | test.afterEach(async () => {
      |      ^ Test timeout of 60000ms exceeded while running "afterEach" hook.
  162 |   await cdp?.detach().catch(() => {});
  163 |   if (app) await app.close();
  164 |   server.closeAllConnections();
  165 |   await new Promise<void>((r) => server.close(() => r()));
  166 | });
  167 | test('editorial: stable split, exact numbered sources, preserved reading and contextual feedback draft', async () => {
  168 |   const errors: string[] = [];
  169 |   page.on('pageerror', (e) => errors.push(e.message));
  170 |   const workspace = page.locator('.workspace'),
  171 |     before = await workspace.boundingBox();
  172 |   const source = page
  173 |     .getByRole('row')
  174 |     .filter({ hasText: '支持条件' })
  175 |     .getByRole('button', { name: '查看来源', exact: true });
  176 |   await expect(source).toHaveText('[2]');
  177 |   await source.click();
  178 |   const drawer = page.getByRole('dialog', { name: '查看来源' });
  179 |   await expect(drawer.locator('blockquote')).toHaveText(quotes[1]);
  180 |   const panelBox = (await drawer.boundingBox())!;
  181 |   expect(panelBox.width).toBe(372);
  182 |   expect(panelBox.x).toBe(1116);
  183 |   expect((await workspace.boundingBox())!.x).toBe(before!.x);
  184 |   expect((await workspace.boundingBox())!.width).toBe(before!.width);
  185 |   expect(await drawer.getAttribute('aria-modal')).toBeNull();
  186 |   await drawer.getByRole('button', { name: '查看全部转写' }).click();
  187 |   await expect(drawer.locator('blockquote')).toHaveCount(3);
  188 |   await expect(drawer.locator('[data-cited="true"] blockquote')).toHaveText(quotes[1]);
  189 |   await expect.poll(() => page.locator('.expression-changed').count()).toBe(0);
  190 |   await page.evaluate(() => scrollTo(0, 0));
  191 |   await page.screenshot({ scale: 'css', path: join(output, 'desktop-sources.png') });
  192 |   const originalSummary = await page.locator('.focus-summary').innerText();
  193 |   await ingest('新的补充：支持容量仍未确认。');
  194 |   await expect(page.locator('.reading-update')).toBeVisible();
  195 |   await expect(page.locator('.focus-summary')).toHaveText(originalSummary);
  196 |   await page.getByRole('button', { name: '查看新内容', exact: true }).click();
  197 |   await expect(page.locator('.focus-summary')).toHaveText('有新的原话，支持容量仍待确认。');
  198 |   await drawer.locator('[data-cited="true"]').getByRole('button', { name: '反馈理解' }).click();
  199 |   await expect(drawer).toBeHidden();
  200 |   await expect(page.locator('.ask-bar textarea')).toBeFocused();
  201 |   expect(await page.locator('.ask-bar textarea').inputValue()).toContain(quotes[1]);
  202 |   // Feedback is only a draft; no request was sent to the model.
  203 |   expect(
  204 |     (await snapshot()).meetings[0].segments.filter((s: any) => s.kind === 'request'),
  205 |   ).toHaveLength(0);
  206 |   expect(errors).toEqual([]);
  207 |   writeFileSync(
  208 |     join(output, 'geometry.json'),
  209 |     JSON.stringify(
  210 |       {
  211 |         viewport: { width: 1488, height: 1056 },
  212 |         sourcePanel: panelBox,
  213 |         before,
  214 |         after: await workspace.boundingBox(),
  215 |         errors,
  216 |         synthetic: true,
  217 |         audio: false,
  218 |       },
  219 |       null,
  220 |       2,
  221 |     ),
  222 |   );
  223 | });
  224 | test('editorial: narrow overlay, focus, correction draft, readable zoom and English shell', async () => {
  225 |   await viewport(800, 600);
  226 |   await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  227 |   const drawer = page.getByRole('dialog', { name: '查看来源' });
  228 |   await expect(drawer).toHaveAttribute('aria-modal', 'true');
  229 |   expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  230 |   await drawer.getByRole('button', { name: '纠正来源', exact: true }).first().click();
  231 |   await drawer
  232 |     .getByRole('textbox', { name: '原始发言', exact: true })
  233 |     .fill('纠错草稿：保留这句话。');
  234 |   await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  235 |   await expect(drawer).toBeHidden();
  236 |   expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  237 |   await expect(
  238 |     page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }),
  239 |   ).toBeFocused();
  240 |   await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  241 |   await expect(drawer.getByRole('textbox', { name: '原始发言', exact: true })).toHaveValue(
  242 |     '纠错草稿：保留这句话。',
  243 |   );
  244 |   await page.screenshot({ scale: 'css', path: join(output, 'narrow-correction.png') });
  245 |   await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  246 |   const prefs = (await snapshot()).preferences;
  247 |   await page.evaluate(
  248 |     ({ prefs }) =>
  249 |       window.meeting.call('command', {
  250 |         id: crypto.randomUUID(),
  251 |         meetingId: null,
  252 |         type: 'preferencesPatch',
  253 |         payload: { uiLanguage: 'en' },
  254 |       }),
  255 |     { prefs },
  256 |   );
  257 |   await expect(
  258 |     page.getByRole('navigation').getByRole('button', { name: 'View sources', exact: true }),
  259 |   ).toBeVisible();
  260 |   await page
  261 |     .getByRole('navigation')
```