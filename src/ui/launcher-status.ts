import type { Meeting } from '../contracts/model';

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
