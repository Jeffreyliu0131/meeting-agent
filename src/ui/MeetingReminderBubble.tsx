import React, { useRef } from 'react';
import { ArrowUpRight, Check, X } from 'lucide-react';
import type { ReminderView } from '../contracts/meeting-candidate';
import { api } from './bridge';

export function MeetingReminderBubble({
  view,
  t,
}: {
  view?: ReminderView | null;
  t: (key: string) => string;
}) {
  const pointer = useRef(false),
    focused = useRef(false);
  const hold = () =>
    view && void api('reminderHold', { id: view.id, held: pointer.current || focused.current });
  if (!view || view.channel !== 'bubble') return null;
  const prompt = view.phase === 'prompt';
  return (
    <div
      className="meeting-reminder"
      role="status"
      aria-live="polite"
      onMouseEnter={() => {
        pointer.current = true;
        hold();
      }}
      onMouseLeave={() => {
        pointer.current = false;
        hold();
      }}
      onFocus={() => {
        focused.current = true;
        hold();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          focused.current = false;
          hold();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && prompt) void api('reminderDismiss', { id: view.id });
      }}
    >
      <button
        className="reminder-action"
        disabled={!prompt}
        onClick={() => void api('reminderAccept', { id: view.id })}
      >
        <span className="reminder-copy">
          <strong>
            {t(
              prompt
                ? 'reminder.title'
                : view.phase === 'starting'
                  ? 'reminder.starting'
                  : 'reminder.recording',
            )}
          </strong>
          {prompt && <span>{t('reminder.body')}</span>}
        </span>
        {prompt ? (
          <ArrowUpRight size={18} aria-hidden="true" />
        ) : view.phase === 'recording' ? (
          <Check size={18} aria-hidden="true" />
        ) : null}
      </button>
      {prompt && (
        <button
          className="reminder-dismiss"
          aria-label={t('reminder.dismiss')}
          onClick={() => void api('reminderDismiss', { id: view.id })}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
