import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, BookOpen, X } from 'lucide-react';
import type { Meeting, Ref, Segment, Locale } from '../contracts/model';
import { translator, errorText } from './i18n';
import { editorialCopy } from './editorial-copy';
import { sourceNumbers, resolveSources } from './source-references';
import { TranslationView } from './components';

export function SourcePanel({
  meeting,
  refs,
  locale,
  open,
  target = '',
  onClose,
  onOpen,
  onCorrect,
  onFeedback,
}: {
  meeting: Meeting;
  refs: Ref[];
  locale: Locale;
  open: boolean;
  target?: string;
  onClose: () => void;
  onOpen: () => void;
  onCorrect: (payload: Record<string, unknown>) => Promise<any>;
  onFeedback?: (segment: Segment) => void;
}) {
  const t = translator(locale),
    copy = editorialCopy[locale];
  const [editing, setEditing] = useState<Segment | null>(null);
  const [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState('');
  const [text, setText] = useState(''),
    [speaker, setSpeaker] = useState(''),
    [basis, setBasis] = useState('');
  const [showAll, setShowAll] = useState(false),
    [atEnd, setAtEnd] = useState(true);
  const [overlay, setOverlay] = useState(() => matchMedia('(max-width: 1099px)').matches);
  const panel = useRef<HTMLElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const refsKey = refs.map((r) => `${r.id}:${r.rev}`).join('|');
  const numbers = sourceNumbers(meeting.segments);
  const latestRevisions = new Map<string, number>();
  for (const segment of meeting.segments)
    latestRevisions.set(segment.id, Math.max(latestRevisions.get(segment.id) ?? 0, segment.rev));
  const segments = resolveSources(meeting.segments, showAll ? [] : refs);
  const previousCount = useRef(segments.length);
  const [unread, setUnread] = useState(0);
  const follow = useRef(true);
  useEffect(() => {
    const query = matchMedia('(max-width: 1099px)');
    const change = () => setOverlay(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    setShowAll(false);
    setUnread(0);
  }, [refsKey]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    panel.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => {
      queueMicrotask(() => {
        if (previous?.isConnected && panel.current?.hidden !== false)
          previous.focus({ preventScroll: true });
      });
    };
  }, [open]);
  useEffect(() => {
    if (!open || !overlay) return;
    const regions = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.meeting-shell > .toolbar, .meeting-shell > .workspace, .meeting-shell > .workspace-meta, .meeting-shell > .version-list',
      ),
    );
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    regions.forEach((region) => {
      region.inert = true;
    });
    return () => {
      document.body.style.overflow = overflow;
      regions.forEach((region) => {
        region.inert = false;
      });
    };
  }, [open, overlay]);
  useLayoutEffect(() => {
    if (!open || !scroll.current) return;
    const active = panel.current?.querySelector<HTMLElement>('[data-cited="true"]');
    if (active)
      scroll.current.scrollTop = Math.max(0, active.offsetTop - scroll.current.offsetTop - 16);
  }, [open, refsKey, showAll]);
  useLayoutEffect(() => {
    if (!open || !scroll.current) return;
    const added = Math.max(0, segments.length - previousCount.current);
    if ((!refs.length || showAll) && added) {
      if (follow.current && !editing && window.getSelection()?.isCollapsed !== false)
        scroll.current.scrollTop = scroll.current.scrollHeight;
      else setUnread((n) => n + added);
    }
    previousCount.current = segments.length;
  }, [segments.length, open, showAll, refs.length, editing]);
  const showLatest = () => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'instant' });
    follow.current = true;
    setAtEnd(true);
    setUnread(0);
  };
  return (
    <>
      {!open && (
        <aside className="source-peek">
          <button className="text-button" onClick={onOpen}>
            <BookOpen size={16} />
            {copy.original}
          </button>
          <p>{copy.peek}</p>
        </aside>
      )}
      {open && overlay && (
        <button
          className="source-backdrop"
          tabIndex={-1}
          aria-label={t('action.close')}
          onClick={onClose}
        />
      )}
      <aside
        ref={panel}
        hidden={!open}
        className="source-panel"
        role="dialog"
        aria-modal={overlay ? true : undefined}
        aria-label={t('sources.open')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab' && overlay) {
            const items = Array.from(
              panel.current!.querySelectorAll<HTMLElement>(
                'button,input,textarea,select,summary,[tabindex="0"]',
              ),
            ).filter(
              (el) => !el.matches(':disabled,[hidden],[inert]') && el.getClientRects().length > 0,
            );
            const first = items[0],
              last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="source-panel-heading">
          <div>
            <h2>
              {refs.length && !showAll ? copy.related : copy.all}
              <span className="source-count">{segments.length}</span>
            </h2>
            {target && (
              <p>
                {copy.checking}: <strong>{target}</strong>
              </p>
            )}
          </div>
          <button className="text-button" aria-label={t('action.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div
          ref={scroll}
          className="source-panel-scroll"
          onScroll={() => {
            const el = scroll.current!;
            const end = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            follow.current = end;
            setAtEnd(end);
            if (end) setUnread(0);
          }}
        >
          {meeting.inputGaps.length > 0 && (
            <details className="source-gaps">
              <summary>
                {t('live.inputGaps')} ({meeting.inputGaps.length})
              </summary>
              {meeting.inputGaps.map((gap, i) => (
                <p key={i}>
                  {new Date(gap.receivedAt).toLocaleTimeString(locale)} · {gap.channel} ·{' '}
                  {errorText(locale, gap.code)}
                </p>
              ))}
            </details>
          )}
          {!segments.length && (
            <p className="muted">{refs.length ? copy.missing : t('emptySources')}</p>
          )}
          {segments.map((s) => {
            const cited = refs.some((r) => r.id === s.id && r.rev === s.rev);
            const stale = (latestRevisions.get(s.id) ?? s.rev) > s.rev;
            return (
              <article
                key={`${s.id}-${s.rev}`}
                className="source-excerpt"
                data-cited={cited || undefined}
                data-source-id={s.id}
                data-source-rev={s.rev}
              >
                <div className="source-stamp">
                  <span className="source-number">[{numbers[s.id]}]</span>
                  <time dateTime={new Date(s.captureStartMs ?? s.receivedAt).toISOString()}>
                    {new Date(s.captureStartMs ?? s.receivedAt).toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <span className="source-speaker">
                    {s.kind === 'request'
                      ? t('sourceKind.request')
                      : s.speaker || t('sources.speakerUnknown')}
                  </span>
                </div>
                <blockquote>{s.text}</blockquote>
                {stale && <p className="stale">{t('sourceStale')}</p>}
                <div className="source-excerpt-actions">
                  {!stale && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setSaveError('');
                        setEditing(s);
                        setText(s.text);
                        setSpeaker(s.speaker || '');
                        setBasis('');
                      }}
                    >
                      {t('correction')}
                    </button>
                  )}
                  {onFeedback && (
                    <button className="text-button" onClick={() => onFeedback(s)}>
                      {copy.feedback}
                    </button>
                  )}
                </div>
                {editing?.id === s.id && editing.rev === s.rev && (
                  <form
                    className="source-correction"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (saving) return;
                      setSaving(true);
                      setSaveError('');
                      try {
                        await onCorrect({
                          segmentId: s.id,
                          baseRevision: s.rev,
                          text,
                          speaker: speaker.trim() || null,
                          basis,
                        });
                        setEditing(null);
                      } catch (error) {
                        setSaveError(error instanceof Error ? error.message : 'INVALID_REQUEST');
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    <label>
                      {t('source.original')}
                      <textarea
                        autoFocus
                        disabled={saving}
                        aria-label={t('source.original')}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      {t('speaker')}
                      <input
                        disabled={saving}
                        value={speaker}
                        onChange={(e) => setSpeaker(e.target.value)}
                      />
                    </label>
                    <label>
                      {t('basis')}
                      <input
                        disabled={saving}
                        value={basis}
                        onChange={(e) => setBasis(e.target.value)}
                        required={!!speaker}
                      />
                    </label>
                    {saveError && (
                      <p role="alert" className="error-text">
                        {errorText(locale, saveError)}
                      </p>
                    )}
                    <button type="submit" disabled={saving}>
                      {t('saveCorrection')}
                    </button>
                  </form>
                )}
                <details className="source-detail">
                  <summary>{copy.details}</summary>
                  <p>
                    {t('sourceKind.' + s.kind)} · {t('revision')} {s.rev}
                    {s.speaker ? ` · ${t('mapping')}` : ''}
                  </p>
                  <TranslationView meeting={meeting} segment={s} locale={locale} />
                </details>
              </article>
            );
          })}
          {refs.length > 0 && (
            <button className="source-all text-button" onClick={() => setShowAll(!showAll)}>
              {showAll ? copy.relatedOnly : copy.seeAll}
              <ArrowRight size={14} />
            </button>
          )}
        </div>
        {(!refs.length || showAll) && (!atEnd || unread > 0) && (
          <div className="source-follow">
            <button onClick={showLatest}>
              <ArrowDown size={14} />
              {copy.latest}
              {unread > 0 ? ` · ${unread}` : ''}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
