import React, { useEffect, useState } from 'react';
import type { ComponentDockView, DockCard } from '../../contracts/component-dock';
import { api } from '../bridge';
import { CollaborationPanel } from './Panel';
import './dock.css';

function MiniContent({ card, zh }: { card: DockCard; zh: boolean }) {
  const c = card.content;
  return (
    <div className="component-mini-content">
      {c.kind === 'poll' ? (
        <>
          <strong>{c.payload.question}</strong>
          {c.payload.options.slice(0, 3).map((o) => (
            <span key={o.id}>○ {o.label}</span>
          ))}
          {c.payload.options.length > 3 && <small>+{c.payload.options.length - 3}项</small>}
        </>
      ) : c.kind === 'assignment' ? (
        <>
          <strong>{zh ? '分工安排' : 'Assignments'}</strong>
          {c.payload.items.slice(0, 3).map((i) => (
            <span key={i.id}>□ {i.title}</span>
          ))}
        </>
      ) : c.kind === 'conflict' ? (
        <>
          <strong>{c.payload.sides[0]?.title}</strong>
          {c.payload.questions.slice(0, 2).map((q) => (
            <span key={q.id}>{q.text}</span>
          ))}
        </>
      ) : (
        <>
          <strong>{c.payload.statement}</strong>
          <span>{c.payload.scopeText}</span>
          <small>{zh ? '等待指定参与者确认' : 'Awaiting explicit confirmation'}</small>
        </>
      )}
    </div>
  );
}
export function ComponentDock() {
  const [view, setView] = useState<ComponentDockView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true,
      loaded = false;
    const load = () =>
      void api('componentDockSnapshot')
        .then((v) => {
          loaded = true;
          if (alive) setView(v);
        })
        .catch(() => {});
    load();
    const timer = setInterval(() => {
      if (!loaded) load();
    }, 1000);
    const unsubscribe = window.meeting.subscribe((v: any) => {
      if (v && 'cards' in v) setView(v);
    });
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  const send = (method: string, args?: unknown) =>
    void api(method, args).catch((e) => setError(e.message));
  if (!view) return null;
  const zh = view.locale === 'zh-CN';
  const labels = zh
    ? { poll: '投票', assignment: '分工', conflict: '冲突讨论', decision_confirmation: '决定确认' }
    : {
        poll: 'Poll',
        assignment: 'Assignments',
        conflict: 'Conflict',
        decision_confirmation: 'Confirmation',
      };
  return (
    <main
      className={`component-dock ${view.selectedId ? 'expanded' : ''}`}
      onMouseEnter={() => send('componentDockHold', { held: true })}
      onMouseLeave={() => send('componentDockHold', { held: false })}
    >
      {view.selectedId && view.meetingId && (
        <section className="dock-review">
          <header>
            <span>
              {view.pinned
                ? zh
                  ? '审核已固定'
                  : 'Review pinned'
                : zh
                  ? '悬停预览 · 点击缩略卡固定审核'
                  : 'Hover preview · click thumbnail to pin'}
            </span>
            <button onClick={() => send('componentDockCollapse')}>
              {zh ? '收起审核' : 'Collapse review'}
            </button>
          </header>
          <div className="dock-review-scroll">
            <CollaborationPanel
              key={view.selectedId}
              meetingId={view.meetingId}
              enabled
              floating
              locale={view.locale}
            />
          </div>
        </section>
      )}
      <aside className="dock-thumbnails" aria-label={zh ? '自动准备的组件' : 'Prepared components'}>
        <header>
          <strong>{zh ? '待审核组件' : 'Ready to review'}</strong>
          <small>
            {view.cards.length} · {zh ? '自动更新' : 'Live updates'}
          </small>
        </header>
        <div className="dock-card-list">
          {view.cards.map((card) => (
            <button
              key={card.id}
              className={`component-thumbnail ${view.selectedId === card.id ? 'selected' : ''}`}
              data-thumbnail-id={card.id}
              onMouseEnter={() =>
                send('componentDockInspect', { componentId: card.id, pin: false })
              }
              onFocus={() => send('componentDockInspect', { componentId: card.id, pin: false })}
              onClick={() => send('componentDockInspect', { componentId: card.id, pin: true })}
            >
              <div className="mini-label">
                <span>{labels[card.content.kind]}</span>
                <small>
                  {card.preparing
                    ? zh
                      ? '正在随讨论补充'
                      : 'Updating from discussion'
                    : zh
                      ? '已准备好'
                      : 'Ready'}
                </small>
              </div>
              <MiniContent card={card} zh={zh} />
            </button>
          ))}
        </div>
        {!view.cards.length && <p>{zh ? '本轮组件已处理' : 'All components reviewed'}</p>}
        {error && <p role="alert">{error}</p>}
      </aside>
    </main>
  );
}
