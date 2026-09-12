import type { Ref, Segment } from '../contracts/model';
/** A source keeps its number across corrections; the revision remains explicit in every link. */
export function sourceNumbers(segments: Segment[]) {
  const numbers: Record<string, number> = {};
  let next = 1;
  for (const segment of segments)
    if (numbers[segment.id] === undefined) numbers[segment.id] = next++;
  return numbers;
}
export function resolveSources(segments: Segment[], refs: Ref[]) {
  if (refs.length)
    return refs.flatMap((ref) => {
      const segment = segments.find((s) => s.id === ref.id && s.rev === ref.rev);
      return segment ? [segment] : [];
    });
  const latest = new Map<string, Segment>();
  for (const segment of segments) {
    if (segment.kind === 'request') continue;
    const previous = latest.get(segment.id);
    if (!previous || segment.rev > previous.rev) latest.set(segment.id, segment);
  }
  return [...latest.values()];
}
