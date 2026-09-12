# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hover-preview.spec.ts >> sources open the displayed revision and suggested actions only prepare a draft
- Location: tests/e2e/hover-preview.spec.ts:305:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | /** Synthetic meeting and loopback provider; real service, renderer and native windows. No audio. */
  2   | import {
  3   |   test,
  4   |   expect,
  5   |   _electron as electron,
  6   |   type ElectronApplication,
  7   |   type Page,
  8   | } from '@playwright/test';
  9   | import { createServer, type Server } from 'node:http';
  10  | import { mkdtempSync } from 'node:fs';
  11  | import { tmpdir } from 'node:os';
  12  | import { join, resolve } from 'node:path';
  13  | import { cleanupElectron } from './cleanup';
  14  | let app: ElectronApplication,
  15  |   workspace: Page,
  16  |   launcher: Page,
  17  |   preview: Page,
  18  |   server: Server,
  19  |   dataDir: string;
  20  | let meetingId: string;
  21  | const call = async (page: Page, method: string, args?: unknown) => {
  22  |   const r = await page.evaluate(({ method, args }) => window.meeting.call(method, args), {
  23  |     method,
  24  |     args,
  25  |   });
  26  |   expect(r.ok, JSON.stringify(r)).toBe(true);
  27  |   return r.value;
  28  | };
  29  | const command = (type: string, payload: unknown = {}, id: string | null = meetingId) =>
  30  |   call(workspace, 'command', {
  31  |     id: crypto.randomUUID(),
  32  |     meetingId: id,
  33  |     type,
  34  |     payload,
  35  |   });
  36  | const native = (role: string) =>
  37  |   app.evaluate(({ BrowserWindow }, role) => {
  38  |     const w = BrowserWindow.getAllWindows().find((w) =>
  39  |       w.webContents.getURL().includes('role=' + role),
  40  |     )!;
  41  |     return { visible: w.isVisible(), focused: w.isFocused(), bounds: w.getBounds() };
  42  |   }, role);
  43  | const leave = async (page: Page) => page.mouse.move(-20, -20);
  44  | const enter = async () => {
  45  |   await leave(launcher);
  46  |   await launcher.locator('.launcher').hover();
  47  | };
  48  | async function create() {
  49  |   meetingId = await command(
  50  |     'create',
  51  |     {
  52  |       title: '悬停画板 · 合成测试',
  53  |       mode: 'manual',
  54  |       outputLocale: 'zh-CN',
  55  |       timezone: 'Asia/Singapore',
  56  |     },
  57  |     null,
  58  |   );
  59  | }
  60  | async function ingest(n: number) {
  61  |   await command('ingest', {
  62  |     text: `合成发言 ${n}：先确认支持容量，再讨论邀请客户。`,
  63  |     kind: 'manual',
  64  |   });
  65  |   await expect
  66  |     .poll(
  67  |       async () =>
  68  |         (await call(workspace, 'snapshot')).meetings.find((m: any) => m.id === meetingId)
  69  |           ?.understoodVersion,
  70  |     )
> 71  |     .toBe(n);
      |      ^ Error: expect(received).toBe(expected) // Object.is equality
  72  | }
  73  | 
  74  | test.beforeEach(async () => {
  75  |   server = createServer(async (req, res) => {
  76  |     let raw = '';
  77  |     for await (const chunk of req) raw += chunk;
  78  |     const context = JSON.parse(JSON.parse(raw).messages.at(-1).content);
  79  |     const sources = context.segments
  80  |       .filter((s: any) => s.kind !== 'request')
  81  |       .map((s: any) => ({ id: s.id, rev: s.rev }));
  82  |     const ids = ['capacity', 'invite'].map(
  83  |       (detail) => context.objects.find((o: any) => o.detail === detail)?.id ?? detail,
  84  |     );
  85  |     const rel = context.relations[0]?.id ?? 'condition';
  86  |     const common = { sources, objectIds: ids, origin: 'agent_inferred', status: 'unverified' };
  87  |     const proposal = {
  88  |       focus: '如何推进客户试用？',
  89  |       changes: [`合成更新 ${context.inputVersion}：容量仍待确认。`],
  90  |       objects: ids.map((id, i) => ({
  91  |         id,
  92  |         kind: i ? 'task' : 'constraint',
  93  |         title: i ? '邀请客户' : '确认支持容量',
  94  |         detail: i ? 'invite' : 'capacity',
  95  |         origin: 'stated',
  96  |         status: 'unverified',
  97  |         sources,
  98  |         lifecycle: 'active',
  99  |       })),
  100 |       relations: [
  101 |         {
  102 |           id: rel,
  103 |           from: ids[0],
  104 |           to: ids[1],
  105 |           kind: 'conditions',
  106 |           origin: 'agent_inferred',
  107 |           sources,
  108 |         },
  109 |       ],
  110 |       action: 'create_artifact',
  111 |       rationale: 'Synthetic hover canvas test',
  112 |       artifact: {
  113 |         id: 'hover_work',
  114 |         purposeKey: 'customer_pilot',
  115 |         question: '如何推进客户试用？',
  116 |         summary: `合成更新 ${context.inputVersion}：容量仍待确认。`,
  117 |         layout: 'stack',
  118 |         objectIds: ids,
  119 |         sources,
  120 |         formulas: [],
  121 |         blocks: [
  122 |           {
  123 |             ...common,
  124 |             id: 'flow',
  125 |             type: 'diagram',
  126 |             title: '推进条件',
  127 |             layout: 'flow',
  128 |             nodes: [
  129 |               { id: 'a', objectId: ids[0], label: '确认支持容量' },
  130 |               { id: 'b', objectId: ids[1], label: '邀请客户' },
  131 |             ],
  132 |             edges: [{ from: 'a', to: 'b', relationId: rel, label: '成立条件' }],
  133 |           },
  134 |           {
  135 |             ...common,
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
  154 |             items: [{ id: 'explore', label: '比较试用路径', prompt: '请比较不同试用路径。' }],
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
```