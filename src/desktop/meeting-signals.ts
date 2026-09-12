import { EventEmitter } from 'node:events';
import { MeetingCandidate } from '../contracts/meeting-candidate';

const signals = new EventEmitter();
/** Main-process integration seam. No production detector is connected yet. */
export function reportMeetingCandidate(candidate: unknown) {
  signals.emit('candidate', MeetingCandidate.parse(candidate));
}
export function onMeetingCandidate(listener: (candidate: MeetingCandidate) => void) {
  signals.on('candidate', listener);
  return () => signals.off('candidate', listener);
}
