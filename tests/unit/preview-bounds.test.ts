import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewBounds } from '../../src/desktop/preview-bounds';

for (const area of [
  { x: 0, y: 25, width: 1440, height: 850 },
  { x: -1920, y: -160, width: 1920, height: 1040 },
  { x: 100, y: 60, width: 800, height: 560 },
]) {
  test(`canvas stays on its display and beside the launcher at ${area.x},${area.y}`, () => {
    for (const x of [area.x + 12, area.x + area.width / 2, area.x + area.width - 56]) {
      for (const y of [area.y, area.y + area.height - 44]) {
        const launcher = { x, y, width: 44, height: 44 };
        for (const meeting of [false, true]) {
          const p = previewBounds(launcher, area, meeting);
          assert.ok(p.x >= area.x && p.x + p.width <= area.x + area.width);
          assert.ok(p.y >= area.y && p.y + p.height <= area.y + area.height);
          assert.ok(p.width > 0 && p.height > 0);
          assert.ok(p.x + p.width <= x - 8 || p.x >= x + 52, 'preview must not cover the launcher');
        }
      }
    }
  });
}
test('a meeting receives a readable canvas, while idle stays compact', () => {
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const ball = { x: 1384, y: 100, width: 44, height: 44 };
  assert.equal(previewBounds(ball, area, true).width, 760);
  assert.equal(previewBounds(ball, area, true).height, 560);
  assert.equal(previewBounds(ball, area, false).width, 340);
  assert.equal(previewBounds(ball, area, false).height, 240);
});
