# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editorial.spec.ts >> editorial: explicit history navigation releases reading hold and failed corrections stay actionable
- Location: tests/e2e/editorial.spec.ts:375:1

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
  162 |   // These disposable UI fixtures do not exercise the native quit-confirmation flow.
  163 |   // Terminate only PIDs reported by this launched Electron instance, including its
  164 |   // utility process, so modal confirmation and inherited stdio cannot hold the runner.
  165 |   if (app) {
  166 |     const owned = await app
  167 |       .evaluate(({ app }) => app.getAppMetrics().map((metric) => metric.pid))
  168 |       .catch(() => [] as number[]);
  169 |     const child = app.process();
  170 |     const pids = [...new Set([child.pid!, ...owned])].filter(
  171 |       (pid) => pid > 0 && pid !== process.pid,
  172 |     );
  173 |     for (const pid of pids) {
  174 |       try {
  175 |         process.kill(pid, 'SIGKILL');
  176 |       } catch (error) {
  177 |         if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  178 |       }
  179 |     }
  180 |     await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
  181 |   }
  182 |   server.closeAllConnections();
  183 |   await new Promise<void>((r) => server.close(() => r()));
  184 | });
  185 | test('editorial: stable split, exact numbered sources, preserved reading and contextual feedback draft', async () => {
  186 |   const errors: string[] = [];
  187 |   page.on('pageerror', (e) => errors.push(e.message));
  188 |   const workspace = page.locator('.workspace'),
  189 |     before = await workspace.boundingBox();
  190 |   const source = page
  191 |     .getByRole('row')
  192 |     .filter({ hasText: '支持条件' })
  193 |     .getByRole('button', { name: '查看来源', exact: true });
  194 |   await expect(source).toHaveText('[2]');
  195 |   await source.click();
  196 |   const drawer = page.getByRole('dialog', { name: '查看来源' });
  197 |   await expect(drawer.locator('blockquote')).toHaveText(quotes[1]);
  198 |   const panelBox = (await drawer.boundingBox())!;
  199 |   expect(panelBox.width).toBe(372);
  200 |   expect(panelBox.x).toBe(1116);
  201 |   expect((await workspace.boundingBox())!.x).toBe(before!.x);
  202 |   expect((await workspace.boundingBox())!.width).toBe(before!.width);
  203 |   expect(await drawer.getAttribute('aria-modal')).toBeNull();
  204 |   await drawer.getByRole('button', { name: '查看全部转写' }).click();
  205 |   await expect(drawer.locator('blockquote')).toHaveCount(3);
  206 |   await expect(drawer.locator('[data-cited="true"] blockquote')).toHaveText(quotes[1]);
  207 |   await expect.poll(() => page.locator('.expression-changed').count()).toBe(0);
  208 |   await page.evaluate(() => scrollTo(0, 0));
  209 |   await page.screenshot({ scale: 'css', path: join(output, 'desktop-sources.png') });
  210 |   const originalSummary = await page.locator('.focus-summary').innerText();
  211 |   await ingest('新的补充：支持容量仍未确认。');
  212 |   await expect(page.locator('.reading-update')).toBeVisible();
  213 |   await expect(page.locator('.focus-summary')).toHaveText(originalSummary);
  214 |   await page.getByRole('button', { name: '查看新内容', exact: true }).click();
  215 |   await expect(page.locator('.focus-summary')).toHaveText('有新的原话，支持容量仍待确认。');
  216 |   await drawer.locator('[data-cited="true"]').getByRole('button', { name: '反馈理解' }).click();
  217 |   await expect(drawer).toBeHidden();
  218 |   await expect(page.locator('.ask-bar textarea')).toBeFocused();
  219 |   expect(await page.locator('.ask-bar textarea').inputValue()).toContain(quotes[1]);
  220 |   // Feedback is only a draft; no request was sent to the model.
  221 |   expect(
  222 |     (await snapshot()).meetings[0].segments.filter((s: any) => s.kind === 'request'),
  223 |   ).toHaveLength(0);
  224 |   expect(errors).toEqual([]);
  225 |   writeFileSync(
  226 |     join(output, 'geometry.json'),
  227 |     JSON.stringify(
  228 |       {
  229 |         viewport: { width: 1488, height: 1056 },
  230 |         sourcePanel: panelBox,
  231 |         before,
  232 |         after: await workspace.boundingBox(),
  233 |         errors,
  234 |         synthetic: true,
  235 |         audio: false,
  236 |       },
  237 |       null,
  238 |       2,
  239 |     ),
  240 |   );
  241 | });
  242 | test('editorial: narrow overlay, focus, correction draft, readable zoom and English shell', async () => {
  243 |   await viewport(800, 600);
  244 |   await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  245 |   const drawer = page.getByRole('dialog', { name: '查看来源' });
  246 |   await expect(drawer).toHaveAttribute('aria-modal', 'true');
  247 |   expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  248 |   await drawer.getByRole('button', { name: '纠正来源', exact: true }).first().click();
  249 |   await drawer
  250 |     .getByRole('textbox', { name: '原始发言', exact: true })
  251 |     .fill('纠错草稿：保留这句话。');
  252 |   await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  253 |   await expect(drawer).toBeHidden();
  254 |   expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  255 |   await expect(
  256 |     page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }),
  257 |   ).toBeFocused();
  258 |   await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  259 |   await expect(drawer.getByRole('textbox', { name: '原始发言', exact: true })).toHaveValue(
  260 |     '纠错草稿：保留这句话。',
  261 |   );
```