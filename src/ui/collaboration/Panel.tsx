import React, { useEffect, useState, useRef } from 'react';
import { api } from '../bridge';
import {
  emptyContent,
  type Family,
  type ComponentContent,
  type CollaborationSnapshot,
  type ComponentView,
  type ComponentResponse,
} from '../../contracts/collaboration';
import { contentEvidence } from '../../domain/collaboration';
import './styles.css';

const familyNames = {
  poll: ['投票', 'Poll'],
  assignment: ['分工', 'Assignments'],
  conflict: ['冲突', 'Conflict'],
  decision_confirmation: ['决定确认', 'Confirmation'],
};
const errors: Record<string, string> = {
  MISSING_REQUIRED_FIELDS: '请补齐题目、选项或任务内容。',
  INVALID_AUDIENCE: '请选择有效参与者。',
  ASSIGNEE_REQUIRED: '请为每项任务指定参与范围内的负责人。',
  ANALYSIS_INCOMPLETE: '正在核对已收到的讨论或异议，请稍后再试。',
  INPUT_GAP_UNRESOLVED: '会议存在未补全的转写缺口，暂不能记录决定，请保留为待确认。',
  REVISION_CONFLICT: '内容已有新版本，请核对后再保存。',
  ROUND_REPLACED: '此轮已被新版替代，请重新核对并提交。',
  ROUND_CLOSED: '本轮已截止。',
  CONFIRMATION_INCOMPLETE: '尚未收齐指定人员的明确同意。',
  DEPENDENCY_STALE: '依据已变化，等待核对。',
  COLLECTION_NOT_FROZEN: '请先停止收集并预览。',
  DUPLICATE_OPTIONS: '投票选项不能重复。',
  INVALID_SELECTION: '请按选择规则选择有效选项。',
  SOURCE_NOT_SHAREABLE: '需要先在来源预览中选择可共享的依据。',
  UNRESOLVED_CONFLICT: '仍有未解决冲突。',
  RESPONSE_VERSION_CONFLICT: '你的回应已有新版本，请重新加载后核对。',
};
type Send = (type: string, payload: Record<string, unknown>) => Promise<any>;
const nameOf = (s: CollaborationSnapshot, id: string) =>
  s.participants.find((p) => p.id === id)?.displayName ?? '待指定';
function starter(kind: Family): ComponentContent {
  const content = emptyContent(kind);
  if (content.kind === 'poll')
    content.payload.options = [1, 2].map(() => ({
      id: crypto.randomUUID(),
      label: '',
      description: '',
      objectRefs: [],
    }));
  if (content.kind === 'assignment') content.payload.items = [newTask()];
  return content;
}
function newTask() {
  return {
    id: crypto.randomUUID(),
    itemRevision: 1,
    taskRef: null,
    title: '',
    deliverable: '',
    assigneeId: null as string | null,
    unresolvedAssigneeText: null,
    collaboratorIds: [] as string[],
    schedule: {
      rawText: '',
      timezone: null,
      start: null,
      end: null,
      dueDate: null,
      dueAt: null,
      precision: 'unknown' as const,
      exclusive: null,
    },
    dependencyRefs: [],
    discussionPoints: [],
    conflictIds: [],
  };
}

