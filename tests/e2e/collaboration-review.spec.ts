/** Transport doubles only: verifies real M/C/R routing and host UX, not model accuracy. */
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanupElectron } from './cleanup';

test('agent prepares four families; host reviews and distributes each without filling a form', async () => {
  let enabledSeen = false;
  const generated: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      context = JSON.parse(body.messages.at(-1).content);
    let value: any;
    if (context.preparationPolicy) {
      const c = context.input,
        kind = c.intent.family;
      generated.push(kind);
      const audienceIds = c.participants
        .filter((p: any) => p.role === 'participant')
        .map((p: any) => p.id);
      let payload: any;
      if (kind === 'poll')
        payload = {
          question: '先采用哪种试点？',
          contextSummary: '根据前文三种范围',
          options: ['内部', '五位客户', '先内部再客户'].map((label, i) => ({
            id: 'o' + i,
            label,
            description: '',
            objectRefs: [],
          })),
          selection: { mode: 'single', min: 1, max: 1 },
          allowAbstain: true,
          resultsVisibility: 'after_close',
          closePolicy: { kind: 'host' },
        };
      else if (kind === 'assignment')
        payload = {
          mode: 'request_acceptance',
          items: [
            {
              id: 'task-a',
              itemRevision: 1,
              taskRef: null,
              title: '完成原型',
              deliverable: '可交互原型',
              assigneeId: audienceIds[0],
              unresolvedAssigneeText: null,
              collaboratorIds: [],
              schedule: {
                rawText: '时间待确认',
                timezone: null,
                start: null,
                end: null,
                dueDate: null,
                dueAt: null,
                precision: 'unknown',
                exclusive: null,
              },
              dependencyRefs: [],
              discussionPoints: [],
              conflictIds: [],
            },
          ],
        };
      else if (kind === 'conflict') {
        const f = c.conflicts.at(-1);
        payload = {
          conflictRefs: [{ id: f.id, rev: f.revision }],
          sides: [
            {
              id: 'side',
              title: f.summary,
              description: f.impact,
              objectRefs: f.objectRefs,
              evidence: f.evidence,
            },
          ],
          questions: [{ id: 'q', text: '请确认可接受的延期时间', participantIds: audienceIds }],
          resolutions: [],
        };
      } else
        payload = {
          statement: '采用内部试点',
          scopeText: '参与者A、B、C',
          conditions: [],
          targetObjectRefs: [],
          supportingResults: [],
          requiredParticipantIds: audienceIds,
          rule: 'all_required_explicit_agree',
        };
      value = { content: { kind, payload }, audienceIds, clarification: null };
    } else if (context.input) value = { conflicts: [] };
    else {
      enabledSeen ||= context.collaboration?.enabled === true;
      const segment = context.segments.at(-1),
        text = segment?.text ?? '';
      const family = text.includes('各自选一个方向')
        ? 'poll'
        : text.includes('原型这块交给A')
          ? 'assignment'
          : text.includes('大家再核对一下')
            ? 'decision_confirmation'
            : null;
      value = {
        focus: '合成协作测试',
        changes: [],
        objects: [],
        relations: [],
        action: 'no_change',
        artifact: null,
        rationale: '',
        collaborationIntents: family
          ? [
              {
                family,
                operation: 'prepare',
                expression: 'suggested',
                resolution: 'actionable_draft',
                targetId: null,
                scopeText: text,
                collectionMode: 'retrospective',
                sourceRefs: [{ id: segment.id, rev: segment.rev }],
                objectRefs: [],
              },
            ]
          : [],
      };
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 30, completion_tokens: 80 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const dir = mkdtempSync(join(tmpdir(), 'meeting-desktop-review-'));
  const app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      MEETING_DATA_DIR: dir,
      MEETING_DEV_INPUTS: '1',
      MEETING_SYSTEM_LOCALE: 'zh-CN',
      OPENAI_API_KEY: 'synthetic',
      MEETING_API_BASE: base,
      MEETING_MODEL: 'synthetic',
      MEETING_STT_API_KEY: '',
      MEETING_MIN_BATCH_MS: '100',
    },
  });
  try {
    await expect
      .poll(async () => (await app.windows()).some((p) => p.url().includes('role=workspace')))
      .toBe(true);
    const host = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
    await host.waitForFunction(() => !!window.meeting);
    const created = await host.evaluate(() =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        type: 'create',
        meetingId: null,
        payload: {
          title: 'Agent审核流程',
          mode: 'microphone',
          outputLocale: 'zh-CN',
          timezone: 'Asia/Shanghai',
        },
      }),
    );
    expect(created.ok).toBe(true);
    const meetingId = created.value as string;
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('role=workspace'))
        ?.show(),
    );
    await host.getByText('Agent审核流程', { exact: true }).first().click();
    await expect(host.getByRole('button', { name: '开启本地协作模拟', exact: true })).toHaveCount(
      0,
    );
    const snapshot = async () =>
      (
        await host.evaluate(
          (meetingId) => window.meeting.call('collaborationSnapshot', { meetingId }),
          meetingId,
        )
      ).value;
    const speak = async (text: string) => {
      const r = await host.evaluate(
        ({ meetingId, text }) =>
          window.meeting.call('command', {
            id: crypto.randomUUID(),
            type: 'ingest',
            meetingId,
            payload: { text, kind: 'manual' },
          }),
        { meetingId, text },
      );
      expect(r.ok).toBe(true);
    };
    const review = async (family: string) => {
      await expect
        .poll(
          async () =>
            (await snapshot()).components.some(
              (c: any) => c.family === family && c.draftState === 'ready',
            ),
          { timeout: 20000 },
        )
        .toBe(true);
      const c = (await snapshot()).components.find((c: any) => c.family === family);
      expect(c.round).toBeNull();
      await expect.poll(async () => (await app.windows()).some(p => p.url().includes('role=component-dock'))).toBe(true);
      const page = (await app.windows()).find(p => p.url().includes('role=component-dock'))!;
      await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('role=component-dock'))?.isVisible())).toBe(true);
      const thumbnail = page.locator(`[data-thumbnail-id="${c.id}"]`);
      await expect(thumbnail).toBeVisible();
      await expect(thumbnail.locator('.component-mini-content')).not.toBeEmpty();
      const denied = await page.evaluate(() => window.meeting.call('snapshot'));
      expect(denied.ok).toBe(false);
      await thumbnail.hover();
      await expect(page.getByRole('region', { name: '组件审核预览' })).toBeVisible();
      await expect(page.locator('input:visible,textarea:visible,select:visible')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
      await thumbnail.click();
      await expect(page.getByText('审核已固定', {exact:true})).toBeVisible();
      await page.getByRole('button', { name: '审核并分发给3人', exact: true }).click();
      await expect
        .poll(
          async () => (await snapshot()).components.find((x: any) => x.id === c.id).round?.status,
        )
        .toBe('open');
      await expect(thumbnail).toHaveCount(0);
      await page.getByRole('button', {name:'收起审核', exact:true}).click();
      return { id: c.id, page };
    };
    await speak(
      '内部、五位客户、先内部再客户，我们意见还没统一。大家各自选一个方向，今天把范围定下来。',
    );
    await review('poll');
    await speak('原型这块交给A，交付一份可交互原型，具体时间还没有定。');
    const assignment = await review('assignment');
    await host.getByRole('button', { name: '打开 参与者A', exact: true }).click();
    await expect
      .poll(async () => (await app.windows()).some((p) => p.url().includes('role=participant')))
      .toBe(true);
    const participant = (await app.windows()).find((p) => p.url().includes('role=participant'))!;
    const card = participant.locator(`[data-component-id="${assignment.id}"]`);
    await card.getByLabel('补充说明').fill('需要讨论可接受的延期时间');
    await card.getByRole('button', { name: '提出异议', exact: true }).click();
    const conflict = await review('conflict');
    expect(
      (await snapshot()).components.find((c: any) => c.id === conflict.id).round.sharedEvidence
        .length,
    ).toBeGreaterThan(0);
    await speak('那这次就采用内部试点，A、B、C，大家再核对一下有没有遗漏。');
    await review('decision_confirmation');
    expect(enabledSeen).toBe(true);
    expect(generated).toEqual(
      expect.arrayContaining(['poll', 'assignment', 'conflict', 'decision_confirmation']),
    );
    expect((await snapshot()).jobs.filter((j: any) => j.status === 'failed')).toEqual([]);
  } finally {
    await cleanupElectron(app, dir);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
