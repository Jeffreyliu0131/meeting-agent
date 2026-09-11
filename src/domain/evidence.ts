import type { Meeting, Ref } from '../contracts/model';
export function validateRefs(refs: Ref[], meeting: Meeting, requireSource = false) {
  if (requireSource && !refs.length) throw new Error('MISSING_SOURCE');
  for (const ref of refs)
    if (
      !meeting.segments.some((s) => s.id === ref.id && s.rev === ref.rev) ||
      meeting.segments.some((s) => s.id === ref.id && s.rev > ref.rev)
    )
      throw new Error('INVALID_SOURCE');
}
