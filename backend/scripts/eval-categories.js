// Prints how well the categorization rules do on the hand-labelled set.
// Usage: npm run eval:categories [-- path/to/labels.json]
import { readFile } from 'node:fs/promises';
import { evaluateRules } from '../src/categorize/evaluate.js';

const file = process.argv[2] ?? new URL('../tests/fixtures/categorization/labels.json', import.meta.url);
const labels = JSON.parse(await readFile(file, 'utf8'));
const report = evaluateRules(labels);

const percent = (n) => `${(n * 100).toFixed(1)}%`;
console.log(`Transactions: ${report.total}`);
console.log(`Correct:       ${report.correct} (${percent(report.accuracy)})`);
console.log(`Wrong:         ${report.wrong.length}   ← misleading, fix first`);
console.log(`Uncategorized: ${report.uncategorized.length}`);

console.log('\nPer category (correct / total):');
for (const [category, { correct, total }] of Object.entries(report.perCategory).sort()) {
  console.log(`  ${category.padEnd(15)} ${String(correct).padStart(4)} / ${total}`);
}

for (const w of report.wrong) {
  console.log(`\nWRONG  expected ${w.expected}, got ${w.actual} (${w.rule})\n       ${w.description}`);
}
for (const u of report.uncategorized) {
  console.log(`\nUNCATEGORIZED  expected ${u.expected}\n       ${u.description}`);
}
