/** The service grants a lease at audio receipt, before a slow provider request.
 * A completed lease may finish after pause/end, but never accepts new audio then. */
import type { Meeting } from '../contracts/model';
export type AudioLease = {
  meetingId: string;
  epoch: number;
  channel: 'microphone' | 'system_audio';
  segmentId: string;
  receivedAt: string;
};
export function acceptAudio(
  m: Meeting | undefined,
  epoch: number,
  channel: string,
  segmentId: string,
): AudioLease {
  if (!m || m.epoch !== epoch || m.capture !== 'capturing' || m.status !== 'active')
    throw new Error('CAPTURE_EXPIRED');
  if (!['microphone', 'system_audio'].includes(channel) || !/^[\w-]{1,100}$/.test(segmentId))
    throw new Error('INVALID_AUDIO');
  return {
    meetingId: m.id,
    epoch,
    channel: channel as AudioLease['channel'],
    segmentId,
    receivedAt: new Date().toISOString(),
  };
}
