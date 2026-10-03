import { writeFileSync } from 'node:fs';
import { measureTokenBudget } from '../src/tools/tokenBudget.js';

const budget = await measureTokenBudget();
const target = new URL('../tokenBudget.json', import.meta.url);
writeFileSync(target, JSON.stringify(budget, null, 2) + '\n');
console.log(JSON.stringify(budget, null, 2));
