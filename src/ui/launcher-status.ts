import type { Meeting } from '../contracts/model';
import type { CollaborationState } from '../contracts/collaboration';

export function readyComponents(s?: CollaborationState) {
  if (!s || s.ended) return [];
  return s.components
    .filter(
      (c) => c.draftState === 'ready' && !c.needsReview && c.draftRevision !== c.publishedRevision,
    )
    .map((c) => {
      const content = c.revisions.at(-1)!.content;
      const title =
        content.kind === 'poll'
          ? content.payload.question
          : content.kind === 'decision_confirmation'
            ? content.payload.statement
            : content.kind === 'assignment'
              ? content.payload.items[0]?.title
              : content.payload.sides[0]?.title;
      return { id: c.id, family: c.family, title: title ?? '', revision: c.draftRevision };
    });
}

export type LauncherIndicator = {
  state: 'ready' | 'connecting' | 'listening' | 'paused' | 'error';
  labelKey: string;
};
/** Capture readiness is authoritative. Model processing must never turn recording green. */
export function launcherIndicator(
  meeting: Pick<Meeting, 'capture'> | undefined,
  serviceError = false,
): LauncherIndicator {
  if (serviceError) return { state: 'error', labelKey: 'launcher.serviceError' };
  switch (meeting?.capture) {
    case 'starting':
      return { state: 'connecting', labelKey: 'launcher.connecting' };
    case 'capturing':
      return { state: 'listening', labelKey: 'launcher.listening' };
    case 'paused':
      return { state: 'paused', labelKey: 'launcher.paused' };
    case 'input_error':
      return { state: 'error', labelKey: 'launcher.inputError' };
    case 'idle':
      return { state: 'ready', labelKey: 'launcher.idle' };
    default:
      return { state: 'ready', labelKey: 'launcher.ready' };
  }
}
