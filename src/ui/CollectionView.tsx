import { ChevronRight, FileText, Plus, Trash2, AlertTriangle, Layers } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildCollectionDigest, type CollectionDigest } from '../domain/collection-digest';
import type {
  CollectionReportRevision,
  Locale,
  Meeting,
  MeetingCollection,
  Ref,
} from '../contracts/model';
import { MAX_COLLECTION_MEMBERS } from '../contracts/model';
import { translator } from './i18n';
import { Modal } from './components';
import { ArtifactView } from '../renderers/ArtifactView';
import { collectionReportStaleness, groupCitations, type CitationGroup } from '../domain/collection';

/** Mirrors MEETING_COLLECTION_CONTEXT_BYTES. The renderer cannot read env, and
 *  this panel is advisory - the service enforces the real cap on generation. */
const COLLECTION_DIGEST_BUDGET = 32000;

export function CollectionModal({
  collection,
  meetings,
  locale,
  save,
  close,
}: {
  collection?: MeetingCollection;
  meetings: Meeting[];
  locale: Locale;
  save: (payload: { title: string; brief: string; meetingIds: string[] }) => Promise<void>;
  close: () => void;
}) {
  const t = translator(locale);
  const [title, setTitle] = useState(collection?.title ?? '');
  const [brief, setBrief] = useState(collection?.brief ?? '');
  const [members, setMembers] = useState<string[]>(collection?.meetingIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (id: string) =>
    setMembers((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  return (
    <Modal title={collection ? t('collection.name') : t('collection.new')} close={close}>
      <form
        className="collection-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!members.length) {
            setError(t('collection.membersEmpty'));
            return;
          }
          setBusy(true);
          try {
            await save({ title: title.trim(), brief, meetingIds: members });
          } catch (cause) {
            setError((cause as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          {t('collection.name')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            required
          />
        </label>
        <label>
          {t('collection.brief')}
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            maxLength={600}
            rows={3}
            placeholder={t('collection.briefPlaceholder')}
          />
        </label>
        <fieldset className="collection-members">
          <legend>{t('collection.members')}</legend>
          {meetings.length === 0 && <p className="muted">{t('emptyLibrary')}</p>}
          {meetings.map((m) => (
            <label className="check" key={m.id}>
              <input
                type="checkbox"
                checked={members.includes(m.id)}
                disabled={!members.includes(m.id) && members.length >= MAX_COLLECTION_MEMBERS}
                onChange={() => toggle(m.id)}
              />
              {m.title}
            </label>
          ))}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {/* Matches DecisionModal: the modal's own close control is the cancel. */}
        <button className="primary" disabled={busy || !title.trim()}>
          {t('collection.save')}
        </button>
      </form>
    </Modal>
  );
}

/**
 * The deterministic half of the feature. Everything here comes from
 * classifyOpenItems and recorded decisions, so it cannot be wrong the way model
 * output can - which is why it is shown even before a report exists.
 */
function DigestPanel({
  digest,
  locale,
  onOpenInMeeting,
}: {
  digest: CollectionDigest;
  locale: Locale;
  onOpenInMeeting: (meetingId: string, refs: Ref[]) => void;
}) {
  const t = translator(locale);
  const openSource = (alias: string) => {
    const a = digest.aliasMap[alias];
    if (a) onOpenInMeeting(a.meetingId, [{ id: a.id, rev: a.rev }]);
  };
  const openObject = (alias: string) => {
    const a = digest.aliasMap[alias];
    if (a) onOpenInMeeting(a.meetingId, []);
  };
  if (!digest.decisions.length && !digest.open.length && !digest.disputes.length)
    return <p className="muted">{t('collection.digest.none')}</p>;
  return (
    <div className="collection-digest">
      <p className="muted digest-note">{t('collection.digest.hint')}</p>
      {digest.omitted.openItems + digest.omitted.meetings + digest.omitted.quotes > 0 && (
        <p className="muted digest-note">
          <AlertTriangle size={13} /> {t('collection.digest.omitted')}
        </p>
      )}

      {digest.disputes.length > 0 && (
        <section className="digest-group">
          <h3>{t('collection.digest.disputes')}</h3>
          {digest.disputes.map((dispute, i) => (
            <div className="digest-dispute" key={`${dispute.basis}-${i}`}>
              <strong>{dispute.label}</strong>
              <span className="eyebrow">{t('collection.basis.' + dispute.basis)}</span>
              <div className="digest-positions">
                {dispute.positions.map((p) => (
                  <button
                    className="digest-position"
                    key={p.alias}
                    onClick={() => openObject(p.alias)}
                  >
                    <span className="eyebrow">
                      {p.meetingAlias} · {t('meaning.' + (p.stance ?? 'unknown'))}
                    </span>
                    {p.quote && <blockquote>{p.quote}</blockquote>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {digest.decisions.length > 0 && (
        <section className="digest-group">
          <h3>{t('collection.digest.decisions')}</h3>
          {digest.decisions.map((d) => (
            <div className="digest-item" key={d.alias}>
              <button className="digest-title" onClick={() => openObject(d.alias)}>
                <strong>{d.question || d.summary}</strong>
              </button>
              <span className="eyebrow">{d.meetingTitle}</span>
              {d.summary && d.question && <p>{d.summary}</p>}
              {d.basis && <p className="muted">{d.basis}</p>}
            </div>
          ))}
        </section>
      )}

      {digest.open.length > 0 && (
        <section className="digest-group">
          <h3>{t('collection.digest.open')}</h3>
          {digest.open.map((item) => (
            <div className="digest-item" key={item.alias}>
              <button className="digest-title" onClick={() => openObject(item.alias)}>
                <strong>{item.title}</strong>
              </button>
              <span className="eyebrow">
                {item.meetingTitle}
                {item.reason.map((r) => (
                  <em key={r}> · {t('collection.reason.' + r)}</em>
                ))}
              </span>
              {(item.owner || item.deadline) && (
                <p className="muted">
                  {item.owner && <span>{item.owner}</span>}
                  {item.owner && item.deadline && <span> · </span>}
                  {item.deadline && <span>{item.deadline}</span>}
                </p>
              )}
              {item.quotes.map((q) => (
                <button className="digest-quote" key={q.alias} onClick={() => openSource(q.alias)}>
                  <blockquote>{q.text}</blockquote>
                  <span className="eyebrow">
                    {q.meetingAlias} · {t('collection.openInMeeting')}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export function CollectionWorkspace({
  collection,
  meetings,
  locale,
  onBack,
  onEdit,
  onDelete,
  onGenerate,
  onOpenInMeeting,
}: {
  collection: MeetingCollection;
  meetings: Meeting[];
  locale: Locale;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onGenerate: () => void;
  onOpenInMeeting: (meetingId: string, refs: Ref[]) => void;
}) {
  const t = translator(locale);
  const members = collection.meetingIds
    .map((id) => meetings.find((m) => m.id === id))
    .filter((m): m is Meeting => !!m);
  const report: CollectionReportRevision | undefined = collection.reports.at(-1);
  const stale = report ? collectionReportStaleness(report, collection, meetings) : [];
  const digest = useMemo(() => {
    try {
      return buildCollectionDigest(collection, meetings, COLLECTION_DIGEST_BUDGET);
    } catch {
      // Over budget. The deterministic panel is a convenience; the report path
      // reports COLLECTION_CONTEXT_TOO_LARGE with a real message.
      return null;
    }
  }, [collection, meetings]);
  const [drawer, setDrawer] = useState<CitationGroup[] | null>(null);
  const openInMeeting = (meetingId: string, refs: Ref[]) => onOpenInMeeting(meetingId, refs);
  return (
    <>
      <div className="workspace-meta">
        <nav className="view-tabs">
          <button onClick={onBack}>
            <Layers size={14} /> {t('collection.back')}
          </button>
        </nav>
        <div className="meta-actions">
          <button className="text-button" onClick={onEdit}>
            {t('collection.addMeetings')}
          </button>
          <button
            className="text-button danger"
            onClick={() => {
              if (confirm(t('collection.deleteConfirm'))) onDelete();
            }}
          >
            <Trash2 size={14} /> {t('collection.delete')}
          </button>
        </div>
      </div>
      <main className="workspace collection-workspace">
        <div className="document-meta">
          <span className="meeting-file is-collection">
            <Layers size={21} />
          </span>
          <div>
            <h1>{collection.title}</h1>
            <p>
              {members.length} {t('collection.meetingSuffix')} · {collection.reports.length}{' '}
              {t('collection.reportSuffix')}
            </p>
          </div>
        </div>
        {collection.brief && <p className="collection-brief">{collection.brief}</p>}

        <section className="collection-members-list">
          <h2>{t('collection.members')}</h2>
          <div className="meeting-list">
            {members.map((m) => (
              <button
                className="meeting-row"
                key={m.id}
                onClick={() => openInMeeting(m.id, [])}
              >
                <span className={`meeting-file ${m.status === 'active' ? 'is-active' : ''}`}>
                  <FileText size={21} />
                </span>
                <div className="meeting-row-content">
                  <strong>{m.title}</strong>
                  <p>
                    {new Date(m.createdAt).toLocaleString(locale, {
                      month: 'short',
                      day: 'numeric',
                    })}
                    {m.status === 'active' && (
                      <>
                        <span>·</span>
                        {t('collection.memberLive')}
                      </>
                    )}
                  </p>
                </div>
                <ChevronRight className="row-chevron" size={17} />
              </button>
            ))}
          </div>
        </section>

        <section className="collection-deterministic">
          <div className="recent-heading">
            <h2>{t('collection.digest.heading')}</h2>
          </div>
          {digest ? (
            <DigestPanel digest={digest} locale={locale} onOpenInMeeting={openInMeeting} />
          ) : (
            <p className="muted">{t('error.COLLECTION_CONTEXT_TOO_LARGE')}</p>
          )}
        </section>

        <section className="collection-report">
          <div className="recent-heading">
            <h2>{t('collection.report.revision')}</h2>
            <button
              className="primary"
              disabled={collection.reportStatus === 'working'}
              onClick={onGenerate}
            >
              <Plus size={15} />
              {t(
                collection.reportStatus === 'working'
                  ? 'collection.report.generating'
                  : report
                    ? 'collection.report.regenerate'
                    : 'collection.report.generate',
              )}
            </button>
          </div>
          {collection.reportError && (
            <div role="alert" className="banner error">
              {collection.reportError}
            </div>
          )}
          {stale.length > 0 && (
            <div className="banner warning">
              <AlertTriangle size={15} />
              <div>
                <strong>{t('collection.report.stale')}</strong>
                <ul>
                  {[...new Set(stale.map((s) => s.kind))].map((kind) => (
                    <li key={kind}>
                      {t(
                        kind === 'member_set_changed'
                          ? 'collection.memberChanged'
                          : kind === 'member_missing'
                            ? 'collection.memberMissing'
                            : kind === 'citation_superseded'
                              ? 'collection.citationSuperseded'
                              : 'collection.memberChanged',
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {report ? (
            <ArtifactView
              artifact={report}
              locale={locale}
              onSources={(refs) => setDrawer(groupCitations(refs, report, meetings))}
            />
          ) : (
            <div className="library-empty">
              <span className="quiet-icon">
                <Layers size={23} />
              </span>
              <div>
                <strong>{t('collection.report.none')}</strong>
                <p>{t('collection.report.noneHint')}</p>
              </div>
            </div>
          )}
        </section>
      </main>
      {drawer && (
        <CollectionDrawer
          groups={drawer}
          locale={locale}
          onClose={() => setDrawer(null)}
          onOpenInMeeting={openInMeeting}
        />
      )}
    </>
  );
}

/**
 * Read-only on purpose. SourceDrawer would route corrections through
 * command('correct'), which resolves the segment against the currently open
 * meeting - across meetings that would silently misfile a correction.
 */
function CollectionDrawer({
  groups,
  locale,
  onClose,
  onOpenInMeeting,
}: {
  groups: CitationGroup[];
  locale: Locale;
  onClose: () => void;
  onOpenInMeeting: (meetingId: string, refs: Ref[]) => void;
}) {
  const t = translator(locale);
  return (
    <aside className="source-drawer" role="dialog" aria-modal="true" aria-label={t('sources.open')}>
      <header>
        <h2>{t('collection.sourcesHeading')}</h2>
        <button aria-label={t('dismiss')} onClick={onClose}>
          {t('dismiss')}
        </button>
      </header>
      {groups.length === 0 && <p className="muted">{t('collection.noSources')}</p>}
      {groups.map((group) => (
        <article key={group.meetingId} className="source-card">
          <span className="eyebrow">{group.meetingTitle}</span>
          <p className="muted">
            {group.refs.length} {t('sources')}
          </p>
          <button
            className="source-link"
            onClick={() => onOpenInMeeting(group.meetingId, group.refs)}
          >
            {t('collection.openInMeeting')}
            <ChevronRight size={13} />
          </button>
        </article>
      ))}
    </aside>
  );
}