function DecisionNotice({
  decision: d,
  snapshot: s,
  send,
}: {
  decision: CollaborationSnapshot['decisions'][number];
  snapshot: CollaborationSnapshot;
  send: Send;
}) {
  const [text, setText] = useState(''),
    [error, setError] = useState('');
  return (
    <div className="collaboration-result">
      <strong>{d.reviewRequired ? '已记录决定 · 有新问题待复核' : '已记录指定范围决定'}</strong>
      <p>{d.statement}</p>
      <small>{d.participantIds.map((id) => nameOf(s, id)).join('、')}</small>
      {d.participantIds.includes(s.actor.id) && (
        <>
          <label>
            报告新的决定问题
            <textarea value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button
            disabled={!text.trim()}
            onClick={() =>
              void send('component.report_new_issue', {
                componentId: d.componentId,
                decisionId: d.id,
                text,
              })
                .then(() => setText(''))
                .catch((e) => setError(String(e.message)))
            }
          >
            提交新问题
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function CollaborationPanel({
  meetingId,
  enabled = false,
  locale = 'zh-CN',
  floating = false,
}: {
  meetingId?: string;
  enabled?: boolean;
  locale?: string;
  floating?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const participant = !meetingId;
  const zh = locale === 'zh-CN' || participant;
  const load = async () => {
    if (!participant && !enabled) return;
    try {
      const s = await api('collaborationSnapshot', { meetingId });
      setSnapshot(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SERVICE_ERROR');
    }
  };
  useEffect(() => {
    setSnapshot(null);
    void load();
    return window.meeting.subscribe((value: any) => {
      if (participant && value?.actor) setSnapshot(value);
      else if (!participant) void load();
    });
  }, [meetingId, enabled]);
  useEffect(() => {
    if (!participant || !snapshot || snapshot.actor.role === 'host') return;
    void api('collaborationCommand', {
      id: crypto.randomUUID(),
      meetingId: snapshot.meetingId,
      type: 'component.delivery_ack',
      payload: { sequence: snapshot.sequence, viewed: false },
    }).catch(() => {});
  }, [participant, snapshot?.sequence]);
  const attempts = useRef(new Map<string, string>());
  const send: Send = async (type, payload) => {
    const attemptKey = JSON.stringify({
      meetingId: snapshot?.meetingId ?? meetingId,
      type,
      payload,
    });
    const commandId = attempts.current.get(attemptKey) ?? crypto.randomUUID();
    attempts.current.set(attemptKey, commandId);
    const result = await api('collaborationCommand', {
      id: commandId,
      meetingId: snapshot?.meetingId ?? meetingId,
      type,
      payload,
    });
    attempts.current.delete(attemptKey);
    await load();
    return result;
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SERVICE_ERROR');
    } finally {
      setBusy(false);
    }
  };
  if (!snapshot)
    return (
      <section className="collaboration-panel">
        {participant ? (
          <p>正在连接本地协作…</p>
        ) : (
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api('enableCollaboration', {
                  meetingId,
                  names: ['参与者A', '参与者B', '参与者C'],
                });
                setSnapshot(await api('collaborationSnapshot', { meetingId }));
              })
            }
          >
            {zh ? '开启本地协作模拟' : 'Enable local collaboration simulation'}
          </button>
        )}
        {error && <p role="alert">{errors[error] ?? error}</p>}
      </section>
    );
  const host = snapshot.actor.role === 'host';
  return (
    <section
      className={`collaboration-panel ${participant ? 'participant-page' : ''}`}
      aria-label={zh ? '会议协作' : 'Meeting collaboration'}
    >
      <header>
        <div>
          <h2>
            {host
              ? zh
                ? '会议协作'
                : 'Meeting collaboration'
              : `本地模拟 · ${snapshot.actor.displayName}`}
          </h2>
          <small>
            {zh
              ? '本地模拟 · 独立参与者身份'
              : 'Local simulation · independent participant identities'}
          </small>
        </div>
      </header>
      {host && !floating && (
        <div className="collaboration-toolbar">
          {!snapshot.ended &&
            (Object.keys(familyNames) as Family[]).map((kind) => (
              <button
                key={kind}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const componentId = await send('component.prepare', { content: starter(kind) });
                    await api('openComponent', { meetingId, componentId });
                  })
                }
              >
                {zh ? '准备' : 'Prepare '}
                {familyNames[kind][zh ? 0 : 1]}
              </button>
            ))}
          {!snapshot.ended && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const componentId = await send('component.prepare', {
                    content: starter('poll'),
                    collecting: true,
                    scopeText: '接下来的投票内容',
                  });
                  await api('openComponent', { meetingId, componentId });
                })
              }
            >
              收集接下来的投票
            </button>
          )}
          {snapshot.participants
            .filter((p) => p.role !== 'host')
            .map((p) => (
              <button
                key={p.id}
                onClick={() =>
                  void act(() => api('openParticipant', { meetingId, participantId: p.id }))
                }
              >
                {zh ? '打开 ' : 'Open '}
                {p.displayName}
              </button>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="collaboration-error">
          {zh ? (errors[error] ?? error) : error}
        </p>
      )}
      {!snapshot.components.length && (
        <p className="muted">
          {host ? '准备组件后，可以预览并发给参与者。' : '发起者发放的组件会显示在这里。'}
        </p>
      )}
      {host &&
        snapshot.notices?.map((notice) => (
          <p role="status" className="collaboration-warning" key={notice.id}>
            {String((notice.payload as any)?.question ?? '请预览组件并选择下一步操作')}
          </p>
        ))}
      {host &&
        snapshot.jobs
          ?.filter((j) => (j.input as any)?.resolution === 'needs_clarification')
          .map((j) => (
            <label key={j.id}>
              选择要继续准备的组件
              <select
                defaultValue=""
                onChange={(e) => {
                  const c = snapshot.components.find((c) => c.id === e.target.value);
                  if (c)
                    void act(() =>
                      send('component.resolve_target', {
                        componentId: c.id,
                        draftRevision: c.draftRevision,
                        jobId: j.id,
                      }),
                    );
                }}
              >
                <option value="">请选择</option>
                {snapshot.components
                  .filter((c) => c.family === (j.input as any).family)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {familyNames[c.family][0]} · v{c.draftRevision} · {c.id.slice(0, 6)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
      {snapshot.components.map((component) =>
        !floating && host ? (
          <div className="collaboration-index" key={component.id}>
            <strong>{familyNames[component.family][zh ? 0 : 1]}</strong>
            <span>
              {component.draftState === 'ready' &&
              component.draftRevision !== component.round?.revision
                ? '已准备好'
                : component.round
                  ? '已发放'
                  : '准备中'}
            </span>
            <button
              onClick={() =>
                void act(() => api('openComponent', { meetingId, componentId: component.id }))
              }
            >
              打开组件悬浮窗
            </button>
          </div>
        ) : (
          <ComponentCard
            key={component.id}
            component={component}
            snapshot={snapshot}
            send={send}
            zh={zh}
          />
        ),
      )}
      {snapshot.decisions.map((d) => (
        <DecisionNotice key={d.id} decision={d} snapshot={snapshot} send={send} />
      ))}
      {host && !!snapshot.jobs?.some((j) => j.status === 'failed') && (
        <p role="status">部分组件分析未完成，可继续查看已发放内容。</p>
      )}
    </section>
  );
}

function ComponentCard({
  component: c,
  snapshot: s,
  send,
  zh,
}: {
  component: ComponentView;
  snapshot: CollaborationSnapshot;
  send: Send;
  zh: boolean;
}) {
  const host = s.actor.role === 'host';
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(!c.round);
  const [dirty, setDirty] = useState(false);
  const [audience, setAudience] = useState(
    s.participants.filter((p) => p.role !== 'host').map((p) => p.id),
  );
  const [disclosure, setDisclosure] = useState<{ sourceRef: any; excerpt: string }[]>([]);
  const act = async (type: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    setError('');
    try {
      const v = await send(type, { componentId: c.id, ...payload });
      return v;
    } catch (e) {
      const code = e instanceof Error ? e.message : 'SERVICE_ERROR';
      setError(
        zh
          ? (errors[code] ?? code)
          : code === 'INPUT_GAP_UNRESOLVED'
            ? 'The meeting has an unresolved transcription gap. Keep this decision pending confirmation.'
            : code,
      );
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const safe = (p: Promise<unknown>) => void p.catch(() => {});
  const round = c.round;
  const evidence = c.draft
    ? [
        ...new Map(
          [...c.draft.sourceRefs, ...contentEvidence(c.draft.content)]
            .filter((r) => r.kind === 'segment' || r.kind === 'response')
            .map((r) => [JSON.stringify(r), r]),
        ).values(),
      ]
    : [];
  const status = round
    ? { open: '开放中', closed: '已截止', cancelled: '已撤回', superseded: '已替代' }[round.status]
    : c.draftState === 'collecting'
      ? '正在收集'
      : '草稿';
  return (
    <article className="collaboration-card" data-component-id={c.id}>
      <header>
        <strong>{familyNames[c.family][zh ? 0 : 1]}</strong>
        <span className="badge">{status}</span>
        {round && (
          <small>
            v{round.revision} · {c.responded}/{round.audienceIds.length}人已回应
          </small>
        )}
      </header>
      {c.needsReview && <p className="collaboration-warning">依据已变化，等待核对</p>}
      {host && c.draft && !s.ended && (
        <>
          {round && (
            <button onClick={() => setEdit(!edit)}>{edit ? '收起草稿' : '准备修订'}</button>
          )}
          {edit && (
            <DraftEditor
              key={c.id}
              component={c}
              snapshot={s}
              onDirty={setDirty}
              onSave={(content, baseDraftRevision) =>
                act('component.edit_draft', { baseDraftRevision, content })
              }
              busy={busy}
            />
          )}
          {(!round || edit) && (
            <div className="collaboration-publish">
              <fieldset>
                <legend>发放范围</legend>
                {s.participants.map((p) => (
                  <label className="inline" key={p.id}>
                    <input
                      type="checkbox"
                      checked={audience.includes(p.id)}
                      onChange={(e) =>
                        setAudience(
                          e.target.checked
                            ? [...audience, p.id]
                            : audience.filter((a) => a !== p.id),
                        )
                      }
                    />
                    {p.displayName}
                  </label>
                ))}
              </fieldset>
              {!!evidence.length && (
                <details>
                  <summary>公开依据摘录</summary>
                  <p>选择允许向本轮全部参与者公开的原文。</p>
                  {evidence.map((r, i) => {
                    const found = s.evidenceCatalog?.find(
                      (e) => JSON.stringify(e.sourceRef) === JSON.stringify(r),
                    );
                    return (
                      <label key={JSON.stringify(r)} className="evidence-choice">
                        <input
                          type="checkbox"
                          disabled={!found}
                          checked={disclosure.some(
                            (e) => JSON.stringify(e.sourceRef) === JSON.stringify(r),
                          )}
                          onChange={(e) =>
                            setDisclosure((old) => [
                              ...old.filter(
                                (x) => JSON.stringify(x.sourceRef) !== JSON.stringify(r),
                              ),
                              ...(e.target.checked && found ? [found] : []),
                            ])
                          }
                        />
                        依据 {i + 1}
                        <blockquote>{found?.excerpt ?? '此版本依据不可用'}</blockquote>
                      </label>
                    );
                  })}
                </details>
              )}
              {c.draftState === 'collecting' ? (
                <button
                  disabled={busy || dirty}
                  onClick={() => safe(act('component.freeze_collection'))}
                >
                  停止收集并预览
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    dirty ||
                    c.draftState === 'cancelled' ||
                    c.draftRevision === round?.revision
                  }
                  onClick={() =>
                    safe(
                      act('component.publish', {
                        draftRevision: c.draftRevision,
                        expectedAggregateVersion: c.aggregateVersion,
                        audienceIds: audience,
                        sourceDisclosure: disclosure,
                      }).then(() => setEdit(false)),
                    )
                  }
                >
                  发放给{audience.length}人
                </button>
              )}
              {!round && (
                <button disabled={busy} onClick={() => safe(act('component.cancel'))}>
                  取消草稿
                </button>
              )}
            </div>
          )}
        </>
      )}
      {host &&
        !s.ended &&
        c.draft?.content.kind === 'conflict' &&
        c.draft.content.payload.resolutions.map((r) => (
          <section className="collaboration-result" key={r.id}>
            <strong>{r.title}</strong>
            <p>{r.tradeoffs}</p>
            <p>将生成待预览的修订草稿，参与者仍需接受新版安排。</p>
            <button
              disabled={busy || dirty}
              onClick={() =>
                safe(
                  act('component.apply_resolution', {
                    draftRevision: c.draftRevision,
                    expectedAggregateVersion: c.aggregateVersion,
                    resolutionId: r.id,
                  }),
                )
              }
            >
              生成此方案的修订草稿
            </button>
          </section>
        ))}
      {round && (
        <PublishedContent
          c={c}
          snapshot={s}
          submit={(response, expectedResponseVersion) =>
            act('component.respond', {
              publishedRevision: round.revision,
              expectedResponseVersion,
              response,
            })
          }
          busy={busy}
        />
      )}
      {error && (
        <p role="alert" className="collaboration-error">
          {error}
        </p>
      )}
      {(host ? c.responses : c.ownResponses)
        ?.filter((r) => 'reason' in r.response || 'text' in r.response)
        .map((r) => (
          <div key={r.id}>
            <p>
              {nameOf(s, r.actorId)}：
              {'reason' in r.response
                ? r.response.reason
                : 'text' in r.response
                  ? r.response.text
                  : ''}
            </p>
            {r.resolved ? (
              <small>报告者已标记解决</small>
            ) : (
              !s.ended &&
              r.actorId === s.actor.id &&
              ['object', 'report_issue', 'reserve', 'disagree', 'suggest_change'].includes(
                r.response.kind,
              ) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    safe(
                      act('component.resolve_report', {
                        reportId: r.id,
                        expectedReportVersion: r.version,
                        reason: '报告者在组件中明确标记已解决',
                      }),
                    )
                  }
                >
                  标记我的问题已解决
                </button>
              )
            )}
          </div>
        ))}
      {host && round?.responseGate === 'blocked' && !s.ended && (
        <button
          disabled={busy}
          onClick={() =>
            safe(
              act('component.revalidate_round', {
                publishedRevision: round.revision,
                expectedAggregateVersion: c.aggregateVersion,
                reviewResultId: s.jobs
                  ?.filter(
                    (j) =>
                      j.kind === 'impact' &&
                      j.status === 'succeeded' &&
                      (!j.componentId || j.componentId === c.id),
                  )
                  .at(-1)?.id,
              }),
            )
          }
        >
          应用复核结果
        </button>
      )}
      {host && round?.status === 'open' && (
        <footer>
          <button
            disabled={busy}
            onClick={() =>
              safe(
                act('component.close', {
                  publishedRevision: round.revision,
                  expectedAggregateVersion: c.aggregateVersion,
                }),
              )
            }
          >
            截止
          </button>
          {c.family === 'decision_confirmation' && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                safe(
                  act('component.record_decision', {
                    publishedRevision: round.revision,
                    expectedAggregateVersion: c.aggregateVersion,
                  }),
                )
              }
            >
              记录此范围决定
            </button>
          )}
        </footer>
      )}
      {!!c.missingFields.length && (
        <p className="collaboration-warning">
          {c.missingFields.map((k) => errors[k] ?? k).join('；')}
        </p>
      )}
    </article>
  );
}

function DraftEditor({
  component: c,
  snapshot: s,
  onSave,
  onDirty,
  busy,
}: {
  component: ComponentView;
  snapshot: CollaborationSnapshot;
  onSave: (content: ComponentContent, baseDraftRevision: number) => Promise<unknown>;
  onDirty: (dirty: boolean) => void;
  busy: boolean;
}) {
  const [content, setContent] = useState(c.draft!.content),
    [dirty, setDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState(c.draftRevision!);
  useEffect(() => {
    if (!dirty) {
      setContent(c.draft!.content);
      setBaseRevision(c.draftRevision!);
    }
  }, [c.draftRevision, dirty]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  const change = (fn: (next: ComponentContent) => void) => {
    const next = structuredClone(content);
    fn(next);
    setContent(next);
    setDirty(true);
  };
  const p = content.payload;
  return (
    <div className="collaboration-editor">
      {content.kind === 'poll' && (
        <>
          <label>
            投票题目
            <input
              value={content.payload.question}
              onChange={(e) =>
                change((n) => {
                  if (n.kind === 'poll') n.payload.question = e.target.value;
                })
              }
            />
          </label>
          {content.payload.options.map((o, i) => (
            <label key={o.id}>
              选项 {i + 1}
              <input
                aria-label={`选项 ${i + 1}`}
                value={o.label}
                onChange={(e) =>
                  change((n) => {
                    if (n.kind === 'poll') n.payload.options[i].label = e.target.value;
                  })
                }
              />
              <button
                aria-label={`删除选项 ${i + 1}`}
                onClick={() =>
                  change((n) => {
                    if (n.kind === 'poll') n.payload.options.splice(i, 1);
                  })
                }
              >
                删除
              </button>
            </label>
          ))}
          <button
            onClick={() =>
              change((n) => {
                if (n.kind === 'poll')
                  n.payload.options.push({
                    id: crypto.randomUUID(),
                    label: '',
                    description: '',
                    objectRefs: [],
                  });
              })
            }
          >
            添加选项
          </button>
          <label>
            选择方式
            <select
              value={content.payload.selection.mode}
              onChange={(e) =>
                change((n) => {
                  if (n.kind === 'poll')
                    n.payload.selection = {
                      mode: e.target.value as 'single' | 'multiple',
                      min: 1,
                      max: e.target.value === 'single' ? 1 : n.payload.options.length,
                    };
                })
              }
            >
              <option value="single">单选</option>
              <option value="multiple">多选</option>
            </select>
          </label>
          <p className="muted">实名记录；开放期间只显示回应人数，截止后显示汇总。</p>
        </>
      )}
      {content.kind === 'assignment' && (
        <>
          <label>
            发放方式
            <select
              value={content.payload.mode}
              onChange={(e) =>
                change((n) => {
                  if (n.kind === 'assignment')
                    n.payload.mode = e.target.value as 'display' | 'request_acceptance';
                })
              }
            >
              <option value="display">仅展示</option>
              <option value="request_acceptance">请求负责人接受</option>
            </select>
          </label>
          {content.payload.items.map((item, i) => (
            <fieldset key={item.id}>
              <legend>任务 {i + 1}</legend>
              <label>
                任务名称
                <input
                  value={item.title}
                  onChange={(e) =>
                    change((n) => {
                      if (n.kind === 'assignment') n.payload.items[i].title = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                交付物
                <input
                  value={item.deliverable}
                  onChange={(e) =>
                    change((n) => {
                      if (n.kind === 'assignment') n.payload.items[i].deliverable = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                负责人
                <select
                  aria-label="负责人"
                  value={item.assigneeId ?? ''}
                  onChange={(e) =>
                    change((n) => {
                      if (n.kind === 'assignment')
                        n.payload.items[i].assigneeId = e.target.value || null;
                    })
                  }
                >
                  <option value="">待指定</option>
                  {s.participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                时间说明
                <input
                  value={item.schedule.rawText}
                  placeholder="未知可留空"
                  onChange={(e) =>
                    change((n) => {
                      if (n.kind === 'assignment')
                        n.payload.items[i].schedule.rawText = e.target.value;
                    })
                  }
                />
              </label>
              <details>
                <summary>明确占用时间</summary>
                <p>只有已明确的独占时间区间参与重叠检查。</p>
                <label>
                  开始时间
                  <input
                    type="datetime-local"
                    value={
                      item.schedule.start
                        ? new Date(
                            Date.parse(item.schedule.start) -
                              new Date().getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      change((n) => {
                        if (n.kind === 'assignment') {
                          n.payload.items[i].schedule.start = e.target.value
                            ? new Date(e.target.value).toISOString()
                            : null;
                          n.payload.items[i].schedule.timezone =
                            Intl.DateTimeFormat().resolvedOptions().timeZone;
                          n.payload.items[i].schedule.precision = 'interval';
                        }
                      })
                    }
                  />
                </label>
                <label>
                  结束时间
                  <input
                    type="datetime-local"
                    value={
                      item.schedule.end
                        ? new Date(
                            Date.parse(item.schedule.end) - new Date().getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      change((n) => {
                        if (n.kind === 'assignment')
                          n.payload.items[i].schedule.end = e.target.value
                            ? new Date(e.target.value).toISOString()
                            : null;
                      })
                    }
                  />
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={item.schedule.exclusive === true}
                    onChange={(e) =>
                      change((n) => {
                        if (n.kind === 'assignment')
                          n.payload.items[i].schedule.exclusive = e.target.checked;
                      })
                    }
                  />
                  这段时间不能同时承担其他任务
                </label>
              </details>
              <button
                onClick={() =>
                  change((n) => {
                    if (n.kind === 'assignment') n.payload.items.splice(i, 1);
                  })
                }
              >
                删除任务
              </button>
            </fieldset>
          ))}
          <button
            onClick={() =>
              change((n) => {
                if (n.kind === 'assignment') n.payload.items.push(newTask());
              })
            }
          >
            添加任务
          </button>
        </>
      )}
      {content.kind === 'decision_confirmation' && (
        <>
          <label>
            拟定结论
            <textarea
              value={content.payload.statement}
              onChange={(e) =>
                change((n) => {
                  if (n.kind === 'decision_confirmation') n.payload.statement = e.target.value;
                })
              }
            />
          </label>
          <label>
            确认范围
            <input
              value={content.payload.scopeText}
              onChange={(e) =>
                change((n) => {
                  if (n.kind === 'decision_confirmation') n.payload.scopeText = e.target.value;
                })
              }
            />
          </label>
          <p>指定范围内每个人需对同一版本明确同意。</p>
          {content.payload.conditions.map((condition, i) => (
            <label key={condition.id}>
              条件 {i + 1}
              <input
                value={condition.text}
                onChange={(e) =>
                  change((n) => {
                    if (n.kind === 'decision_confirmation')
                      n.payload.conditions[i].text = e.target.value;
                  })
                }
              />
            </label>
          ))}
          <button
            onClick={() =>
              change((n) => {
                if (n.kind === 'decision_confirmation')
                  n.payload.conditions.push({
                    id: crypto.randomUUID(),
                    text: '',
                    objectRefs: [],
                    evidence: [],
                  });
              })
            }
          >
            添加条件
          </button>
        </>
      )}
      {content.kind === 'conflict' && (
        <>
          {!content.payload.conflictRefs.length && (
            <label>
              关联待核对冲突
              <select
                defaultValue=""
                onChange={(e) =>
                  change((n) => {
                    const f = s.conflicts?.find((f) => f.id === e.target.value);
                    if (n.kind === 'conflict' && f) {
                      n.payload.conflictRefs = [{ id: f.id, rev: f.revision }];
                      n.payload.sides = [
                        {
                          id: crypto.randomUUID(),
                          title: f.summary,
                          description: f.impact,
                          objectRefs: f.objectRefs,
                          evidence: f.evidence,
                        },
                      ];
                    }
                  })
                }
              >
                <option value="">请先选择冲突</option>
                {s.conflicts
                  ?.filter((f) => f.resolution !== 'resolved')
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.summary}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {content.payload.sides.map((side) => (
            <div key={side.id}>
              <strong>{side.title}</strong>
              <p>{side.description}</p>
            </div>
          ))}
          {content.payload.resolutions.map((resolution, i) => (
            <fieldset key={resolution.id}>
              <legend>待讨论方案 {i + 1}</legend>
              <label>
                方案名称
                <input
                  value={resolution.title}
                  onChange={(e) =>
                    change((n) => {
                      if (n.kind === 'conflict') n.payload.resolutions[i].title = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                影响与取舍
                <textarea
                  value={resolution.tradeoffs}
                  onChange={(e) =>
                    change((n) => {
                      if (n.kind === 'conflict')
                        n.payload.resolutions[i].tradeoffs = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                修订任务
                <select
                  value={
                    resolution.actions[0]?.kind === 'revise_task'
                      ? resolution.actions[0].taskRef.id
                      : ''
                  }
                  onChange={(e) =>
                    change((n) => {
                      if (n.kind !== 'conflict') return;
                      const task = (
                        s.assignmentDirectory ??
                        s.components.flatMap((c) =>
                          c.draft?.content.kind === 'assignment'
                            ? c.draft.content.payload.items
                            : [],
                        )
                      ).find((t) => (t.taskRef?.id ?? t.id) === e.target.value);
                      n.payload.resolutions[i].actions = task
                        ? [
                            {
                              kind: 'revise_task',
                              taskRef: task.taskRef ?? { id: task.id, rev: task.itemRevision },
                              proposed: {},
                            },
                          ]
                        : [];
                    })
                  }
                >
                  <option value="">选择相关任务</option>
                  {(
                    s.assignmentDirectory ??
                    s.components.flatMap((c) =>
                      c.draft?.content.kind === 'assignment' ? c.draft.content.payload.items : [],
                    )
                  ).map((t) => (
                    <option key={t.id} value={t.taskRef?.id ?? t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              {resolution.actions[0]?.kind === 'revise_task' && (
                <label>
                  建议的新时间说明
                  <input
                    value={resolution.actions[0].proposed.scheduleText ?? ''}
                    onChange={(e) =>
                      change((n) => {
                        if (n.kind === 'conflict') {
                          const action = n.payload.resolutions[i].actions[0];
                          if (action.kind === 'revise_task')
                            action.proposed.scheduleText = e.target.value;
                        }
                      })
                    }
                  />
                </label>
              )}
            </fieldset>
          ))}
          <button
            disabled={content.payload.resolutions.length >= 4}
            onClick={() =>
              change((n) => {
                if (n.kind === 'conflict')
                  n.payload.resolutions.push({
                    id: crypto.randomUUID(),
                    title: '',
                    tradeoffs: '',
                    actions: [],
                  });
              })
            }
          >
            添加讨论方案
          </button>
        </>
      )}
      <button
        className="primary"
        disabled={!dirty || busy}
        onClick={() =>
          void onSave(content, baseRevision)
            .then(() => setDirty(false))
            .catch(() => {})
        }
      >
        保存草稿
      </button>
      {dirty && baseRevision !== c.draftRevision && (
        <p role="alert">
          后台已有新版。当前输入已保留，请核对后再编辑。
          <button
            onClick={() => {
              setContent(c.draft!.content);
              setBaseRevision(c.draftRevision!);
              setDirty(false);
            }}
          >
            载入新版并放弃本地修改
          </button>
        </p>
      )}
      {dirty && <small>有未保存修改，请先保存再发放。</small>}
    </div>
  );
}

function PublishedContent({
  c,
  snapshot: s,
  submit,
  busy,
}: {
  c: ComponentView;
  snapshot: CollaborationSnapshot;
  submit: (response: ComponentResponse, version: number) => Promise<unknown>;
  busy: boolean;
}) {
  const round = c.round!;
  const [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState(''),
    [saved, setSaved] = useState(false);
  const own = c.ownResponses.find((r) => r.subject === 'person');
  useEffect(() => {
    setSaved(false);
    setSelected(own?.response.kind === 'vote' ? own.response.optionIds : []);
  }, [round.revision]);
  const canRespond =
    round.status === 'open' &&
    round.responseGate === 'open' &&
    round.audienceIds.includes(s.actor.id);
  const sendResponse = (response: ComponentResponse, subject = 'person') =>
    void submit(response, c.ownResponses.find((r) => r.subject === subject)?.version ?? 0)
      .then(() => setSaved(true))
      .catch(() => {});
  const content = round.content;
  return (
    <div className="collaboration-published">
      {content.kind === 'poll' && (
        <>
          <h3>{content.payload.question}</h3>
          {c.result ? (
            <div className="collaboration-result">
              {(c.result.counts as { optionId: string; count: number }[]).map((row) => (
                <p key={row.optionId}>
                  {content.payload.options.find((o) => o.id === row.optionId)?.label}：{row.count}票
                </p>
              ))}
              <small>
                弃权 {String(c.result.abstained)} · 未回应 {String(c.result.pending)}
              </small>
            </div>
          ) : (
            <fieldset disabled={!canRespond || busy}>
              <legend>请选择</legend>
              {content.payload.options.map((o) => (
                <label className="inline" key={o.id}>
                  <input
                    type={content.payload.selection.mode === 'single' ? 'radio' : 'checkbox'}
                    name={c.id}
                    checked={selected.includes(o.id)}
                    onChange={(e) =>
                      setSelected(
                        content.payload.selection.mode === 'single'
                          ? [o.id]
                          : e.target.checked
                            ? [...selected, o.id]
                            : selected.filter((id) => id !== o.id),
                      )
                    }
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          )}
          {canRespond && (
            <>
              <button
                className="primary"
                disabled={busy || !selected.length}
                onClick={() => sendResponse({ kind: 'vote', optionIds: selected })}
              >
                提交投票
              </button>
              {content.payload.allowAbstain && (
                <button disabled={busy} onClick={() => sendResponse({ kind: 'abstain' })}>
                  弃权
                </button>
              )}
            </>
          )}
        </>
      )}
      {content.kind === 'assignment' && (
        <div className="assignment-list">
          {content.payload.items.map((item) => (
            <section key={item.id}>
              <h3>{item.title}</h3>
              <p>{item.deliverable}</p>
              <p>
                {nameOf(s, item.assigneeId ?? '')} · {item.schedule.rawText || '时间未约定'}
                {item.unresolvedAssigneeText &&
                  !item.assigneeId &&
                  ` · 负责人原话（未绑定身份）：${item.unresolvedAssigneeText}`}
              </p>
              {item.discussionPoints.map((p) => (
                <p className="collaboration-warning" key={p.id}>
                  {p.text}
                </p>
              ))}
              {!!item.conflictIds.length && <p className="collaboration-warning">存在待核对冲突</p>}
              {canRespond && (
                <>
                  {content.payload.mode === 'request_acceptance' &&
                    item.assigneeId === s.actor.id && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            sendResponse(
                              { kind: 'accept', itemId: item.id, itemRevision: item.itemRevision },
                              item.id,
                            )
                          }
                        >
                          接受任务
                        </button>
                        <button
                          disabled={busy || !reason.trim()}
                          onClick={() =>
                            sendResponse(
                              {
                                kind: 'object',
                                itemId: item.id,
                                itemRevision: item.itemRevision,
                                reason,
                              },
                              item.id,
                            )
                          }
                        >
                          提出异议
                        </button>
                      </>
                    )}
                  <label>
                    补充说明
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={() => {
                      const commentId = crypto.randomUUID();
                      sendResponse(
                        {
                          kind: 'report_issue',
                          itemId: item.id,
                          itemRevision: item.itemRevision,
                          reason,
                          commentId,
                        },
                        commentId,
                      );
                    }}
                  >
                    报告问题
                  </button>
                </>
              )}
            </section>
          ))}
        </div>
      )}
      {content.kind === 'decision_confirmation' && (
        <>
          <h3>{content.payload.statement}</h3>
          <p>{content.payload.scopeText}</p>
          {content.payload.conditions.map((v) => (
            <p key={v.id}>条件：{v.text}</p>
          ))}
          {canRespond && (
            <>
              <label>
                说明
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="collaboration-toolbar">
                <button disabled={busy} onClick={() => sendResponse({ kind: 'agree' })}>
                  同意
                </button>
                <button
                  disabled={busy || !reason.trim()}
                  onClick={() => sendResponse({ kind: 'reserve', reason })}
                >
                  有保留
                </button>
                <button
                  disabled={busy || !reason.trim()}
                  onClick={() => sendResponse({ kind: 'disagree', reason })}
                >
                  不同意
                </button>
              </div>
            </>
          )}
        </>
      )}
      {content.kind === 'conflict' && (
        <>
          <div className="conflict-sides">
            {content.payload.sides.map((side) => (
              <section key={side.id}>
                <strong>{side.title}</strong>
                <p>{side.description}</p>
              </section>
            ))}
          </div>
          {content.payload.resolutions.map((r) => (
            <section key={r.id}>
              <strong>{r.title}</strong>
              <p>{r.tradeoffs}</p>
              {canRespond && (
                <button
                  disabled={busy}
                  onClick={() => sendResponse({ kind: 'support_resolution', resolutionId: r.id })}
                >
                  支持此方案
                </button>
              )}
            </section>
          ))}
          {canRespond && (
            <>
              <label>
                补充约束
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button
                disabled={busy || !reason.trim()}
                onClick={() => {
                  const commentId = crypto.randomUUID();
                  sendResponse(
                    { kind: 'provide_context', questionId: null, commentId, text: reason },
                    commentId,
                  );
                }}
              >
                提交说明
              </button>
            </>
          )}
        </>
      )}
      {(saved || c.ownResponses.length > 0) && <p role="status">已提交</p>}
      {!!c.statuses.length && (
        <details>
          <summary>回应状态</summary>
          {c.statuses.map((r, i) => (
            <p key={i}>
              {nameOf(s, r.participantId)}：
              {(
                {
                  agree: '同意',
                  reserve: '有保留',
                  disagree: '不同意',
                  accept: '已接受',
                  object: '有异议',
                  report_issue: '有待处理问题',
                } as Record<string, string>
              )[r.kind] ?? '已回应'}
            </p>
          ))}
        </details>
      )}
      {!!round.sharedEvidence.length && (
        <details>
          <summary>查看依据</summary>
          {round.sharedEvidence.map((e, i) => (
            <blockquote key={i}>{e.excerpt}</blockquote>
          ))}
        </details>
      )}
    </div>
  );
}
