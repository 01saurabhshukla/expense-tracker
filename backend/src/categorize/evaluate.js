import { categorizeByRules } from './rules.js';
import { UNCATEGORIZED } from './categories.js';

// Scores the rules against hand-labelled transactions
// ({ description, direction, expected }). A wrong category is worse than
// "uncategorized" (it silently misleads the user), so they're counted apart.
export function evaluateRules(labels) {
  const wrong = [];
  const uncategorized = [];
  const perCategory = {};

  for (const label of labels) {
    const result = categorizeByRules(label);
    const actual = result?.category ?? UNCATEGORIZED;
    const stats = (perCategory[label.expected] ??= { total: 0, correct: 0 });
    stats.total++;

    if (actual === label.expected) stats.correct++;
    else if (actual === UNCATEGORIZED) uncategorized.push(label);
    else wrong.push({ ...label, actual, rule: result.rule });
  }

  const correct = labels.length - wrong.length - uncategorized.length;
  return {
    total: labels.length,
    correct,
    accuracy: labels.length ? correct / labels.length : 0,
    wrong,
    uncategorized,
    perCategory,
  };
}
