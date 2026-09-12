import { PreferenceWriter } from './preference-writer';
import type { PreferencesPatch } from '../domain/preferences';
import { X, Mic, Languages, SlidersHorizontal, BookOpen, Clock3, ChevronRight } from 'lucide-react';
import React, { useEffect, useState, useRef } from 'react';
import type { Snapshot, Meeting, Ref, Segment, Formula, Preferences } from '../contracts/model';
import { translator, errorText } from './i18n';
import { calculate } from '../domain/calculator';
import { api } from './bridge';
export function Modal({
  title,
  close,
  children,
  className = '',
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('button,input,select')?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
          if (e.key === 'Tab') {
            const items = Array.from(
              ref.current!.querySelectorAll<HTMLElement>(
                'button,input,textarea,select,[tabindex="0"]',
              ),
            ).filter(
              (el) => !el.matches(':disabled, [hidden], [inert]') && el.getClientRects().length > 0,
            );
            const first = items[0],
              last = items.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button
            onClick={close}
            aria-label={translator(document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en')(
              'action.close',
            )}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function NewMeeting({
  preferences,
  t,
  configured,
  close,
  start,
  onError,
}: {
  preferences: Preferences;
  t: (s: string) => string;
  configured: boolean;
  close: () => void;
  start: (payload: Record<string, unknown>) => Promise<void>;
  onError: (s: string) => void;
}) {
  const [title, setTitle] = useState(''),
    [mode, setMode] = useState('manual'),
    [output, setOutput] = useState(preferences.defaultOutputLocale),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={t('meeting.start')} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await start({
              title,
              mode,
              outputLocale: output,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          } catch (e) {
            onError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          {t('meeting.title')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={t('meeting.titleOptional')}
          />
        </label>
        <label>
          {t('meeting.source')}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {['manual', 'microphone', 'online', 'replay'].map((m) => (
              <option key={m} value={m}>
                {t(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.outputLanguage')}
          <select value={output} onChange={(e) => setOutput(e.target.value as any)}>
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
          </select>
        </label>
        <p className="privacy">{t('privacy')}</p>
        {mode === 'online' && <p className="privacy">{t('onlineHint')}</p>}
        {!configured && ['microphone', 'online'].includes(mode) && (
          <p className="warning-text">{t('sttMissing')}</p>
        )}
        <button className="primary" disabled={busy}>
          {t('meeting.start')}
        </button>
      </form>
    </Modal>
  );
}
export function Settings({
  preferences,
  setupOnly = false,
  snapshot,
  t,
  close,
  savePatch,
  current,
  changeOutput,
}: {
  preferences: Preferences;
  setupOnly?: boolean;
  snapshot: Snapshot;
  t: (s: string) => string;
  close: () => void;
  savePatch: (p: PreferencesPatch) => Promise<Preferences>;
  current?: Meeting;
  changeOutput: (l: string) => Promise<any>;
}) {
  const [writer] = useState(() => new PreferenceWriter(preferences, savePatch));
  const [, refresh] = useState(0);
  const draft = writer.value;
  const [platform, setPlatform] = useState<any>(null),
    [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]),
    [audioError, setAudioError] = useState('');
  const shortcutTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shortcutDirty = useRef(false),
    shortcutValue = useRef(preferences.shortcut);
  const [shortcut, setShortcut] = useState(preferences.shortcut);
  const [shortcutWaiting, setShortcutWaiting] = useState(false);
  useEffect(() => writer.subscribe(() => refresh((v) => v + 1)), [writer]);
  useEffect(() => writer.receive(preferences), [writer, preferences]);
  useEffect(() => {
    if (!shortcutDirty.current) {
      setShortcut(draft.shortcut);
      shortcutValue.current = draft.shortcut;
    }
  }, [draft.shortcut]);
  useEffect(() => () => clearTimeout(shortcutTimer.current), []);
  const change = (patch: PreferencesPatch) => {
    void writer.change(patch);
  };
  const submitShortcut = () => {
    clearTimeout(shortcutTimer.current);
    setShortcutWaiting(false);
    if (!shortcutDirty.current) return;
    shortcutDirty.current = false;
    change({ shortcut: shortcutValue.current.trim() });
  };
  const finish = async (completeSetup = false) => {
    const alreadyFailed = !!writer.error;
    submitShortcut();
    if (!(await writer.flush()) && !alreadyFailed) return;
    if (completeSetup && setupOnly && !writer.value.audio?.setupCompleted) {
      if (!(await writer.change({ audio: { setupCompleted: true } }))) return;
    }
    close();
  };
  const [activeSection, setActiveSection] = useState('settings-audio');
  const sections = useRef<HTMLDivElement>(null);
  const jumpTo = (id: string) => {
    setActiveSection(id);
    sections.current?.querySelector<HTMLElement>('#' + id)?.scrollIntoView({ block: 'start' });
  };
  useEffect(() => {
    void api('platform').then(setPlatform);
    void api('devices')
      .then(setDevices)
      .catch(() => {});
  }, []);
  return (
    <Modal
      title={t(setupOnly ? 'entry.audioSetup' : 'settings.open')}
      close={() => void finish()}
      className={`settings-modal ${setupOnly ? 'audio-setup-modal' : ''}`}
    >
      <p className="settings-intro">{t(setupOnly ? 'design.setupHint' : 'design.settingsHint')}</p>
      <div className="settings-layout">
        {!setupOnly && (
          <nav className="settings-nav" aria-label={t('settings.open')}>
            <button
              aria-current={activeSection === 'settings-audio' ? 'location' : undefined}
              onClick={() => jumpTo('settings-audio')}
            >
              <Mic size={17} />
              {t('entry.audioSetup')}
            </button>
            <button
              aria-current={activeSection === 'settings-language' ? 'location' : undefined}
              onClick={() => jumpTo('settings-language')}
            >
              <Languages size={17} />
              {t('design.language')}
            </button>
            <button
              aria-current={activeSection === 'settings-experience' ? 'location' : undefined}
              onClick={() => jumpTo('settings-experience')}
            >
              <SlidersHorizontal size={17} />
              {t('design.experience')}
            </button>
          </nav>
        )}
        <div
          className="settings-content"
          ref={sections}
          onScroll={(e) => {
            const top = e.currentTarget.getBoundingClientRect().top;
            const visible = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('section[id]'))
              .filter((el) => el.getBoundingClientRect().top <= top + 100)
              .at(-1);
            if (visible) setActiveSection(visible.id);
          }}
        >
          <section className="settings-section" id="settings-audio">
            <h3>
              <Mic size={18} />
              {t('entry.audioSetup')}
            </h3>
            <label>
              {t('entry.microphone')}
              <select
                value={draft.audio?.deviceId ?? 'default'}
                onChange={(e) =>
                  change({
                    audio: {
                      deviceId: e.target.value,
                      deviceLabel: devices.find((d) => d.deviceId === e.target.value)?.label ?? '',
                      setupCompleted: true,
                    },
                  })
                }
              >
                <option value="default">{t('entry.defaultMic')}</option>
                {draft.audio?.deviceId &&
                  draft.audio.deviceId !== 'default' &&
                  !devices.some((d) => d.deviceId === draft.audio!.deviceId) && (
                    <option value={draft.audio.deviceId}>
                      {draft.audio.deviceLabel} · {t('entry.unavailable')}
                    </option>
                  )}
                {devices
                  .filter((d) => d.deviceId && d.deviceId !== 'default')
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || t('entry.microphone') + ' ' + (i + 1)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.audio?.includeComputerAudio ?? false}
                onChange={(e) =>
                  change({
                    audio: { includeComputerAudio: e.target.checked, setupCompleted: true },
                  })
                }
              />
              {t('entry.computerAudio')}
            </label>
            <p className="privacy">{t('entry.audioPrivacy')}</p>
            {audioError && <p role="alert">{errorText(preferences.uiLocale, audioError)}</p>}
            {!snapshot.capabilities.sttConfigured && (
              <p className="warning-text">{t('sttMissing')}</p>
            )}
            {current?.status === 'active' && (
              <>
                <p className="muted">
                  {t('entry.currentDevice')}: {current.actualDevice?.label || t('entry.defaultMic')}
                </p>
                <button
                  disabled={writer.busy || shortcutWaiting}
                  onClick={async () => {
                    try {
                      submitShortcut();
                      if (!(await writer.flush())) return;
                      await api('applyAudioSettings');
                      close();
                    } catch (e) {
                      setAudioError((e as Error).message);
                    }
                  }}
                >
                  {t('entry.applyCurrent')}
                </button>
              </>
            )}
          </section>
          {!setupOnly && (
            <>
              <section className="settings-section" id="settings-language">
                <h3>
                  <Languages size={18} />
                  {t('design.language')}
                </h3>
                <label>
                  {t('settings.interfaceLanguage')}
                  <select
                    aria-label={t('settings.interfaceLanguage')}
                    value={draft.uiLanguage ?? draft.uiLocale}
                    aria-describedby="interface-language-hint"
                    aria-busy={writer.busy}
                    aria-disabled={writer.busy || shortcutWaiting}
                    onChange={(e) =>
                      change({
                        uiLanguage: e.target.value as NonNullable<Preferences['uiLanguage']>,
                      })
                    }
                  >
                    <option value="system">{t('entry.system')}</option>
                    <option value="en">English</option>
                    <option value="zh-CN">简体中文</option>
                  </select>
                </label>
                <p id="interface-language-hint" className="settings-field-hint" role="status">
                  {t('design.languageImmediate')}
                </p>
                <label>
                  {t('settings.defaultOutputLanguage')}
                  <select
                    aria-label={t('settings.defaultOutputLanguage')}
                    value={draft.defaultOutputLanguage ?? draft.defaultOutputLocale}
                    onChange={(e) => change({ defaultOutputLanguage: e.target.value as any })}
                  >
                    <option value="system">{t('entry.system')}</option>
                    <option value="en">English</option>
                    <option value="zh-CN">简体中文</option>
                  </select>
                </label>
                {current && (
                  <label>
                    {t('settings.outputLanguage')}
                    <select
                      value={current.outputLocale}
                      onChange={(e) => {
                        setAudioError('');
                        void changeOutput(e.target.value).catch((error) =>
                          setAudioError(error.message),
                        );
                      }}
                    >
                      <option value="en">English</option>
                      <option value="zh-CN">简体中文</option>
                    </select>
                  </label>
                )}
              </section>
              <section className="settings-section" id="settings-experience">
                <h3>
                  <SlidersHorizontal size={18} />
                  {t('design.experience')}
                </h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.launcherVisible ?? true}
                    onChange={(e) => change({ launcherVisible: e.target.checked })}
                  />
                  {t('settings.launcherVisible')}
                </label>
                <small>{t('settings.launcherHelp')}</small>
                {snapshot.notificationUnavailable && (
                  <p className="muted">{t('settings.notificationUnavailable')}</p>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.meetingReminders ?? true}
                    onChange={(e) => change({ meetingReminders: e.target.checked })}
                  />
                  {t('settings.meetingReminders')}
                </label>
                <small>{t('settings.reminderHelp')}</small>
                <label className="check">
                  <input
                    type="checkbox"
                    name="reduceMotion"
                    checked={draft.reduceMotion}
                    onChange={(e) => change({ reduceMotion: e.target.checked })}
                  />
                  {t('settings.reduceMotion')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.reduceTransparency}
                    onChange={(e) => change({ reduceTransparency: e.target.checked })}
                  />
                  {t('settings.reduceTransparency')}
                </label>
                <label>
                  {t('shortcut')}
                  <input
                    value={shortcut}
                    onChange={(e) => {
                      const value = e.target.value;
                      setShortcut(value);
                      shortcutValue.current = value;
                      shortcutDirty.current = true;
                      setShortcutWaiting(true);
                      clearTimeout(shortcutTimer.current);
                      shortcutTimer.current = setTimeout(submitShortcut, 500);
                    }}
                    onBlur={submitShortcut}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        submitShortcut();
                      }
                    }}
                  />
                </label>
                <small>{t('shortcutHelp')}</small>
              </section>
              <details className="settings-diagnostics selectable-text">
                <summary>{t('live.processingDetails')}</summary>
                <section className="settings-section">
                  <h3>{t('provider')}</h3>
                  <p>{t('providerHelp')}</p>
                  <p className="muted">
                    {snapshot.capabilities.model} · {snapshot.capabilities.modelHost}
                    <br />
                    {snapshot.capabilities.sttHost}
                  </p>
                </section>
                {platform && (
                  <section className="settings-section">
                    <h3>{t('platform')}</h3>
                    <p>
                      {platform.os} · {platform.release}
                      <br />
                      {platform.audioRoute}
                    </p>
                    <small>{t('noPermission')}</small>
                  </section>
                )}
              </details>
            </>
          )}
        </div>
      </div>
      <div className="settings-footer">
        <div role="status" className="settings-save-status">
          {writer.error ? (
            <span className="error-text" role="alert">
              {errorText(preferences.uiLocale, writer.error)}{' '}
              <button className="text-button" onClick={() => void writer.retry()}>
                {t('action.retry')}
              </button>
            </span>
          ) : (
            <span>
              {t(writer.busy || shortcutWaiting ? 'settings.saving' : 'settings.autoSaved')}
            </span>
          )}
        </div>
        <button
          className="primary"
          disabled={writer.busy || shortcutWaiting}
          onClick={() => void finish(true)}
        >
          {t('settings.done')}
        </button>
      </div>
    </Modal>
  );
}
export function SourceDrawer({
  meeting,
  refs,
  locale,
  open = true,
  target = '',
  onClose,
  onCorrect,
}: {
  meeting: Meeting;
  refs: Ref[];
  open?: boolean;
  target?: string;
  locale: 'en' | 'zh-CN';
  onClose: () => void;
  onCorrect: (payload: Record<string, unknown>) => Promise<any>;
}) {
  const t = translator(locale),
    [editing, setEditing] = useState<Segment | null>(null),
    [text, setText] = useState(''),
    [speaker, setSpeaker] = useState(''),
    [basis, setBasis] = useState('');
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    drawer.current?.querySelector<HTMLElement>('button')?.focus();
    return () => previous?.focus();
  }, [open]);
  const segments = refs.length
    ? meeting.segments.filter((s) => refs.some((r) => s.id === r.id && s.rev === r.rev))
    : meeting.segments.filter((s) => !meeting.segments.some((n) => n.id === s.id && n.rev > s.rev));
  return (
    <aside
      ref={drawer}
      hidden={!open}
      className="source-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={t('sources.open')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
        if (e.key === 'Tab') {
          const items = Array.from(
            drawer.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,textarea,select,summary,[tabindex="0"]',
            ),
          );
          const first = items[0],
            last = items.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="modal-title">
        <h2>
          <BookOpen size={20} />
          {t('sources')}
        </h2>
        <button onClick={onClose} aria-label={t('action.close')}>
          <X size={18} />
        </button>
      </div>
      {target && (
        <div className="source-target">
          <small>{t('design.checking')}</small>
          <strong>{target}</strong>
        </div>
      )}
      <p className="drawer-intro">{t('design.sourcesHint')}</p>
      {meeting.inputGaps.length > 0 && (
        <details>
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
      {!segments.length && <p>{t('emptySources')}</p>}
      {segments.map((s) => (
        <article className="source-card" key={`${s.id}-${s.rev}`}>
          <div className="eyebrow">
            <Clock3 size={13} />
            {new Date(s.captureStartMs ?? s.receivedAt).toLocaleTimeString(locale)}
            <span>·</span>
            {t('sourceKind.' + s.kind)}
          </div>
          <p className="muted">
            {s.speaker || t('sources.speakerUnknown')}
            {s.speaker && <span> · {t('mapping')}</span>}
          </p>
          <div className="source-original-label">{t('source.original')}</div>
          <blockquote>{s.text}</blockquote>
          <small>
            {t('revision')} {s.rev}
          </small>
          <TranslationView meeting={meeting} segment={s} locale={locale} />
          {meeting.segments.some((n) => n.id === s.id && n.rev > s.rev) ? (
            <p className="stale">{t('sourceStale')}</p>
          ) : (
            <button
              className="source-link"
              onClick={() => {
                setEditing(s);
                setText(s.text);
                setSpeaker(s.speaker || '');
                setBasis('');
              }}
            >
              {t('correction')}
            </button>
          )}
          {editing?.id === s.id && editing.rev === s.rev && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await onCorrect({
                  segmentId: s.id,
                  baseRevision: s.rev,
                  text,
                  speaker: speaker.trim() || null,
                  basis,
                });
                if (result !== undefined) setEditing(null);
              }}
            >
              <label>
                {t('source.original')}
                <textarea
                  aria-label={t('source.original')}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                />
              </label>
              <label>
                {t('speaker')}
                <input value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
              </label>
              <label>
                {t('basis')}
                <input
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                  required={!!speaker}
                />
              </label>
              <button type="submit">{t('saveCorrection')}</button>
            </form>
          )}
        </article>
      ))}
    </aside>
  );
}
function TranslationView({
  meeting,
  segment,
  locale,
}: {
  meeting: Meeting;
  segment: Segment;
  locale: 'en' | 'zh-CN';
}) {
  const t = translator(locale),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const translated = meeting.translations?.find(
    (v) => v.segmentId === segment.id && v.sourceRev === segment.rev && v.targetLocale === locale,
  );
  return (
    <div>
      <button
        className="source-link"
        disabled={busy}
        onClick={async () => {
          if (translated) {
            setOpen(!open);
            return;
          }
          setBusy(true);
          try {
            await api('translate', {
              meetingId: meeting.id,
              segmentId: segment.id,
              revision: segment.rev,
              targetLocale: locale,
            });
            setOpen(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('sources.showTranslation')}
      </button>
      {open && translated && (
        <div className="translated">
          <small>
            {t('sources.translation')} · {locale}
          </small>
          <p>{translated.text}</p>
        </div>
      )}
      {error && <p className="error-text">{errorText(locale, error)}</p>}
    </div>
  );
}
export function ScenarioEditor({
  formula,
  locale,
  onSave,
  onDirty,
}: {
  formula: Formula;
  locale: 'en' | 'zh-CN';
  onSave: (values: Record<string, number | null>) => Promise<any>;
  onDirty?: () => void;
}) {
  const t = translator(locale),
    base = () => Object.fromEntries(formula.parameters.map((p) => [p.id, p.value]));
  const [values, setValues] = useState<Record<string, number | null>>(base),
    [result, setResult] = useState<string | null | undefined>(),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  return (
    <section className="scenario-editor">
      <div className="eyebrow">{t('scenario')}</div>
      <h2>{formula.label}</h2>
      <p>
        {t('formulaBasis')}: {formula.basis}
      </p>
      <code>
        {formula.steps
          .map(
            (s) =>
              `${s.id} = ${s.left} ${{ add: '+', subtract: '−', multiply: '×', divide: '÷' }[s.op]} ${s.right}`,
          )
          .join('; ')}
      </code>
      <div className="parameters">
        {formula.parameters.map((p) => (
          <label key={p.id}>
            {p.label} ({p.unit})
            <input
              type="number"
              min={p.min}
              max={p.max}
              step="any"
              value={values[p.id] ?? ''}
              onChange={(e) => {
                onDirty?.();
                setValues({
                  ...values,
                  [p.id]: e.target.value === '' ? null : Number(e.target.value),
                });
                setResult(undefined);
                setSaved(false);
              }}
            />
          </label>
        ))}
      </div>
      <div className="button-row">
        <button
          onClick={() => {
            try {
              setResult(calculate(formula, values));
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {t('calculate')}
        </button>
        <button
          onClick={() => {
            setValues(base());
            setResult(undefined);
            setSaved(false);
          }}
        >
          {t('reset')}
        </button>
      </div>
      {error && <p role="alert">{errorText(locale, error)}</p>}
      {result !== undefined && (
        <div className="calculation-result">
          <strong>
            {result === null ? t('unknownResult') : `${t('result')}: ${result} ${formula.unit}`}
          </strong>
          <button
            disabled={saved}
            onClick={async () => {
              const outcome = await onSave(values);
              if (outcome) setSaved(true);
            }}
          >
            {t(saved ? 'status.saved' : 'saveScenario')}
          </button>
        </div>
      )}
    </section>
  );
}
export function DecisionModal({
  scope,
  meeting,
  t,
  close,
  save,
}: {
  scope: 'personal' | 'meeting';
  meeting: Meeting;
  t: (s: string) => string;
  close: () => void;
  save: (p: Record<string, unknown>) => Promise<any>;
}) {
  const [basis, setBasis] = useState(''),
    [participants, setParticipants] = useState(''),
    [sourceIds, setSourceIds] = useState<string[]>([]);
  return (
    <Modal title={t(scope === 'personal' ? 'personal' : 'meetingScope')} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({ basis, participants, sourceIds });
        }}
      >
        <p>{t('confirmScope')}</p>
        <label>
          {t('basis')}
          <textarea required value={basis} onChange={(e) => setBasis(e.target.value)} />
        </label>
        {scope === 'meeting' && (
          <>
            <label>
              {t('participants')}
              <input
                required
                value={participants}
                onChange={(e) => setParticipants(e.target.value)}
              />
            </label>
            <p>{t('evidence')}</p>
            <div className="evidence-list">
              {meeting.segments
                .filter(
                  (s) =>
                    s.kind !== 'request' &&
                    !meeting.segments.some((n) => n.id === s.id && n.rev > s.rev),
                )
                .map((s) => (
                  <label key={s.id} className="check">
                    <input
                      type="checkbox"
                      checked={sourceIds.includes(s.id)}
                      onChange={(e) =>
                        setSourceIds(
                          e.target.checked
                            ? [...sourceIds, s.id]
                            : sourceIds.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.text}
                  </label>
                ))}
            </div>
          </>
        )}
        <button className="primary" disabled={scope === 'meeting' && !sourceIds.length}>
          {t('recordDecision')}
        </button>
      </form>
    </Modal>
  );
}
