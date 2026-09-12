import React from 'react';
import type { ArtifactRevision, Meeting, ObjectState, Ref } from '../contracts/model';
import { translator } from './i18n';

type Props = {
  meeting: Meeting;
  locale: 'en' | 'zh-CN';
  onSources: (refs: Ref[], target?: string) => void;
};
function Item({ object, meeting, locale, onSources }: Props & { object: ObjectState }) {
  const t = translator(locale),
    meaning = object.meaning;
  return (
    <li>
      <strong>{object.title}</strong> · {t('meaning.' + (meaning?.stance ?? 'unknown'))}
      {object.reviewRequired && <span className="stale"> · {t('review.changed')}</span>}
      <p>{object.detail}</p>
      {!!meaning?.conditionIds.length && (
        <p>
          {t('review.conditions')}:{' '}
          {meaning.conditionIds
            .map((id) => meeting.objects.find((o) => o.id === id)?.detail ?? t('review.changed'))
            .join('；')}
        </p>
      )}
      {meaning?.owner && (
        <p>
          {t('review.owner')}: {meaning.owner.value}
        </p>
      )}
      {meaning?.deadline && (
        <p>
          {t('review.deadline')}: {meaning.deadline.value}
        </p>
      )}
      <button className="source-link" onClick={() => onSources(object.sources, object.title)}>
        {t('sources.open')}
      </button>
    </li>
  );
}

export function MeaningNotes(props: Props & { artifact: ArtifactRevision }) {
  if (props.artifact.scope === 'personal') return null;
  const t = translator(props.locale);
  const objects = props.meeting.objects.filter(
    (o) => props.artifact.objectIds.includes(o.id) && (o.meaning || o.reviewRequired),
  );
  if (!objects.length) return null;
  return (
    <details className="meeting-review" data-testid="meaning-notes">
      <summary>
        {t('review.basis')}
        {objects.some((o) => o.reviewRequired) ? ' · ' + t('review.changed') : ''}
      </summary>
      <p className="muted">{t('review.basisNote')}</p>
      <ul>
        {objects.map((object) => (
          <Item key={object.id} {...props} object={object} />
        ))}
      </ul>
    </details>
  );
}

export function MeetingReview(props: Props) {
  const { meeting: m, locale, onSources } = props,
    report = m.closeout,
    t = translator(locale);
  if (m.status !== 'ended' || !report) return null;
  const issueGroups: [string, string[]][] = [
    ['review.changed', report.reviewObjectIds],
    ['review.unresolved', report.unresolvedObjectIds],
    ['review.conditions', report.conditionalObjectIds],
    ['review.incomplete', report.incompleteTaskIds],
    ['review.unclassified', report.provisionalObjectIds],
  ];
  return (
    <details
      className="meeting-review"
      data-testid="meeting-closeout"
      aria-label={t('review.title')}
    >
      <summary>
        <strong>{t('review.title')}</strong> ·{' '}
        <span role="status">{t('review.' + report.state)}</span>
      </summary>
      <p className="muted">{t('review.limit')}</p>
      {!!report.pendingSources.length && (
        <p>
          {t('review.pendingSources')}: {report.pendingSources.length}
        </p>
      )}
      {!!report.gapCount && (
        <p className="stale">
          {t('review.gaps')}: {report.gapCount}
        </p>
      )}
      {!!report.staleArtifactIds.length && (
        <p className="stale">
          {t('review.staleArtifacts')}: {report.staleArtifactIds.length}
        </p>
      )}
      {!!report.staleDecisionIds.length && (
        <p className="stale">
          {t('review.staleDecisions')}: {report.staleDecisionIds.length}
        </p>
      )}
      {issueGroups
        .filter(([, ids]) => ids.length)
        .map(([label, ids]) => (
          <details key={label}>
            <summary>
              {t(label)} ({ids.length})
            </summary>
            <ul>
              {ids
                .map((id) => m.objects.find((o) => o.id === id))
                .filter((o): o is ObjectState => !!o)
                .map((object) => (
                  <Item key={object.id} {...props} object={object} />
                ))}
            </ul>
          </details>
        ))}
      <details>
        <summary>{t('review.minutes')}</summary>
        <ul>
          {m.objects
            .filter((o) => o.lifecycle === 'active' && o.kind !== 'topic')
            .map((object) => (
              <Item key={object.id} {...props} object={object} />
            ))}
        </ul>
        {!m.objects.some((o) => o.lifecycle === 'active' && o.kind !== 'topic') && (
          <p>{t('review.noItems')}</p>
        )}
        {m.decisions
          .filter((d) => d.scope === 'meeting')
          .map((d) => (
            <div key={d.id}>
              <strong>
                {t('review.recordedDecision')}: {d.artifact.question}
              </strong>
              <p>
                {d.basis} · {d.participants}
              </p>
              {report.staleDecisionIds.includes(d.id) && (
                <p className="stale">{t('review.changed')}</p>
              )}
              <button
                className="source-link"
                onClick={() => onSources(d.sources, d.artifact.question)}
              >
                {t('sources.open')}
              </button>
            </div>
          ))}
      </details>
    </details>
  );
}
