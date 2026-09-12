import React from 'react';
import type { ComponentContent, CollaborationSnapshot } from '../../contracts/collaboration';

/** The host reviews the same complete content that will be distributed. No form setup here. */
export function ReviewPreview({
  content,
  snapshot,
  zh,
}: {
  content: ComponentContent;
  snapshot: CollaborationSnapshot;
  zh: boolean;
}) {
  const person = (id: string | null) =>
    snapshot.participants.find((p) => p.id === id)?.displayName ?? (zh ? '待确认' : 'Unconfirmed');
  return (
    <section
      className="component-review"
      aria-label={zh ? '组件审核预览' : 'Component review preview'}
    >
      {content.kind === 'poll' && (
        <>
          <h3>
            {content.payload.question || (zh ? '正在准备投票题目' : 'Preparing the question')}
          </h3>
          {content.payload.contextSummary && <p>{content.payload.contextSummary}</p>}
          <ol>
            {content.payload.options.map((o) => (
              <li key={o.id}>
                <strong>{o.label}</strong>
                {o.description && <p>{o.description}</p>}
              </li>
            ))}
          </ol>
          <p className="muted">
            {content.payload.selection.mode === 'single'
              ? zh
                ? '单选'
                : 'Single choice'
              : zh
                ? `最多选${content.payload.selection.max}项`
                : `Choose up to ${content.payload.selection.max}`}{' '}
            ·{' '}
            {content.payload.allowAbstain
              ? zh
                ? '允许弃权'
                : 'Abstention allowed'
              : zh
                ? '不允许弃权'
                : 'No abstention'}{' '}
            · {zh ? '截止后显示结果' : 'Results after closing'} ·{' '}
            {content.payload.closePolicy.kind === 'host'
              ? zh
                ? '由发起者截止'
                : 'Host closes'
              : content.payload.closePolicy.at}
          </p>
        </>
      )}
      {content.kind === 'assignment' && (
        <>
          <h3>{zh ? '分工安排' : 'Assignments'}</h3>
          {content.payload.items.map((item) => (
            <section className="review-item" key={item.id}>
              <strong>{item.title}</strong>
              <p>
                {zh ? '负责人' : 'Owner'}：{person(item.assigneeId)}
                {item.unresolvedAssigneeText && `（${item.unresolvedAssigneeText}）`}
              </p>
              <p>
                {zh ? '交付物' : 'Deliverable'}：{item.deliverable}
              </p>
              <p>
                {zh ? '时间' : 'Schedule'}：
                {item.schedule.rawText || (zh ? '待确认' : 'Unconfirmed')}
              </p>
              {item.discussionPoints.map((point) => (
                <p className="collaboration-warning" key={point.id}>
                  {point.text}
                </p>
              ))}
            </section>
          ))}
          <p className="muted">
            {content.payload.mode === 'request_acceptance'
              ? zh
                ? '分发后由负责人本人接受'
                : 'Each owner accepts after distribution'
              : zh
                ? '仅展示安排，不代表负责人已接受'
                : 'Display only; this does not record acceptance'}
          </p>
        </>
      )}
      {content.kind === 'conflict' && (
        <>
          <h3>{zh ? '待讨论的冲突' : 'Conflict for discussion'}</h3>
          {content.payload.sides.map((side) => (
            <section className="review-item" key={side.id}>
              <strong>{side.title}</strong>
              <p>{side.description}</p>
            </section>
          ))}
          {content.payload.questions.map((q) => (
            <p key={q.id}>{q.text}</p>
          ))}
          {content.payload.resolutions.map((r) => (
            <section className="review-item" key={r.id}>
              <strong>{r.title}</strong>
              <p>{r.tradeoffs}</p>
            </section>
          ))}
          <p className="muted">
            {zh
              ? '方案供讨论，分发不会自动改写任务。'
              : 'Options are proposals; distribution does not change tasks.'}
          </p>
        </>
      )}
      {content.kind === 'decision_confirmation' && (
        <>
          <h3>
            {content.payload.statement || (zh ? '正在准备拟定结论' : 'Preparing the statement')}
          </h3>
          <p>
            {zh ? '确认范围' : 'Scope'}：{content.payload.scopeText}
          </p>
          {content.payload.conditions.map((condition, i) => (
            <p key={i}>{condition.text}</p>
          ))}
          <p className="muted">
            {zh
              ? '指定参与者全部明确同意后，才可记录此范围决定。'
              : 'Record only after every required participant explicitly agrees.'}
          </p>
        </>
      )}
    </section>
  );
}
