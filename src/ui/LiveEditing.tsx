import React, { useEffect, useState } from 'react';
import { AudioLines, PenLine, Check, GitBranch } from 'lucide-react';
import type { Meeting, Snapshot, Locale } from '../contracts/model';

/** Reflect actual capture, model tokens and committed revisions; no synthetic progress. */
export function LiveEditing({
  meeting,
  snapshot,
  locale,
}: {
  meeting: Meeting;
  snapshot: Snapshot;
  locale: Locale;
}) {
  const [updated, setUpdated] = useState(false);
  const latest = meeting.artifacts.filter((a) => (a.scope ?? 'meeting') === 'meeting').at(-1);
  useEffect(() => {
    if (!latest) return;
    setUpdated(true);
    const timer = setTimeout(() => setUpdated(false), 3200);
    return () => clearTimeout(timer);
  }, [meeting.id, latest?.id, latest?.rev]);
  const drafts = (snapshot.liveDrafts ?? []).filter((d) => d.meetingId === meeting.id);
  const partials = (snapshot.liveTranscripts ?? []).filter((p) => p.meetingId === meeting.id);
  const draft = [...drafts].reverse().find((d) => d.kind === 'understand') ?? drafts.at(-1);
  const drawing = meeting.expressionStatus === 'working';
  const thinking = meeting.processing === 'working';
  const active = drawing || thinking;
  const state = active
    ? draft?.kind === 'generate' || !thinking
      ? 'drawing'
      : 'thinking'
    : updated
      ? 'updated'
      : partials.length
        ? 'transcribing'
        : 'listening';
  if (!active && !updated && !partials.length && meeting.capture !== 'capturing') return null;
  const words =
    locale === 'zh-CN'
      ? {
          drawing: 'Agent 正在编排画面',
          thinking: 'Agent 正在梳理与编辑',
          updated: '已更新讨论内容',
          transcribing: '正在听取发言',
          listening: '持续聆听中',
          draft: '生成草稿',
          partial: '转写中',
        }
      : {
          drawing: 'Agent is shaping the visual',
          thinking: 'Agent is understanding & editing',
          updated: 'Discussion updated',
          transcribing: 'Hearing the discussion',
          listening: 'Listening',
          draft: 'Draft in progress',
          partial: 'Transcribing',
        };
  const Icon =
    state === 'updated' ? Check : state === 'drawing' ? GitBranch : active ? PenLine : AudioLines;
  return (
    <aside
      className="live-editing"
      data-stage={state}
      aria-label={locale === 'zh-CN' ? '实时编辑状态' : 'Live editing status'}
    >
      <div className="live-editing-heading" role="status">
        <Icon size={16} />
        <strong>{words[state]}</strong>
        {active && <span className="working-indicator" aria-hidden="true" />}
      </div>
      {active && draft?.text && (
        <p className="live-model-draft">
          <span>{words.draft}</span>
          {draft.text}
          <i aria-hidden="true" />
        </p>
      )}
      {!active && updated && meeting.changes.length > 0 && (
        <p className="live-edit-delta">{meeting.changes[0]}</p>
      )}
      {partials.map((p) => (
        <p className="live-transcript" key={p.segmentId}>
          <span>{words.partial}</span>
          {p.text}
        </p>
      ))}
    </aside>
  );
}
