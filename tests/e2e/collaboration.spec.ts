import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanupElectron } from './cleanup';

test('host publishes a poll to independent participants; participant cannot read the host snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-desktop-collaboration-'));
  const app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: '1',
      MEETING_SYSTEM_LOCALE: 'zh-CN',
      MEETING_DATA_DIR: dir,
      OPENAI_API_KEY: '',
      MEETING_STT_API_KEY: '',
    },
  });
  try {
    await expect
      .poll(async () => (await app.windows()).some((p) => p.url().includes('role=workspace')))
      .toBe(true);
    const host = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
    await host.waitForFunction(() => !!window.meeting);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('role=workspace'))
        ?.show(),
    );
    await host.evaluate(async () =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        type: 'create',
        meetingId: null,
        payload: {
          title: 'Synthetic collaboration',
          mode: 'manual',
          outputLocale: 'zh-CN',
          timezone: 'UTC',
        },
      }),
    );
    await host.getByText('Synthetic collaboration', { exact: true }).first().click();
    await host.getByRole('button', { name: '开启本地协作模拟' }).click();
    await host.getByRole('button', { name: '准备投票', exact: true }).click();
    await expect
      .poll(async () => (await app.windows()).some((p) => p.url().includes('role=component')))
      .toBe(true);
    const component = (await app.windows()).find((p) => p.url().includes('role=component'))!;
    await component.getByLabel('投票题目').fill('先做哪个方案？');
    await component.getByLabel('选项 1', { exact: true }).fill('内部试点');
    await component.getByLabel('选项 2', { exact: true }).fill('客户试点');
    await component.getByRole('button', { name: '保存草稿', exact: true }).click();
    const launcher = (await app.windows()).find((p) => p.url().includes('role=launcher'))!;
    await expect(launcher.locator('.launcher-component-badge')).toHaveText('1');
    await component.getByRole('button', { name: '发放给3人', exact: true }).click();
    await expect(launcher.locator('.launcher-component-badge')).toHaveCount(0);
    await host.getByRole('button', { name: '打开 参与者A' }).click();
    await expect
      .poll(
        async () =>
          (await app.windows()).filter((p) => p.url().includes('role=participant')).length,
      )
      .toBe(1);
    const participant = (await app.windows()).find((p) => p.url().includes('role=participant'))!;
    await expect(participant.getByText('先做哪个方案？', { exact: true })).toBeVisible();
    const denied = await participant.evaluate(() => window.meeting.call('snapshot'));
    expect(denied.ok).toBe(false);
    await participant.getByLabel('内部试点', { exact: true }).check();
    await participant.getByRole('button', { name: '提交投票' }).click();
    await expect(participant.getByText('已提交', { exact: true })).toBeVisible();
    await component.getByRole('button', { name: '截止', exact: true }).click();
    await expect(participant.getByText('内部试点：1票', { exact: true })).toBeVisible();
  } finally {
    await cleanupElectron(app, dir);
  }
});

