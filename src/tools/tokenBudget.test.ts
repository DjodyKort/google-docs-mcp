import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOL_GROUPS } from './index.js';
import { measureTokenBudget, type TokenBudget } from './tokenBudget.js';

const budget: TokenBudget = JSON.parse(
  readFileSync(new URL('../../tokenBudget.json', import.meta.url), 'utf8')
);
const limit = (value: number) => Math.floor((value * (100 + budget.tolerancePercent)) / 100);

describe('tools/list token budget', () => {
  it('covers every tool group in tokenBudget.json', async () => {
    expect(Object.keys(budget.groups).sort()).toEqual([...TOOL_GROUPS].sort());
  });

  it('keeps every group within the committed budget (run `npm run budget:update` to accept growth)', async () => {
    const actual = await measureTokenBudget();
    for (const group of TOOL_GROUPS) {
      expect(actual.groups[group], `group ${group}`).toBeLessThanOrEqual(
        limit(budget.groups[group])
      );
    }
  });

  it('keeps the default and full totals within the committed budget', async () => {
    const actual = await measureTokenBudget();
    expect(actual.default, 'default total').toBeLessThanOrEqual(limit(budget.default));
    expect(actual.all, 'all total').toBeLessThanOrEqual(limit(budget.all));
  });

  it('keeps the default set smaller than the full set', async () => {
    const actual = await measureTokenBudget();
    expect(actual.default).toBeLessThan(actual.all);
  });
});
