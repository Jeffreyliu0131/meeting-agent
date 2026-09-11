import Decimal from 'decimal.js';
import type { Formula } from '../contracts/model';
export function calculate(
  formula: Formula,
  overrides: Record<string, number | null> = {},
): string | null {
  const vars = new Map<string, Decimal | null>();
  for (const p of formula.parameters) {
    const value = Object.hasOwn(overrides, p.id) ? overrides[p.id] : p.value;
    if (
      p.min > p.max ||
      (value !== null && (!Number.isFinite(value) || value < p.min || value > p.max))
    )
      throw new Error('INVALID_PARAMETER');
    if (vars.has(p.id)) throw new Error('DUPLICATE_ID');
    vars.set(p.id, value === null ? null : new Decimal(value));
  }
  for (const key of Object.keys(overrides))
    if (!vars.has(key)) throw new Error('UNKNOWN_PARAMETER');
  for (const s of formula.steps) {
    if (vars.has(s.id) || !vars.has(s.left) || !vars.has(s.right))
      throw new Error('INVALID_FORMULA');
    const left = vars.get(s.left),
      right = vars.get(s.right);
    if (left === null || right === null) {
      vars.set(s.id, null);
      continue;
    }
    if (!left || !right) throw new Error('INVALID_FORMULA');
    if (s.op === 'divide' && right.isZero()) throw new Error('DIVISION_BY_ZERO');
    const result =
      s.op === 'add'
        ? left.add(right)
        : s.op === 'subtract'
          ? left.sub(right)
          : s.op === 'multiply'
            ? left.mul(right)
            : left.div(right);
    if (!result.isFinite() || result.abs().gt('1e15')) throw new Error('RESULT_OUT_OF_RANGE');
    vars.set(s.id, result);
  }
  if (!vars.has(formula.result)) throw new Error('INVALID_FORMULA');
  return vars.get(formula.result)?.toDecimalPlaces(6).toString() ?? null;
}