test('assignment objections produce a floating conflict, resolution drafts and explicit three-person confirmation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-desktop-collaboration-'));
  const app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: '1',
      MEETING_SYSTEM_LOCALE: 'zh-CN',
      MEETING_DATA_DIR: dir,
      OPENAI_API_KEY: '',
      MEETING_STT_API_KEY: '',
    },
  });
  try {
    await expect
      .poll(async () => (await app.windows()).some((p) => p.url().includes('role=workspace')))
      .toBe(true);
    const host = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
    await host.waitForFunction(() => !!window.meeting);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('role=workspace'))
        ?.show(),
    );
    const created = await host.evaluate(() =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        type: 'create',
        meetingId: null,
        payload: {
          title: 'Synthetic four families',
          mode: 'manual',
          outputLocale: 'zh-CN',
          timezone: 'UTC',
        },
      }),
    );
    const meetingId = created.value as string;
    await host.getByText('Synthetic four families', { exact: true }).first().click();
    await host.getByRole('button', { name: '开启本地协作模拟' }).click();
    await host.getByRole('button', { name: '准备分工', exact: true }).click();
    await expect
      .poll(
        async () => (await app.windows()).filter((p) => p.url().includes('role=component')).length,
      )
      .toBe(1);
    const assignment = (await app.windows()).find((p) => p.url().includes('role=component'))!;
    await assignment.getByLabel('任务名称').fill('完成原型');
    await assignment.getByLabel('交付物', { exact: true }).fill('可交互原型');
    await assignment.getByLabel('负责人', { exact: true }).selectOption({ label: '参与者A' });
    await assignment.getByLabel('发放方式').selectOption('request_acceptance');
    await expect(assignment.getByRole('button', { name: '发放给3人' })).toBeDisabled();
    await assignment.getByRole('button', { name: '保存草稿', exact: true }).click();
    await assignment.getByRole('button', { name: '发放给3人' }).click();
    await host.getByRole('button', { name: '打开 参与者A' }).click();
    await expect
      .poll(
        async () =>
          (await app.windows()).filter((p) => p.url().includes('role=participant')).length,
      )
      .toBe(1);
    const a = (await app.windows()).find((p) => p.url().includes('role=participant'))!;
    await a.getByLabel('补充说明').fill('目前还有另一个必须完成的任务');
    await a.getByRole('button', { name: '提出异议', exact: true }).click();
    await expect(host.locator('.collaboration-index')).toHaveCount(2);
    await host
      .locator('.collaboration-index')
      .filter({ hasText: '冲突' })
      .getByRole('button')
      .click();
    await expect
      .poll(
        async () => (await app.windows()).filter((p) => p.url().includes('role=component')).length,
      )
      .toBe(2);
    const conflict = (await app.windows())
      .filter((p) => p.url().includes('role=component'))
      .find((p) => p !== assignment)!;
    await conflict.getByRole('button', { name: '添加讨论方案' }).click();
    await conflict.getByLabel('方案名称').fill('调整交付时间');
    await conflict.getByLabel('影响与取舍').fill('保留原负责人，另行确定交付时间');
    await conflict.getByLabel('修订任务').selectOption({ label: '完成原型' });
    await conflict.getByLabel('建议的新时间说明').fill('改为周五交付，具体时间待确认');
    await conflict.getByRole('button', { name: '保存草稿', exact: true }).click();
    await conflict.getByText('公开依据摘录', { exact: true }).click();
    await conflict.locator('.evidence-choice input').check();
    await conflict.getByRole('button', { name: '发放给3人' }).click();
    await expect(a.getByText('调整交付时间', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: '支持此方案' }).click();
    await conflict.getByRole('button', { name: '生成此方案的修订草稿' }).click();
    await expect
      .poll(
        async () =>
          (
            await host.evaluate(
              (meetingId) => window.meeting.call('collaborationSnapshot', { meetingId }),
              meetingId,
            )
          ).value.components.find((c: any) => c.family === 'assignment').draft.content.payload
            .items[0].schedule.rawText,
      )
      .toContain('周五');
    await expect(a.getByText('时间未约定', { exact: false })).toBeVisible();
    await a.getByRole('button', { name: '标记我的问题已解决' }).click();
    await expect(a.getByText('报告者已标记解决', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: '准备决定确认', exact: true }).click();
    await expect
      .poll(
        async () => (await app.windows()).filter((p) => p.url().includes('role=component')).length,
      )
      .toBe(3);
    const confirmation = (await app.windows())
      .filter((p) => p.url().includes('role=component'))
      .find((p) => p !== assignment && p !== conflict)!;
    await confirmation.getByLabel('拟定结论').fill('采用内部试点');
    await confirmation.getByLabel('确认范围').fill('本次试点的三名参与者');
    await confirmation.getByRole('button', { name: '保存草稿', exact: true }).click();
    await confirmation.getByRole('button', { name: '发放给3人' }).click();
    for (const name of ['参与者B', '参与者C'])
      await host.getByRole('button', { name: `打开 ${name}` }).click();
    await expect
      .poll(
        async () =>
          (await app.windows()).filter((p) => p.url().includes('role=participant')).length,
      )
      .toBe(3);
    for (const person of (await app.windows()).filter((p) => p.url().includes('role=participant')))
      await person.getByRole('button', { name: '同意', exact: true }).click();
    await confirmation.getByRole('button', { name: '记录此范围决定' }).click();
    await expect(confirmation.getByText('已记录指定范围决定', { exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL().includes('role=component'))
        .forEach((w) => w.webContents.setZoomFactor(2)),
    );
    await expect(confirmation.getByText('已记录指定范围决定', { exact: true })).toBeVisible();
  } finally {
    await cleanupElectron(app, dir);
  }
});
