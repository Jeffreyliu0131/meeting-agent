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
import { NewMeeting, Settings, SourceDrawer, ScenarioEditor, DecisionModal } from './components';

const role = new URLSearchParams(location.search).get('role') || 'workspace';
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
      setSnapshot(value);
      if (value.selectMeetingId) setSelected(value.selectMeetingId);
      if (value.openSettings) setSettings(true);
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
  }, [locale]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSourceRefs(null);
        setSettings(false);
        setNewMeeting(false);
        setDecisionScope(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const openMeeting = (m: Meeting) => {
    setSelected(m.id);
    setView(null);
    setSourceRefs(null);
    setHistory(false);
    setShowInput(false);
    setAsk('');
    setAskOpen(false);
    setAskContext(null);
    setSourceText('');
  };
  const active = snapshot?.meetings.find((m) => m.status === 'active');
  const drag = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  if (role === 'launcher')
    return (
      <button
        className="launcher"
        aria-label={t('launcher.label')}
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
        <span aria-hidden>◇</span>
        <i className={`dot ${serviceError ? 'input_error' : active?.capture || 'idle'}`} />
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
          Meeting Agent <span className="status">{t('status.' + (active?.capture || 'idle'))}</span>
        </div>
        <h2>{active?.focus || active?.title || t('emptyLibrary')}</h2>
        {active?.changes.slice(0, 3).map((s, i) => (
          <p key={i}>{s}</p>
        ))}
        {(active?.error || serviceError) && (
          <p className="error-text">
            {serviceError ? t('serviceError') : errorText(locale, active!.error!)}
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
    <div className={snapshot.preferences.reduceMotion ? 'reduce-motion' : ''}>
      <header className="toolbar">
        <button
          className="text-button"
          onClick={() => {
            setSelected(null);
            setView(null);
          }}
        >
          ← {t('navigation.meetings')}
        </button>
        <span className="toolbar-divider" />
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
          <span className="meeting-name">Meeting Agent</span>
        )}
        {current && (
          <span className="status">
            <i className={`dot ${current.capture}`} />
            {t('status.' + current.capture)}
          </span>
        )}
        <div className="toolbar-actions">
          <button
            className="text-button"
            aria-label={t('settings.open')}
            onClick={() => setSettings(true)}
          >
            ⚙
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
                  {t(current.capture === 'capturing' ? 'capture.pause' : 'record')}
                </button>
              )}
              <button className="danger" onClick={() => void act(() => command('end'))}>
                {t('meeting.end')}
              </button>
            </>
          )}
          <button
            aria-label={t('action.close')}
            className="text-button"
            onClick={() => void api('hide')}
          >
            ×
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
          <div className="eyebrow">Meeting Agent</div>
          <h1>{t('welcome')}</h1>
          <p className="lead">{t('welcomeBody')}</p>
          <button className="primary" disabled={starting} onClick={() => void startMeeting()}>
            {t(active ? 'meeting.open' : 'meeting.start')} <span>↗</span>
          </button>
          <p className="device-summary">
            {snapshot.preferences.audio?.deviceLabel || t('entry.defaultMic')} ·{' '}
            {t(
              snapshot.preferences.audio?.includeComputerAudio
                ? 'entry.withComputer'
                : 'entry.microphoneOnly',
            )}{' '}
            <button className="source-link" onClick={() => setSettings(true)}>
              {t('entry.change')}
            </button>
          </p>
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
              <button className="source-link" onClick={() => setSettings(true)}>
                {t('provider')} ↗
              </button>
            </div>
          )}
          <div className="section-label">{t('meeting.recent')}</div>
          {snapshot.meetings.length === 0 ? (
            <p className="muted">{t('emptyLibrary')}</p>
          ) : (
            snapshot.meetings.map((m) => (
              <button className="meeting-row" key={m.id} onClick={() => openMeeting(m)}>
                <div>
                  <strong>{m.title}</strong>
                  <p>
                    {t(m.mode)} · {new Date(m.createdAt).toLocaleString(locale)}
                  </p>
                </div>
                <span>{t('status.' + m.capture)} ↗</span>
              </button>
            ))
          )}
        </main>
      ) : (
        <>
          <div className="workspace-meta">
            <div className="muted">
              {t(
                current.processing === 'working'
                  ? 'processing.active'
                  : 'status.' + current.capture,
              )}
            </div>
            <div className="meta-actions">
              <button className="text-button" onClick={() => setSourceRefs([])}>
                {t('sources.open')} ↗
              </button>
              <button className="text-button" onClick={() => setHistory(!history)}>
                {t('history')}
              </button>
              <button
                className="text-button"
                onClick={() => void act(() => api('export', { meetingId: current.id }))}
              >
                {t('action.export')}
              </button>
            </div>
          </div>
          {(current.error || current.captureError) && (
            <div className="banner warning" role="status">
              {errorText(locale, current.error || current.captureError!)}
              <button onClick={() => void act(() => command('retry'))}>{t('action.retry')}</button>
            </div>
          )}
          {history && (
            <nav className="version-list" aria-label={t('history')}>
              {current.artifacts
                .slice()
                .reverse()
                .map((a) => (
                  <button
                    key={`${a.id}-${a.rev}`}
                    onClick={() => setView({ id: a.id, rev: a.rev })}
                  >
                    {a.question} · {t('revision')} {a.rev} · {a.locale}
                  </button>
                ))}
            </nav>
          )}
          <main className="workspace">
            {(current.audioPending ?? 0) > 1 && (
              <p className="muted" role="status">
                {t('live.audioPending')}: {current.audioPending}
              </p>
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
                {t('newVersion')}
                <button onClick={() => setView(null)}>{t('artifact.applyUpdates')}</button>
              </div>
            )}
            {artifact ? (
              <>
                <div className="eyebrow">
                  {view ? t('live.history') : t('live.following')}
                  {artifactIsStale(artifact, current) && (
                    <span className="stale"> · {t('artifact.stale')}</span>
                  )}
                </div>
                <h1>{artifact.question}</h1>
                <p className="lead">{artifact.summary}</p>
                <ArtifactView
                  artifact={artifact}
                  locale={locale}
                  onSources={setSourceRefs}
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
                    {t('action.savePersonal')}
                  </button>
                  <button className="text-button" onClick={() => setDecisionScope('meeting')}>
                    {t('action.recordDecision')}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-work">
                <span className="empty-symbol">◇</span>
                <h1>{current.focus || t('noArtifact')}</h1>
                <p>
                  {snapshot.capabilities.modelConfigured
                    ? t('entry.listeningEmpty')
                    : t('awaiting')}
                </p>
                {!snapshot.capabilities.modelConfigured && (
                  <button onClick={() => setSettings(true)}>{t('provider')}</button>
                )}
              </div>
            )}
            {current.changes.length > 0 && (
              <section className="changes">
                <div className="section-label">{t('changes')}</div>
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
          </main>
          {current.status === 'active' && artifact && (
            <div className="explore-entry">
              <button
                className="source-link"
                onClick={() => {
                  if (!askOpen && !ask.trim())
                    setAskContext({ artifactId: artifact.id, artifactRev: artifact.rev });
                  setAskOpen(!askOpen);
                }}
              >
                {t(askOpen ? 'entry.closeExplore' : 'entry.explore')}
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
              <span aria-hidden>✦</span>
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
                {t('ask.send')} ↗
              </button>
            </form>
          )}
          {sourceRefs !== null && (
            <SourceDrawer
              meeting={current}
              refs={sourceRefs}
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
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-label={t('entry.rename')}
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
            <h2>{t('entry.rename')}</h2>
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
        </div>
      )}
      {settings && (
        <Settings
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
