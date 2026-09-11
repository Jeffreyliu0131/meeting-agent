import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith('.ts') || e.name.endsWith('.tsx')
        ? [join(dir, e.name)]
        : [],
  );
}
test('business contracts and domain do not depend on desktop, persistence, provider or UI', () => {
  for (const f of [...files('src/domain'), ...files('src/contracts')]) {
    const imports = [...readFileSync(f, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    );
    for (const name of imports)
      assert.equal(
        /electron|sqlite|\/desktop|\/service|\/ui|\/renderers|\/agent|\/integrations/.test(name),
        false,
        `${f} imports forbidden layer ${name}`,
      );
  }
});
test('frontend does not import secrets or trusted service implementation', () => {
  for (const f of [
    ...files('src/ui'),
    ...files('src/renderers').filter((f) => f.endsWith('.tsx')),
  ]) {
    const source = readFileSync(f, 'utf8');
    assert.equal(
      /process\.env|node:|from ['"].*\/(service|desktop|agent)\//.test(source),
      false,
      f,
    );
  }
});
