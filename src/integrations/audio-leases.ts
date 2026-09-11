/** The service grants a lease at audio receipt, before a slow provider request.
 * A completed lease may finish after pause/end, but never accepts new audio then. */
import { z } from 'zod';
import type { Meeting } from '../contracts/model';
export type AudioLease = {
  meetingId: string;
  epoch: number;
  channel: 'microphone' | 'system_audio';
  segmentId: string;
  receivedAt: string;
  captureStartMs?: number;
  captureEndMs?: number;
  channelSequence?: number;
};
export function acceptAudio(
  m: Meeting | undefined,
  epoch: number,
  channel: string,
  segmentId: string,
  timing?: { captureStartMs: number; captureEndMs: number; channelSequence: number },
): AudioLease {
  if (!m || m.epoch !== epoch || m.capture !== 'capturing' || m.status !== 'active')
    throw new Error('CAPTURE_EXPIRED');
  if (!['microphone', 'system_audio'].includes(channel) || !/^[\w-]{1,100}$/.test(segmentId))
    throw new Error('INVALID_AUDIO');
  if (timing) {
    z.object({
      captureStartMs: z.number().finite().nonnegative(),
      captureEndMs: z.number().finite().nonnegative(),
      channelSequence: z.number().int().nonnegative(),
    })
      .strict()
      .parse(timing);
    if (
      timing.captureEndMs < timing.captureStartMs ||
      timing.captureEndMs - timing.captureStartMs > 10000 ||
      timing.captureEndMs > Date.now() + 10000
    )
      throw new Error('INVALID_AUDIO_TIME');
  }
  return {
    ...timing,
    meetingId: m.id,
    epoch,
    channel: channel as AudioLease['channel'],
    segmentId,
    receivedAt: new Date().toISOString(),
  };
}
