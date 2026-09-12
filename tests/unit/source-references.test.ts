import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Segment } from '../../src/contracts/model';
import { sourceNumbers, resolveSources } from '../../src/ui/source-references';
const segment = (id: string, rev: number, text: string) => ({ id, rev, text }) as Segment;
test('citations retain their numbers after corrections; historical references resolve exactly', () => {
  const old = segment('a', 1, 'old'),
    other = segment('b', 1, 'other'),
    corrected = segment('a', 2, 'corrected');
  const sources = [old, other, corrected];
  assert.deepEqual(sourceNumbers(sources), { a: 1, b: 2 });
  assert.deepEqual(resolveSources(sources, [{ id: 'a', rev: 1 }]), [old]);
  assert.deepEqual(resolveSources(sources, []), [corrected, other]);
  assert.deepEqual(resolveSources(sources, [{ id: 'a', rev: 3 }]), []);
});

test('personal requests stay traceable but are not presented as live transcript speech', () => {
  const speech = segment('speech', 1, 'A spoken statement');
  const request = { ...segment('request', 1, 'My private question'), kind: 'request' } as Segment;
  assert.deepEqual(resolveSources([speech, request], []), [speech]);
  assert.deepEqual(resolveSources([speech, request], [{ id: 'request', rev: 1 }]), [request]);
});
