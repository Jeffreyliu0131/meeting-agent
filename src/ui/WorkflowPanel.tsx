import React, { useState } from 'react';
import type { Meeting, Ref } from '../contracts/model';

export function WorkflowPanel({
  meeting,
  locale,
  command,
  onSources,
  onRebase,
}: {
  meeting: Meeting;
  locale: 'en' | 'zh-CN';
  command: (type: string, payload: Record<string, unknown>) => Promise<unknown>;
  onSources: (refs: Ref[], target?: string) => void;
  onRebase: (text: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const zh = locale === 'zh-CN';
  const perform = async (type: string, payload: Record<string, unknown>) => {
    try {
      await command(type, payload);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SAVE_FAILED');
    }
  };
  const jobs = meeting.workflowJobs?.filter((j) => j.scope === 'personal') ?? [];
  const questions = meeting.clarifications ?? [];
  const gaps = Object.keys(meeting.quarantinedSources ?? {}).filter((id) =>
    meeting.segments.some((s) => s.id === id && s.kind !== 'request'),
  );
  const partial = meeting.contextCoverage?.hasMore || meeting.contextCoverage?.incompleteEvidence;
  if (!jobs.length && !questions.length && !gaps.length && !partial) return null;
  const statuses: Record<string, string> = zh
    ? {
        pending: '等待处理',
        running: '推演中',
        proposed: '正在保存',
        succeeded: '已保存',
        failed: '未完成',
        rejected: '未通过校验',
        cancelled: '已取消',
        superseded: '依据已失效',
        answered: '已回答（个人）',
        resolved: '已由会议来源消解',
        stale: '候选已变化',
      }
    : {
        pending: 'Pending',
        running: 'Exploring',
        proposed: 'Saving',
        succeeded: 'Saved',
        failed: 'Incomplete',
        rejected: 'Rejected',
        cancelled: 'Cancelled',
        superseded: 'Superseded',
        answered: 'Answered personally',
        resolved: 'Resolved by meeting evidence',
        stale: 'Candidates changed',
      };
  return (
    <section className="workflow-panel" data-testid="workflow-panel">
      {partial && (
        <p role="status">
          {zh
            ? '本轮仅核对部分会议上下文；未读取的条件与来源仍保留。'
            : 'This pass covers part of the meeting context; unread conditions and sources remain preserved.'}
        </p>
      )}
      {!!gaps.length && (
        <p role="status">
          {zh
            ? `${gaps.length} 条输入未能完成理解；后续内容仍在处理。`
            : `${gaps.length} inputs remain unreviewed; later content continues.`}
          <button
            onClick={() =>
              onSources(
                meeting.segments
                  .filter((s) => gaps.includes(s.id))
                  .map((s) => ({ id: s.id, rev: s.rev })),
              )
            }
          >
            {zh ? '查看缺口' : 'View gaps'}
          </button>
        </p>
      )}
      {questions.map((c) => (
        <details
          key={c.id}
          open={c.status === 'pending'}
          className="meeting-review"
          data-testid="clarification"
        >
          <summary>
            {c.question} · {statuses[c.status]}
          </summary>
          <p>
            {c.candidates
              .map((r) => meeting.objects.find((o) => o.id === r.id)?.title ?? r.id)
              .join(' / ')}
          </p>
          <button onClick={() => onSources(c.sources, c.question)}>
            {zh ? '查看来源' : 'View sources'}
          </button>
          {c.status === 'pending' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform('answerClarification', {
                  clarificationId: c.id,
                  answer: answers[c.id],
                });
              }}
            >
              <label>
                {zh ? '你的回答仅用于个人推演' : 'Your answer is personal exploration'}
                <input
                  aria-label={zh ? '澄清回答' : 'Clarification answer'}
                  value={answers[c.id] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [c.id]: e.target.value })}
                />
              </label>
              <button type="submit" disabled={!answers[c.id]?.trim()}>
                {zh ? '回答' : 'Answer'}
              </button>
              <button
                type="button"
                onClick={() => void perform('cancelClarification', { clarificationId: c.id })}
              >
                {zh ? '暂不处理' : 'Dismiss'}
              </button>
            </form>
          )}
        </details>
      ))}
      {!!jobs.length && (
        <details className="meeting-review">
          <summary>
            {zh ? '个人推演' : 'Personal exploration'} · {jobs.length}
          </summary>
          {jobs.map((j) => {
            const source = meeting.segments.find((s) => s.id === j.requestId);
            const changed =
              j.readSet.objects.some((r) =>
                meeting.objects.some((o) => o.id === r.id && o.rev !== r.rev),
              ) ||
              j.readSet.sources.some((r) =>
                meeting.segments.some((s) => s.id === r.id && s.rev > r.rev),
              ) ||
              j.readSet.artifacts.some((r) =>
                meeting.artifacts.some((a) => a.id === r.id && a.rev > r.rev),
              );
            return (
              <div key={j.id} data-testid="personal-job">
                <p>
                  {source?.text} ·{' '}
                  {j.cancelled
                    ? statuses.cancelled
                    : j.expressionState === 'queued' || j.expressionState === 'running'
                      ? zh
                        ? '正在生成表达'
                        : 'Preparing expression'
                      : j.expressionState === 'failed'
                        ? zh
                          ? '表达未完成'
                          : 'Expression incomplete'
                        : statuses[j.status]}
                  {j.error ? ' · ' + j.error : ''}
                </p>
                {changed && (
                  <p className="stale">
                    {zh
                      ? '依据已变化，当前请求保留原版本。'
                      : 'Baseline changed; this request keeps its original versions.'}
                    <button onClick={() => onRebase(source?.text ?? '')}>
                      {zh ? '基于最新内容重新提问' : 'Ask again using latest content'}
                    </button>
                  </p>
                )}
                {!j.cancelled &&
                  (['pending', 'running', 'proposed'].includes(j.status) ||
                    j.expressionState === 'queued' ||
                    j.expressionState === 'running') && (
                    <button
                      onClick={() => void perform('cancelRequest', { requestId: j.requestId })}
                    >
                      {zh ? '取消推演' : 'Cancel exploration'}
                    </button>
                  )}
              </div>
            );
          })}
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
