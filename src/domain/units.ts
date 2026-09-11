/** Conservative symbolic units. No implicit currency, date or scale conversion. */
export function unitDimension(unit: string) {
  const aliases: Record<string, string> = {
    people: 'person',
    persons: 'person',
    人: 'person',
    人数: 'person',
  };
  const parts = unit.trim().split('/');
  if (parts.length > 2) throw new Error('UNSUPPORTED_UNIT');
  const result: Record<string, number> = {};
  parts.forEach((part, i) =>
    part.split('*').forEach((token) => {
      const key = aliases[token.trim()] ?? token.trim();
      if (!key || key === '1') return;
      result[key] = (result[key] ?? 0) + (i ? -1 : 1);
    }),
  );
  return result;
}
export function combineUnits(a: Record<string, number>, b: Record<string, number>, divide = false) {
  const result = { ...a };
  for (const [key, power] of Object.entries(b))
    result[key] = (result[key] ?? 0) + (divide ? -power : power);
  return result;
}
export const sameUnit = (a: Record<string, number>, b: Record<string, number>) =>
  JSON.stringify(
    Object.entries(a)
      .filter(([, p]) => p)
      .sort(),
  ) ===
  JSON.stringify(
    Object.entries(b)
      .filter(([, p]) => p)
      .sort(),
  );
