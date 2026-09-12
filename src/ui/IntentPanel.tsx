import React, { useEffect, useRef, useState } from 'react';
import type { Meeting, Ref } from '../contracts/model';
import type { IntentDraft } from '../contracts/collaboration';

type Command = (type: string, payload: Record<string, unknown>) => Promise<unknown>;
function Field({
  label,
  value,
  path,
  draft,
  command,
  zh,
  array = false,
  nullable = false,
  disabled,
}: {
  label: string;
  value: string;
  path: string;
  draft: IntentDraft;
  command: Command;
  zh: boolean;
  array?: boolean;
  nullable?: boolean;
  disabled: boolean;
}) {
  const [text, setText] = useState(value),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const base = useRef(draft.rev);
  useEffect(() => {
    if (!dirty) {
      setText(value);
      base.current = draft.rev;
    }
  }, [value, draft.rev, dirty]);
  return (
    <form
      className="intent-field"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await command('collaborationEdit', {
            draftId: draft.id,
            expectedRevision: base.current,
            path,
            value: array
              ? text.split('\n').filter((x) => x.trim())
              : nullable && !text.trim()
                ? null
                : text,
          });
          setDirty(false);
          setError('');
        } catch {
          setError(
            zh
              ? '保存失败或版本已变化。保留了输入，请核对后重试。'
              : 'Save failed or version changed. Your input is preserved.',
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        {label}
        <textarea
          aria-label={label}
          value={text}
          rows={array ? 3 : 2}
          disabled={disabled || saving}
          placeholder={zh ? '待明确' : 'Unknown'}
          onChange={(e) => {
            if (!dirty) base.current = draft.rev;
            setDirty(true);
            setText(e.target.value);
          }}
        />
      </label>
      {draft.manualLocks.includes(path) && (
        <small>
          {zh
            ? '已手工编辑 · 自动更新保留此字段'
            : 'Manual edit · protected from automatic updates'}
        </small>
      )}
      {dirty && (
        <div>
          <button disabled={saving || disabled}>{zh ? '保存字段' : 'Save field'}</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDirty(false);
              setError('');
            }}
          >
            {zh ? '重新载入' : 'Reload'}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function IntentPanel({
  meeting,
  locale,
  command,
  onSources,
}: {
  meeting: Meeting;
  locale: 'en' | 'zh-CN';
  command: Command;
  onSources: (refs: Ref[]) => void;
}) {
  const zh = locale === 'zh-CN',
    state = meeting.collaboration,
    ended = meeting.status === 'ended';
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const names = zh
    ? { poll: '投票', assignment: '分工', conflict: '冲突处理', decision_confirmation: '决定确认' }
    : {
        poll: 'Poll',
        assignment: 'Assignment',
        conflict: 'Conflict',
        decision_confirmation: 'Decision confirmation',
      };
  const statuses = zh
    ? {
        suggestion: '待检查建议',
        collecting: '正在收集',
        draft: '私有草稿',
        needs_clarification: '需要明确目标',
        dismissed: '已忽略',
      }
    : {
        suggestion: 'Suggestion',
        collecting: 'Collecting',
        draft: 'Private draft',
        needs_clarification: 'Choose a target',
        dismissed: 'Dismissed',
      };
  const perform = async (type: string, payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      await command(type, payload);
      setError('');
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(
        code.includes('ANALYSIS_INCOMPLETE')
          ? zh
            ? '已有讨论尚未完成分析，请等待或先处理输入缺口。'
            : 'Received discussion is still awaiting analysis. Resolve input gaps before freezing.'
          : zh
            ? '操作未保存，请核对当前版本后重试。'
            : 'Not saved. Check the current version and retry.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="intent-panel" data-testid="intent-panel">
      <div className="intent-heading">
        <h2>{zh ? '协作意图' : 'Collaboration intents'}</h2>
        {!ended && (
          <button
            disabled={busy}
            onClick={() => void perform('collaborationEnable', { enabled: !state?.enabled })}
          >
            {state?.enabled
              ? zh
                ? '关闭自动准备'
                : 'Disable preparation'
              : zh
                ? '开启自动准备'
                : 'Enable preparation'}
          </button>
        )}
      </div>
      {state?.enabled && (
        <>
          <p>
            {zh
              ? '实验性自动草稿，仅发起者可见。识别投票、分工、冲突和决定确认；本轮尚未接入参与者发放与回应。'
              : 'Experimental private drafts for polls, assignments, conflicts and confirmations. Participant publishing and responses are not connected in this stage.'}
          </p>
          {!state.drafts.some((d) => d.status !== 'dismissed') && (
            <p>
              {zh
                ? '开启后的新讨论将用于准备草稿。需要已配置的理解模型。'
                : 'New discussion after enabling can prepare drafts. A configured understanding model is required.'}
            </p>
          )}
          {state.coverage === 'partial' && (
            <p role="status">
              {zh
                ? '有意图尚未处理，当前草稿不代表全部讨论。'
                : 'Some intents remain unprocessed; drafts do not cover all discussion.'}
            </p>
          )}
          {state.drafts
            .filter((d) => d.status !== 'dismissed')
            .map((d) => {
              const c = d.content;
              const base = { draftId: d.id, expectedRevision: d.rev };
              const field = (
                label: string,
                path: string,
                value: string | null,
                array = false,
                nullable = false,
              ) => (
                <Field
                  key={path}
                  {...{ label, path, draft: d, command, zh, array, nullable }}
                  value={value ?? ''}
                  disabled={ended}
                />
              );
              const remove = (path: string) => (
                <button
                  disabled={ended || busy}
                  onClick={() => void perform('collaborationEdit', { ...base, path, value: null })}
                >
                  {zh ? '移除此项' : 'Remove item'}
                </button>
              );
              return (
                <article
                  className="intent-card"
                  key={d.id}
                  data-testid={`intent-${d.candidate.family}`}
                >
                  <h3>
                    {names[d.candidate.family]}{' '}
                    <small>
                      {statuses[d.status]} · v{d.rev}
                    </small>
                  </h3>
                  <p>{d.candidate.scopeText}</p>
                  {d.needsReview && (
                    <p role="status">
                      {zh
                        ? '依据已变化或收集达到上限，需要核对。'
                        : 'Evidence changed or collection capacity reached. Review required.'}
                    </p>
                  )}
                  {d.candidate.operation !== 'prepare' && d.candidate.operation !== 'update' && (
                    <p>
                      {zh
                        ? '识别到操作意图，尚未执行。'
                        : 'An operation was requested; it has not been executed.'}
                    </p>
                  )}
                  {c?.kind === 'poll' && (
                    <>
                      {field(zh ? '投票题目' : 'Poll question', 'question', c.question)}
                      <p>
                        {c.selection === 'single'
                          ? zh
                            ? '单选'
                            : 'Single choice'
                          : zh
                            ? '多选'
                            : 'Multiple choice'}{' '}
                        · {zh ? '尚未发放，无投票结果' : 'Not published; no votes'}
                      </p>
                      {c.options.map((o, index) => (
                        <div className="intent-row" key={o.key}>
                          {field(
                            `${zh ? '选项' : 'Option'} ${index + 1}`,
                            `options.${o.key}.label`,
                            o.label,
                          )}
                          {remove(`options.${o.key}`)}
                        </div>
                      ))}
                    </>
                  )}
                  {c?.kind === 'assignment' && (
                    <>
                      {c.items.map((o, index) => (
                        <fieldset key={o.key}>
                          <legend>
                            {zh ? '任务' : 'Task'} {index + 1} ·{' '}
                            {zh ? '未请求接受' : 'Acceptance not requested'}
                          </legend>
                          {field(
                            zh ? '任务内容' : 'Task description',
                            `items.${o.key}.task`,
                            o.task,
                          )}
                          {field(
                            zh ? '交付物' : 'Deliverable',
                            `items.${o.key}.deliverable`,
                            o.deliverable,
                          )}
                          {field(
                            zh ? '负责人原话（未绑定身份）' : 'Spoken owner (identity unbound)',
                            `items.${o.key}.owner`,
                            o.owner,
                            false,
                            true,
                          )}
                          {field(
                            zh ? '时间原话' : 'Spoken schedule',
                            `items.${o.key}.time`,
                            o.time,
                            false,
                            true,
                          )}
                          {!!o.dependencies.length && (
                            <p>
                              {zh ? '依赖' : 'Dependencies'}:{' '}
                              {o.dependencies
                                .map(
                                  (r) => meeting.objects.find((x) => x.id === r.id)?.title ?? r.id,
                                )
                                .join('、')}
                            </p>
                          )}
                          {remove(`items.${o.key}`)}
                        </fieldset>
                      ))}
                    </>
                  )}
                  {c?.kind === 'conflict' && (
                    <>
                      <p>
                        {zh
                          ? 'Agent 提出的待核对问题，尚未证实或解决。'
                          : 'Agent-proposed issue; not verified or resolved.'}
                      </p>
                      {field(zh ? '冲突摘要' : 'Conflict summary', 'summary', c.summary)}
                      {c.sides.map((s, index) => (
                        <div key={s.key}>
                          {field(
                            `${zh ? '关联安排' : 'Related arrangement'} ${index + 1}`,
                            `sides.${s.key}.description`,
                            s.description,
                          )}
                        </div>
                      ))}
                      {field(
                        zh ? '待确认问题（每行一项）' : 'Questions (one per line)',
                        'questions',
                        c.questions.join('\n'),
                        true,
                      )}
                      {field(
                        zh
                          ? '处理建议（未执行，每行一项）'
                          : 'Suggestions (not applied, one per line)',
                        'resolutions',
                        c.resolutions.join('\n'),
                        true,
                      )}
                    </>
                  )}
                  {c?.kind === 'decision_confirmation' && (
                    <>
                      {field(zh ? '拟定结论' : 'Proposed conclusion', 'statement', c.statement)}
                      {field(
                        zh ? '适用范围（未绑定确认名册）' : 'Scope (confirmation roster unbound)',
                        'scopeText',
                        c.scopeText,
                      )}
                      {field(
                        zh ? '有效条件（每行一项）' : 'Conditions (one per line)',
                        'conditions',
                        c.conditions.join('\n'),
                        true,
                      )}
                      <p>
                        {zh
                          ? '尚未向参与者请求确认，不代表已达成决定。'
                          : 'Confirmation has not been requested; this is not a recorded decision.'}
                      </p>
                    </>
                  )}
                  {!!d.missingFields.length && (
                    <p>
                      {zh
                        ? '仍有待明确内容，请检查空字段和引用依据。'
                        : 'Some details remain unknown. Review empty fields and evidence.'}
                    </p>
                  )}
                  {d.suggestedContent && (
                    <details>
                      <summary>
                        {zh
                          ? '自动建议与手工内容有差异（未覆盖）'
                          : 'Automatic suggestion differs from your protected edits'}
                      </summary>
                      <p>
                        {d.suggestedContent.kind === 'poll'
                          ? [
                              d.suggestedContent.question,
                              ...d.suggestedContent.options.map((o) => o.label),
                            ].join(' · ')
                          : d.suggestedContent.kind === 'assignment'
                            ? d.suggestedContent.items
                                .map((o) =>
                                  [o.task, o.deliverable, o.owner, o.time]
                                    .filter(Boolean)
                                    .join(' · '),
                                )
                                .join('；')
                            : d.suggestedContent.kind === 'conflict'
                              ? [
                                  d.suggestedContent.summary,
                                  ...d.suggestedContent.resolutions,
                                ].join(' · ')
                              : [
                                  d.suggestedContent.statement,
                                  ...d.suggestedContent.conditions,
                                ].join(' · ')}
                      </p>
                    </details>
                  )}
                  {d.status === 'needs_clarification' && (
                    <div>
                      <p>
                        {zh
                          ? '请选择对应草稿；选择只明确目标。'
                          : 'Choose the intended draft; this only resolves the target.'}
                      </p>
                      {state.drafts
                        .filter(
                          (t) =>
                            t.id !== d.id &&
                            t.candidate.family === d.candidate.family &&
                            !['dismissed', 'needs_clarification'].includes(t.status),
                        )
                        .map((t) => (
                          <button
                            key={t.id}
                            disabled={ended || busy}
                            onClick={() =>
                              void perform('collaborationResolve', {
                                ...base,
                                target: { id: t.id, rev: t.rev },
                              })
                            }
                          >
                            {t.candidate.scopeText || names[t.candidate.family]} · v{t.rev}
                          </button>
                        ))}
                    </div>
                  )}
                  <div className="intent-actions">
                    <button onClick={() => onSources(d.sources)}>
                      {zh ? '查看来源' : 'View evidence'}
                    </button>
                    {d.status === 'collecting' && (
                      <button
                        disabled={ended || busy}
                        onClick={() => void perform('collaborationFreeze', base)}
                      >
                        {zh ? '停止收集并预览' : 'Stop collecting and preview'}
                      </button>
                    )}
                    <button
                      disabled={ended || busy}
                      onClick={() => void perform('collaborationDismiss', base)}
                    >
                      {zh ? '忽略此建议' : 'Dismiss suggestion'}
                    </button>
                  </div>
                </article>
              );
            })}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
