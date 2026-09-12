import React from 'react';
import { ArrowUpRight, Layers } from 'lucide-react';
import type { Snapshot, Ref } from '../contracts/model';
import { ArtifactView } from '../renderers/ArtifactView';
import { api } from './bridge';
import { translator, errorText } from './i18n';
import { launcherIndicator, readyComponents } from './launcher-status';
import { sourceNumbers } from './source-references';
import { useLiveArtifact } from './live';
import { LiveEditing } from './LiveEditing';
import './hover-preview.css';

/** A second view of the live meeting artifact, without starting work on hover. */
export function HoverPreview({
  snapshot,
  serviceError,
}: {
  snapshot: Snapshot | null;
  serviceError: boolean;
}) {
  const meeting = snapshot?.meetings.find((m) => m.status === 'active');
  const locale = snapshot?.preferences.uiLocale ?? 'en';
  const t = translator(locale);
  const words =
    locale === 'zh-CN'
      ? {
          canvas: '会议画板',
          empty: '还没有正在进行的会议',
          waiting: '有值得整理的内容时，画板会在这里呈现。',
          start: '打开会议入口',
          hint: '移开鼠标即可收起',
          ready: '个协作组件待查看',
        }
      : {
          canvas: 'Meeting canvas',
          empty: 'No meeting in progress',
          waiting: 'The canvas will appear here when there is something to show.',
          start: 'Open meetings',
          hint: 'Move away to dismiss',
          ready: 'collaboration components to review',
        };
  const latest = meeting?.artifacts.filter((a) => (a.scope ?? 'meeting') === 'meeting').at(-1);
  const { artifact: displayed } = useLiveArtifact(latest, false, meeting?.id);
  // A lifecycle snapshot can remove the meeting before the live-view layout effect runs.
  const artifact = meeting && latest ? displayed : undefined;
  const indicator = launcherIndicator(meeting, serviceError);
  const notices = readyComponents(meeting?.collaboration);
  const open = (refs?: Ref[], target?: string, prompt?: string) =>
    void api('openPreview', {
      meetingId: meeting?.id,
      artifactId: artifact?.id,
      artifactRev: artifact?.rev,
      refs,
      target,
      prompt,
    });
  return (
    <section
      className={`preview ${meeting ? 'preview-has-meeting' : 'preview-idle'}`}
      aria-label={words.canvas}
    >
      <header className="preview-header">
        <div className="preview-heading">
          <span className="preview-label">
            <Layers size={14} />
            {words.canvas}
          </span>
          <span className={`status launcher-status-${indicator.state}`}>
            {t(indicator.labelKey)}
          </span>
        </div>
        {meeting && <h1 title={meeting.title}>{meeting.title}</h1>}
      </header>
      <div className="preview-scroll" key={meeting?.id ?? 'idle'}>
        {(meeting?.captureError || meeting?.error || serviceError) && (
          <p className="error-text preview-error" role="status">
            {serviceError
              ? t('serviceError')
              : errorText(locale, meeting!.captureError || meeting!.error!)}
          </p>
        )}
        {meeting && snapshot && (
          <LiveEditing meeting={meeting} snapshot={snapshot} locale={locale} />
        )}
        {artifact ? (
          <article
            className="preview-canvas"
            data-artifact-id={artifact.id}
            data-artifact-rev={artifact.rev}
          >
            <h2 className="preview-question">{artifact.question}</h2>
            {artifact.summary && <p className="preview-summary">{artifact.summary}</p>}
            <ArtifactView
              artifact={artifact}
              locale={locale}
              sourceNumbers={sourceNumbers(meeting!.segments)}
              onSources={(refs, target) => open(refs, target)}
              onAction={(prompt) => open(undefined, undefined, prompt)}
            />
          </article>
        ) : (
          <div className="preview-empty">
            {!meeting && <strong>{words.empty}</strong>}
            <p>{meeting ? words.waiting : t('design.emptyHint')}</p>
          </div>
        )}
      </div>
      <footer className="preview-footer">
        <span>{words.hint}</span>
        {!!notices.length && (
          <button
            className="text-button preview-components"
            onClick={() => void api('openReadyComponents')}
          >
            {notices.length} {words.ready}
          </button>
        )}
        <button className="text-button preview-open" onClick={() => open()}>
          {meeting ? t('preview.open') : words.start}
          <ArrowUpRight size={14} />
        </button>
      </footer>
    </section>
  );
}
