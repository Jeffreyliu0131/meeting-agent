import { z } from 'zod';

/** Trusted detector output, never transcript/model/UI content. Same episode keeps its ID. */
export const MeetingCandidate = z
  .object({
    id: z.string().regex(/^[\w-]{1,100}$/),
    revision: z.number().int().nonnegative(),
    present: z.boolean(),
    expiresAt: z.number().finite(),
  })
  .strict();
export type MeetingCandidate = z.infer<typeof MeetingCandidate>;
export type ReminderView = {
  id: string;
  channel: 'bubble' | 'system';
  phase: 'prompt' | 'starting' | 'recording';
};
