# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editorial.spec.ts >> editorial: long transcript preserves scroll and corrected source keeps its number and old revision
- Location: tests/e2e/editorial.spec.ts:325:1

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
  162 |   // Explicitly end this isolated synthetic event before normal application quit;
  163 |   // otherwise the real app correctly asks the user to confirm an active meeting.
  164 |   if (page && !page.isClosed())
  165 |     await page
  166 |       .evaluate(async () => {
  167 |         const response = await window.meeting.call('snapshot');
  168 |         for (const meeting of response.value.meetings.filter((m: any) => m.status === 'active'))
  169 |           await window.meeting.call('command', {
  170 |             id: crypto.randomUUID(),
  171 |             meetingId: meeting.id,
  172 |             type: 'end',
  173 |             payload: {},
  174 |           });
  175 |       })
  176 |       .catch(() => {});
  177 |   await cdp?.detach().catch(() => {});
  178 |   if (app) await app.close();
  179 |   server.closeAllConnections();
  180 |   await new Promise<void>((r) => server.close(() => r()));
  181 | });
  182 | test('editorial: stable split, exact numbered sources, preserved reading and contextual feedback draft', async () => {
  183 |   const errors: string[] = [];
  184 |   page.on('pageerror', (e) => errors.push(e.message));
  185 |   const workspace = page.locator('.workspace'),
  186 |     before = await workspace.boundingBox();
  187 |   const source = page
  188 |     .getByRole('row')
  189 |     .filter({ hasText: '支持条件' })
  190 |     .getByRole('button', { name: '查看来源', exact: true });
  191 |   await expect(source).toHaveText('[2]');
  192 |   await source.click();
  193 |   const drawer = page.getByRole('dialog', { name: '查看来源' });
  194 |   await expect(drawer.locator('blockquote')).toHaveText(quotes[1]);
  195 |   const panelBox = (await drawer.boundingBox())!;
  196 |   expect(panelBox.width).toBe(372);
  197 |   expect(panelBox.x).toBe(1116);
  198 |   expect((await workspace.boundingBox())!.x).toBe(before!.x);
  199 |   expect((await workspace.boundingBox())!.width).toBe(before!.width);
  200 |   expect(await drawer.getAttribute('aria-modal')).toBeNull();
  201 |   await drawer.getByRole('button', { name: '查看全部转写' }).click();
  202 |   await expect(drawer.locator('blockquote')).toHaveCount(3);
  203 |   await expect(drawer.locator('[data-cited="true"] blockquote')).toHaveText(quotes[1]);
  204 |   await expect.poll(() => page.locator('.expression-changed').count()).toBe(0);
  205 |   await page.evaluate(() => scrollTo(0, 0));
  206 |   await page.screenshot({ scale: 'css', path: join(output, 'desktop-sources.png') });
  207 |   const originalSummary = await page.locator('.focus-summary').innerText();
  208 |   await ingest('新的补充：支持容量仍未确认。');
  209 |   await expect(page.locator('.reading-update')).toBeVisible();
  210 |   await expect(page.locator('.focus-summary')).toHaveText(originalSummary);
  211 |   await page.getByRole('button', { name: '查看新内容', exact: true }).click();
  212 |   await expect(page.locator('.focus-summary')).toHaveText('有新的原话，支持容量仍待确认。');
  213 |   await drawer.locator('[data-cited="true"]').getByRole('button', { name: '反馈理解' }).click();
  214 |   await expect(drawer).toBeHidden();
  215 |   await expect(page.locator('.ask-bar textarea')).toBeFocused();
  216 |   expect(await page.locator('.ask-bar textarea').inputValue()).toContain(quotes[1]);
  217 |   // Feedback is only a draft; no request was sent to the model.
  218 |   expect(
  219 |     (await snapshot()).meetings[0].segments.filter((s: any) => s.kind === 'request'),
  220 |   ).toHaveLength(0);
  221 |   expect(errors).toEqual([]);
  222 |   writeFileSync(
  223 |     join(output, 'geometry.json'),
  224 |     JSON.stringify(
  225 |       {
  226 |         viewport: { width: 1488, height: 1056 },
  227 |         sourcePanel: panelBox,
  228 |         before,
  229 |         after: await workspace.boundingBox(),
  230 |         errors,
  231 |         synthetic: true,
  232 |         audio: false,
  233 |       },
  234 |       null,
  235 |       2,
  236 |     ),
  237 |   );
  238 | });
  239 | test('editorial: narrow overlay, focus, correction draft, readable zoom and English shell', async () => {
  240 |   await viewport(800, 600);
  241 |   await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  242 |   const drawer = page.getByRole('dialog', { name: '查看来源' });
  243 |   await expect(drawer).toHaveAttribute('aria-modal', 'true');
  244 |   expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  245 |   await drawer.getByRole('button', { name: '纠正来源', exact: true }).first().click();
  246 |   await drawer
  247 |     .getByRole('textbox', { name: '原始发言', exact: true })
  248 |     .fill('纠错草稿：保留这句话。');
  249 |   await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  250 |   await expect(drawer).toBeHidden();
  251 |   expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  252 |   await expect(
  253 |     page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }),
  254 |   ).toBeFocused();
  255 |   await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  256 |   await expect(drawer.getByRole('textbox', { name: '原始发言', exact: true })).toHaveValue(
  257 |     '纠错草稿：保留这句话。',
  258 |   );
  259 |   await page.screenshot({ scale: 'css', path: join(output, 'narrow-correction.png') });
  260 |   await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  261 |   const prefs = (await snapshot()).preferences;
```