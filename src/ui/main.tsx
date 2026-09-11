import launcherArtwork from './assets/launcher-dialogue-v1.png';
import { launcherIndicator } from './launcher-status';
import {
  AudioLines,
  ArrowLeft,
  ArrowUpRight,
  ArrowRight,
  Settings2,
  X,
  Mic,
  FileText,
  Clock3,
  Pause,
  Play,
  Square,
  BookOpen,
  History,
  Download,
  MessageSquare,
  Sparkles,
  ChevronRight,
  Bookmark,
  Check,
  Search,
  ListFilter,
  ListTree,
} from 'lucide-react';
import { applyTheme } from './theme';
import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  Snapshot,
  Meeting,
  Ref,
  Segment,
  ArtifactRevision,
  Formula,
  Command,
  Preferences,
} from '../contracts/model';
import { translator, errorText } from './i18n';
import { ArtifactView } from '../renderers/ArtifactView';
import { calculate } from '../domain/calculator';
import './style.css';
import { api } from './bridge';
import { useLiveArtifact, ScenarioShelf } from './live';
import { artifactIsStale } from '../domain/artifacts';
import {
  Modal,
  NewMeeting,
  Settings,
  SourceDrawer,
  ScenarioEditor,
  DecisionModal,
} from './components';

applyTheme();
const role = new URLSearchParams(location.search).get('role') || 'workspace';
document.documentElement.dataset.role = role;
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [newMeeting, setNewMeeting] = useState(false),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(''),
    [serviceError, setServiceError] = useState(false);
  const [sourceRefs, setSourceRefs] = useState<Ref[] | null>(null),
    [history, setHistory] = useState(false),
    [view, setView] = useState<{ id: string; rev: number } | null>(null),
    [showInput, setShowInput] = useState(false),
    [decisionScope, setDecisionScope] = useState<'personal' | 'meeting' | null>(null);
  const [ask, setAsk] = useState(''),
    [sourceText, setSourceText] = useState(''),
    [sending, setSending] = useState(false),
    [starting, setStarting] = useState(false),
    [askOpen, setAskOpen] = useState(false),
    [askContext, setAskContext] = useState<{ artifactId: string; artifactRev: number } | null>(
      null,
    ),
    [renaming, setRenaming] = useState(false),
    [titleDraft, setTitleDraft] = useState('');
  const [audioSetup, setAudioSetup] = useState(false);
  const showSettings = () => {
    setAudioSetup(false);
    setSettings(true);
  };
  const [meetingFilter, setMeetingFilter] = useState<'all' | 'active' | 'ended'>('all');
  const [search, setSearch] = useState('');
  const [sourceTarget, setSourceTarget] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineSelection, setOutlineSelection] = useState('');
  const openSources = (refs: Ref[], target = '') => {
    setSourceRefs(refs);
    setSourceTarget(target);
  };
  const startRequest = useRef<string | null>(null);
  const current = snapshot?.meetings.find((m) => m.id === selected),
    locale = snapshot?.preferences.uiLocale || 'en',
    t = translator(locale);
  const latest =
    current?.artifacts.filter((a) => (a.scope ?? 'meeting') === 'meeting').at(-1) ??
    current?.artifacts.at(-1);
  const requested = view
    ? current?.artifacts.find((a) => a.id === view.id && a.rev === view.rev)
    : latest;
  const { artifact } = useLiveArtifact(requested);
  const personal =
    current?.artifacts.filter(
      (a) =>
        a.scope === 'personal' && !current.artifacts.some((b) => b.id === a.id && b.rev > a.rev),
    ) ?? [];
  const act = async (fn: () => Promise<any>) => {
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'INVALID_REQUEST');
    }
  };
  const command = (
    type: Command['type'],
    payload: Record<string, unknown> = {},
    meetingId = current?.id ?? null,
  ) => api('command', { id: crypto.randomUUID(), meetingId, type, payload });
  useEffect(() => {
    const update = (value: any) => {
      if (value.serviceError) {
        setServiceError(true);
        return;
      }
      setServiceError(false);
      setSnapshot(value);
      if (value.selectMeetingId) setSelected(value.selectMeetingId);
      if (value.openSettings) showSettings();
    };
    const off = window.meeting.subscribe(update);
    let canceled = false;
    const read = () =>
      api('snapshot')
        .then((v) => {
          if (!canceled) update(v);
        })
        .catch(() => {
          if (!canceled) setTimeout(read, 500);
        });
    read();
    return () => {
      canceled = true;
      off();
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.body.dataset.role = role;
    document.documentElement.classList.toggle(
      'reduce-transparency',
      snapshot?.preferences.reduceTransparency ?? false,
    );
    document.documentElement.classList.toggle(
      'reduce-motion',
      snapshot?.preferences.reduceMotion ?? false,
    );
  }, [locale, snapshot?.preferences.reduceTransparency, snapshot?.preferences.reduceMotion]);

  const openMeeting = (m: Meeting) => {
    setSelected(m.id);
    setView(null);
    setSourceRefs(null);
    setHistory(false);
    setOutlineSelection('');
    setShowInput(false);
    setAsk('');
    setAskOpen(false);
    setAskContext(null);
    setSourceText('');
  };
  const active = snapshot?.meetings.find((m) => m.status === 'active');
  const indicator = launcherIndicator(active, serviceError);
  const captureLabel = t(indicator.labelKey);
  const launcherLabel = [
    captureLabel,
    active?.error
      ? errorText(locale, active.error)
      : active?.processing === 'working'
        ? t('processing.active')
        : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const filteredMeetings =
    snapshot?.meetings.filter(
      (m) =>
        (meetingFilter === 'all' || m.status === meetingFilter) &&
        m.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ) ?? [];
  const drag = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  if (role === 'launcher')
    return (
      <button
        className="launcher"
        aria-label={`${t('launcher.label')} · ${launcherLabel}`}
        title={launcherLabel}
        data-state={indicator.state}
        onMouseEnter={() => void api('hover', true)}
        onMouseLeave={() => void api('hover', false)}
        onContextMenu={(e) => {
          e.preventDefault();
          void api('menu');
        }}
        onKeyDown={(e) => {
          if (e.key === 'F10' && e.shiftKey) {
            e.preventDefault();
            void api('menu');
          }
        }}
        onPointerDown={(e) => {
          if (e.button === 0) {
            drag.current = { x: e.screenX, y: e.screenY, dragged: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (
            drag.current &&
            Math.hypot(e.screenX - drag.current.x, e.screenY - drag.current.y) > 6
          ) {
            drag.current.dragged = true;
            void api('drag');
          }
        }}
        onPointerUp={() => {
          if (drag.current?.dragged) void api('snap');
        }}
        onClick={() => {
          if (!drag.current?.dragged) void api('open');
          drag.current = null;
        }}
      >
        <span className="launcher-artwork" aria-hidden="true">
          <img src={launcherArtwork} alt="" draggable={false} />
        </span>
        <span className={`launcher-indicator ${indicator.state}`} aria-hidden="true">
          {indicator.state === 'paused' ? (
            <Pause size={7} strokeWidth={3} />
          ) : indicator.state === 'error' ? (
            <span className="indicator-error-mark">!</span>
          ) : null}
        </span>
      </button>
    );
  if (role === 'preview')
    return (
      <div
        className="preview"
        onMouseEnter={() => void api('hover', true)}
        onMouseLeave={() => void api('hover', false)}
      >
        <div className="eyebrow">
          Agents, Everywhere{' '}
          <span className={`status launcher-status-${indicator.state}`}>{captureLabel}</span>
        </div>
        <h2>{active?.focus || active?.title || t('emptyLibrary')}</h2>
        {active?.changes.slice(0, 3).map((s, i) => (
          <p key={i}>{s}</p>
        ))}
        {(active?.captureError || active?.error || serviceError) && (
          <p className="error-text">
            {serviceError
              ? t('serviceError')
              : errorText(locale, active!.captureError || active!.error!)}
          </p>
        )}
        <button onClick={() => void api('open')}>{t('preview.open')} ↗</button>
      </div>
    );
  if (!snapshot)
    return (
      <main>
        <p>Meeting Agent</p>
      </main>
    );
  const startMeeting = async () => {
    if (starting) return;
    if (active) {
      openMeeting(active);
      return;
    }
    setStarting(true);
    startRequest.current ??= crypto.randomUUID();
    try {
      const result = await api('startMeeting', { requestId: startRequest.current });
      if (result.state === 'needs_setup') {
        setAudioSetup(true);
        setSettings(true);
        if (result.reason !== 'AUDIO_SETUP_REQUIRED') setError(result.reason);
      } else if (result.meetingId) {
        setSelected(result.meetingId);
        setView(null);
        setAskOpen(false);
        setAskContext(null);
        startRequest.current = null;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const submitAsk = async () => {
    if (!ask.trim() || sending) return;
    setSending(true);
    try {
      await command('ask', { text: ask, ...(askContext ? { context: askContext } : {}) });
      setAsk('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div
      className={`app-shell ${current ? 'meeting-shell' : 'home-shell'} ${sourceRefs !== null ? 'has-source' : ''}`}
    >
      <header className="toolbar">
        {current ? (
          <>
            <button
              className="text-button back-button"
              onClick={() => {
                setSelected(null);
                setView(null);
                setSourceRefs(null);
              }}
            >
              <ArrowLeft size={17} />
              {t('navigation.meetings')}
            </button>
            <span className="toolbar-divider" />
          </>
        ) : (
          <div className="brand">
            <span className="brand-mark">
              <AudioLines size={20} />
            </span>
            <span>Agents, Everywhere</span>
          </div>
        )}
        {current ? (
          <button
            className="text-button meeting-name"
            onClick={() => {
              setTitleDraft(current.title);
              setRenaming(true);
            }}
          >
            {current.title}
          </button>
        ) : (
          <span className="brand-subtitle">{t('design.personalWorkspace')}</span>
        )}
        {current && (
          <span className={`status status-${current.capture}`}>
            <i className={`dot ${current.capture}`} />
            {t('status.' + current.capture)}
          </span>
        )}
        <div className="toolbar-actions">
          <button
            className="text-button"
            aria-label={t('settings.open')}
            title={t('settings.open')}
            onClick={showSettings}
          >
            <Settings2 size={19} />
          </button>
          {current?.status === 'active' && (
            <>
              {['microphone', 'online'].includes(current.mode) && (
                <button
                  disabled={current.capture === 'starting'}
                  onClick={() =>
                    void act(() =>
                      api('capture', {
                        action: current.capture === 'capturing' ? 'pause' : 'start',
                        meetingId: current.id,
                      }),
                    )
                  }
                >
                  {current.capture === 'capturing' ? <Pause size={15} /> : <Play size={15} />}
                  {t(current.capture === 'capturing' ? 'capture.pause' : 'record')}
                </button>
              )}
              <button className="danger" onClick={() => void act(() => command('end'))}>
                <Square size={13} />
                {t('meeting.end')}
              </button>
            </>
          )}
          <button
            aria-label={t('action.close')}
            title={t('action.close')}
            className="text-button"
            onClick={() => void api('hide')}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      {serviceError && (
        <div role="alert" className="banner error">
          {t('serviceError')}
        </div>
      )}
      {(error || snapshot.storageError) && (
        <div role="alert" className="banner error">
          {errorText(locale, error || snapshot.storageError!)}
          <button onClick={() => setError('')}>{t('dismiss')}</button>
        </div>
      )}
      {!current ? (
        <main className="library">
          <section className="home-hero">
            <div className="hero-kicker">
              <AudioLines size={18} />
              <span>{t('design.homeKicker')}</span>
            </div>
            <h1>{t('welcome')}</h1>
            <p className="lead">{t('welcomeBody')}</p>
            <div className="start-row">
              <button
                className="primary start-button"
                disabled={starting}
                onClick={() => void startMeeting()}
              >
                <Play size={17} fill="currentColor" />
                {t(starting ? 'status.starting' : active ? 'meeting.open' : 'meeting.start')}
                <ArrowRight size={18} />
              </button>
              <div className="device-summary">
                <div>
                  <Mic size={15} />
                  <span>{snapshot.preferences.audio?.deviceLabel || t('entry.defaultMic')}</span>
                </div>
                <button className="source-link" onClick={showSettings}>
                  {t(
                    snapshot.preferences.audio?.includeComputerAudio
                      ? 'entry.withComputer'
                      : 'entry.microphoneOnly',
                  )}
                  <span aria-hidden="true">·</span>
                  {t('entry.change')}
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
            <p className="hero-footnote">{t('design.startHint')}</p>
          </section>
          {snapshot.capabilities.developerInputs && (
            <details>
              <summary>{t('entry.development')}</summary>
              <button onClick={() => setNewMeeting(true)}>{t('entry.testInput')}</button>
            </details>
          )}
          {!snapshot.capabilities.modelConfigured && (
            <div className="setup-note">
              <strong>{t('setup')}</strong>
              <p>{t('setupBody')}</p>
              <button className="source-link" onClick={showSettings}>
                {t('provider')} ↗
              </button>
            </div>
          )}
          <section className="recent-meetings">
            <div className="recent-heading">
              <h2>{t('meeting.recent')}</h2>
              <span>{t('design.recentHint')}</span>
            </div>
            {snapshot.meetings.length > 0 && (
              <div className="library-tools">
                <nav className="view-tabs" aria-label={t('design.filterMeetings')}>
                  {(['all', 'active', 'ended'] as const).map((filter) => (
                    <button
                      key={filter}
                      aria-pressed={meetingFilter === filter}
                      onClick={() => setMeetingFilter(filter)}
                    >
                      {t('design.filter.' + filter)}
                    </button>
                  ))}
                </nav>
                <label className="search-field">
                  <Search size={15} />
                  <input
                    aria-label={t('design.searchMeetings')}
                    placeholder={t('design.searchMeetings')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button aria-label={t('design.clearSearch')} onClick={() => setSearch('')}>
                      <X size={13} />
                    </button>
                  )}
                </label>
              </div>
            )}

            {snapshot.meetings.length === 0 ? (
              <div className="library-empty">
                <span className="quiet-icon">
                  <FileText size={23} />
                </span>
                <div>
                  <strong>{t('emptyLibrary')}</strong>
                  <p>{t('design.emptyHint')}</p>
                </div>
              </div>
            ) : (
              <div className="meeting-list">
                {filteredMeetings.length === 0 && (
                  <div className="no-results">
                    <Search size={22} />
                    <p>{t('design.noResults')}</p>
                    <button
                      className="source-link"
                      onClick={() => {
                        setSearch('');
                        setMeetingFilter('all');
                      }}
                    >
                      {t('design.clearFilters')}
                    </button>
                  </div>
                )}
                {filteredMeetings.map((m) => (
                  <button className="meeting-row" key={m.id} onClick={() => openMeeting(m)}>
                    <span className={`meeting-file ${m.status === 'active' ? 'is-active' : ''}`}>
                      <FileText size={21} />
                    </span>
                    <div className="meeting-row-content">
                      <strong>{m.title}</strong>
                      <p>
                        <Clock3 size={13} />
                        {new Date(m.createdAt).toLocaleString(locale, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        <span>·</span>
                        {t(m.mode)}
                      </p>
                    </div>
                    <span className={`status status-${m.capture}`}>
                      <i className={`dot ${m.capture}`} />
                      {t('status.' + m.capture)}
                    </span>
                    <ChevronRight className="row-chevron" size={17} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>
      ) : (
        <>
          <div className="workspace-meta">
            <nav className="view-tabs" aria-label={t('working')}>
              <button
                aria-pressed={!history && sourceRefs === null}
                onClick={() => {
                  setHistory(false);
                  setSourceRefs(null);
                }}
              >
                <FileText size={15} />
                {t('design.workContent')}
              </button>
              <button aria-pressed={sourceRefs !== null} onClick={() => openSources([])}>
                <BookOpen size={15} />
                {t('sources.open')}
              </button>
              <button aria-pressed={history} onClick={() => setHistory(!history)}>
                <History size={15} />
                {t('history')}
              </button>
            </nav>
            <div className="meta-actions">
              {artifact && (
                <button
                  className="text-button"
                  aria-pressed={outlineOpen}
                  onClick={() => setOutlineOpen(!outlineOpen)}
                >
                  <ListTree size={15} />
                  {t('design.outline')}
                </button>
              )}
              <button
                className="text-button"
                onClick={() => void act(() => api('export', { meetingId: current.id }))}
              >
                <Download size={15} />
                {t('action.export')}
              </button>
            </div>
          </div>
          {(current.error || current.captureError) && (
            <div className="banner warning" role="status">
              {errorText(locale, current.captureError || current.error!)}
              <button
                onClick={() =>
                  void act(() =>
                    current.captureError
                      ? api('capture', { action: 'start', meetingId: current.id })
                      : command('retry'),
                  )
                }
              >
                {t('action.retry')}
              </button>
            </div>
          )}
          {history && (
            <nav className="version-list" aria-label={t('history')}>
              {!current.artifacts.length && <p className="muted">{t('design.noVersions')}</p>}
              {current.artifacts
                .slice()
                .reverse()
                .map((a) => (
                  <button
                    key={`${a.id}-${a.rev}`}
                    aria-pressed={view?.id === a.id && view?.rev === a.rev}
                    onClick={() => setView({ id: a.id, rev: a.rev })}
                  >
                    {a.question} · {t('revision')} {a.rev} · {a.locale}
                  </button>
                ))}
            </nav>
          )}
          <main className="workspace">
            <div className="document-meta">
              <span>
                {new Date(current.createdAt).toLocaleDateString(locale, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <span>
                {t(
                  current.status === 'ended'
                    ? 'design.closedContext'
                    : current.processing === 'working'
                      ? 'processing.active'
                      : current.segments.length
                        ? 'design.receivedContext'
                        : 'design.waitingContext',
                )}
              </span>
              {current.lastExpressionAt && (
                <span>
                  {t('design.updated')}{' '}
                  {new Date(current.lastExpressionAt).toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
            {outlineOpen && artifact && (
              <nav className="document-outline" aria-label={t('design.outline')}>
                <span>{t('design.outline')}</span>
                {artifact.blocks.map((block) => (
                  <button
                    className="text-button"
                    key={block.id}
                    aria-current={outlineSelection === block.id ? 'location' : undefined}
                    onClick={() => {
                      setOutlineSelection(block.id);
                      const node = document.getElementById('block-' + block.id);
                      node?.scrollIntoView({ block: 'start', behavior: 'instant' });
                      node?.focus({ preventScroll: true });
                    }}
                  >
                    {block.title}
                  </button>
                ))}
              </nav>
            )}
            {(current.audioPending ?? 0) > 1 && (
              <p className="muted" role="status">
                {t('live.audioPending')}: {current.audioPending}
              </p>
            )}
            {current.expressionStatus === 'working' && (
              <p className="muted" role="status">
                {t('live.preparing')}
              </p>
            )}
            {personal.length > 0 && (
              <nav className="personal-work" aria-label={t('live.personal')}>
                <span>{t('live.personal')}</span>
                {personal.map((a) => (
                  <button key={a.id} onClick={() => setView({ id: a.id, rev: a.rev })}>
                    {a.question}
                  </button>
                ))}
              </nav>
            )}
            {view && latest && (
              <div className="update-notice">
                {t('design.viewingHistory')}
                <button onClick={() => setView(null)}>{t('artifact.applyUpdates')}</button>
              </div>
            )}
            {artifact ? (
              <>
                <div className="eyebrow">
                  <span className="focus-label">
                    <Sparkles size={14} />
                    {artifact.scope === 'personal'
                      ? t('live.personal')
                      : current.status === 'ended'
                        ? t('design.savedView')
                        : view
                          ? t('live.history')
                          : t('focus')}
                  </span>
                  {artifactIsStale(artifact, current) && (
                    <span className="stale"> · {t('artifact.stale')}</span>
                  )}
                </div>
                <h1 className="focus-title">{artifact.question}</h1>
                <p className="lead focus-summary">{artifact.summary}</p>
                {artifact.scope === 'personal' && (
                  <p className="scope-note">{t('design.personalNote')}</p>
                )}
                <ArtifactView
                  artifact={artifact}
                  locale={locale}
                  onSources={openSources}
                  selectedSources={sourceRefs}
                  selectedTarget={sourceTarget}
                  onAction={(prompt) => void act(() => command('ask', { text: prompt }))}
                />
                <ScenarioShelf
                  key={current.id}
                  artifact={artifact}
                  locale={locale}
                  onSave={(base, formula, values) =>
                    act(() =>
                      command('scenario', {
                        artifactId: base.id,
                        artifactRev: base.rev,
                        formulaId: formula.id,
                        values,
                      }),
                    )
                  }
                />
                <div className="artifact-actions">
                  <button onClick={() => setDecisionScope('personal')}>
                    <Bookmark size={15} />
                    {t('action.savePersonal')}
                  </button>
                  <button className="text-button" onClick={() => setDecisionScope('meeting')}>
                    <Check size={15} />
                    {t('action.recordDecision')}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-work">
                <span className="empty-symbol">
                  <AudioLines size={30} />
                </span>
                <h1>{current.focus || t('design.emptyTitle')}</h1>
                <p>
                  {snapshot.capabilities.modelConfigured
                    ? t(
                        current.capture === 'capturing'
                          ? 'entry.listeningEmpty'
                          : current.capture === 'stopped'
                            ? 'design.endedEmpty'
                            : 'design.waitingEmpty',
                      )
                    : t('awaiting')}
                </p>
                {!snapshot.capabilities.modelConfigured && (
                  <button onClick={showSettings}>{t('provider')}</button>
                )}
              </div>
            )}
            {current.status === 'active' && artifact && (
              <div className="explore-entry">
                <button
                  className="explore-toggle"
                  onClick={() => {
                    if (!askOpen && !ask.trim())
                      setAskContext({ artifactId: artifact.id, artifactRev: artifact.rev });
                    setAskOpen(!askOpen);
                  }}
                >
                  <MessageSquare size={17} />
                  {t(askOpen ? 'entry.closeExplore' : 'entry.explore')}
                  <ChevronRight size={15} className={askOpen ? 'rotated' : ''} />
                </button>
              </div>
            )}
            {current.status === 'active' && artifact && askOpen && (
              <form
                className="ask-bar"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitAsk();
                }}
              >
                {askContext &&
                  (askContext.artifactId !== artifact.id ||
                    askContext.artifactRev !== artifact.rev) && (
                    <p className="ask-context-note">
                      {t('entry.contextChanged')}{' '}
                      <button
                        type="button"
                        onClick={() =>
                          setAskContext({ artifactId: artifact.id, artifactRev: artifact.rev })
                        }
                      >
                        {t('entry.useLatest')}
                      </button>
                    </p>
                  )}
                <p className="explore-note">{t('design.personalNote')}</p>
                {askContext && (
                  <div className="context-chip">
                    <FileText size={13} />
                    <span>
                      {t('design.context')}:{' '}
                      {current.artifacts.find(
                        (a) => a.id === askContext.artifactId && a.rev === askContext.artifactRev,
                      )?.question ?? artifact.question}
                    </span>
                    <button
                      type="button"
                      aria-label={t('design.removeContext')}
                      onClick={() => setAskContext(null)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
                <textarea
                  aria-label={t('ask.placeholder')}
                  placeholder={t('ask.placeholder')}
                  value={ask}
                  rows={1}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229
                    ) {
                      e.preventDefault();
                      void submitAsk();
                    }
                  }}
                />
                <button className="text-button" type="submit" disabled={!ask.trim() || sending}>
                  {t('ask.send')}
                  <ArrowUpRight size={16} />
                </button>
              </form>
            )}
            {current.changes.length > 0 && (
              <section className="changes">
                <div className="section-label">
                  <Clock3 size={15} />
                  {t('changes')}
                </div>
                {current.changes.map((c, i) => (
                  <p key={i}>{c}</p>
                ))}
              </section>
            )}
            {current.scenarios.length > 0 && (
              <details>
                <summary>
                  {t('savedScenarios')} ({current.scenarios.length})
                </summary>
                {current.scenarios.map((s) => (
                  <div key={s.id} className="saved-record">
                    <strong>
                      {s.formula.label}: {s.result ?? t('unknown')} {s.formula.unit}
                    </strong>
                    <p>
                      {Object.entries(s.values)
                        .map(([k, v]) => `${k}: ${v ?? '?'}`)
                        .join(' · ')}
                    </p>
                    {s.baseInputVersion < current.inputVersion && (
                      <p className="stale">{t('scenarioStale')}</p>
                    )}
                  </div>
                ))}
              </details>
            )}
            {current.decisions.length > 0 && (
              <details>
                <summary>
                  {t('decisions')} ({current.decisions.length})
                </summary>
                {current.decisions.map((d) => (
                  <div key={d.id} className="saved-record">
                    <span className="badge">
                      {t(d.scope === 'personal' ? 'personal' : 'meetingScope')}
                    </span>
                    <p>{d.artifact.question}</p>
                    <p>{d.basis}</p>
                    <small>{d.participants}</small>
                  </div>
                ))}
              </details>
            )}
            {current.status === 'active' && snapshot.capabilities.developerInputs && (
              <section className="manual-input">
                <button className="text-button" onClick={() => setShowInput(!showInput)}>
                  ＋ {t('addSource')}
                </button>
                {showInput && (
                  <>
                    <p className="muted">{t('manualHint')}</p>
                    <textarea
                      aria-label={t('sourceText')}
                      placeholder={t('sourceText')}
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                    />
                    <button
                      disabled={!sourceText.trim()}
                      onClick={() =>
                        void act(async () => {
                          await command('ingest', {
                            text: sourceText,
                            kind: current.mode === 'replay' ? 'replay' : 'manual',
                          });
                          setSourceText('');
                        })
                      }
                    >
                      {t('add')}
                    </button>
                  </>
                )}
              </section>
            )}
            <details className="processing-details">
              <summary>{t('live.processingDetails')}</summary>
              <p>
                {t('live.calls')}: {current.usageTotals?.calls ?? current.metrics.calls} · Tokens:{' '}
                {current.metrics.inputTokens + current.metrics.outputTokens}
                {(current.usageTotals?.unknownUsageCalls ?? 0) > 0
                  ? ' + ' + t('live.unknownUsage')
                  : ''}
              </p>
              <p>
                {t('live.lastUnderstanding')}:{' '}
                {current.lastUnderstandingAt
                  ? new Date(current.lastUnderstandingAt).toLocaleTimeString(locale)
                  : '—'}{' '}
                · {t('live.lastView')}:{' '}
                {current.lastExpressionAt
                  ? new Date(current.lastExpressionAt).toLocaleTimeString(locale)
                  : '—'}
              </p>
            </details>
          </main>
          {current && (
            <SourceDrawer
              key={current.id}
              open={sourceRefs !== null}
              target={sourceTarget}
              meeting={current}
              refs={sourceRefs ?? []}
              locale={locale}
              onClose={() => setSourceRefs(null)}
              onCorrect={(payload) => act(() => command('correct', payload))}
            />
          )}
        </>
      )}
      {newMeeting && snapshot.capabilities.developerInputs && (
        <NewMeeting
          preferences={snapshot.preferences}
          t={t}
          configured={snapshot.capabilities.sttConfigured}
          close={() => setNewMeeting(false)}
          start={async (payload) => {
            const id = await command('create', payload, null);
            setSelected(id);
            setView(null);
            setNewMeeting(false);
          }}
          onError={setError}
        />
      )}
      {renaming && current && (
        <Modal title={t('entry.rename')} close={() => setRenaming(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await command('rename', {
                  title: titleDraft,
                  baseRevision: current.titleMeta?.revision ?? 0,
                });
                setRenaming(false);
              });
            }}
          >
            <input
              autoFocus
              aria-label={t('meeting.title')}
              value={titleDraft}
              maxLength={100}
              onChange={(e) => setTitleDraft(e.target.value)}
            />
            <div className="button-row">
              <button type="submit">{t('saveSettings')}</button>
              <button type="button" onClick={() => setRenaming(false)}>
                {t('action.cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {settings && (
        <Settings
          setupOnly={audioSetup}
          preferences={snapshot.preferences}
          snapshot={snapshot}
          t={t}
          close={() => setSettings(false)}
          save={(p, keepOpen) =>
            act(async () => {
              await command('preferences', p as unknown as Record<string, unknown>, null);
              if (!keepOpen) setSettings(false);
              return true;
            })
          }
          current={current}
          changeOutput={(output) => act(() => command('language', { locale: output }))}
        />
      )}
      {decisionScope && artifact && current && (
        <DecisionModal
          scope={decisionScope}
          meeting={current}
          t={t}
          close={() => setDecisionScope(null)}
          save={(payload) =>
            act(async () => {
              await command('decision', {
                ...payload,
                scope: decisionScope,
                artifactId: artifact.id,
                artifactRev: artifact.rev,
              });
              setDecisionScope(null);
            })
          }
        />
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
