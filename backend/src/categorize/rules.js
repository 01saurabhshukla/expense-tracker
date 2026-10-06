// Layers 2–4 of categorization (D19, D25): rules that look at the
// description and direction. The first matching rule wins, so ORDER MATTERS:
// e.g. salary is checked before "any NEFT credit is money received".
//
// Every pattern runs on the UPPERCASED description. \b = word boundary, so
// "OLA" matches "UPI-OLA-…" but not "KOLAR".

// Builds one regex from plain keywords: ['HPCL', 'INDIAN OIL'] → /\b(HPCL|INDIAN OIL)\b/
const words = (...keywords) => new RegExp(`\\b(${keywords.join('|')})\\b`);

// Layer 2 — what kind of transaction it is, regardless of merchant.
const TYPE_RULES = [
  // Only real withdrawals. SBI writes card purchases as "POS ATM PURCH …",
  // so a bare "ATM" must NOT mean cash.
  { category: 'cash', direction: 'debit', pattern: /\b(NWD|ATM WDL|CASH WDL)\b|\bATM[-/ ]CASH\b/ },
  { category: 'salary', direction: 'credit', pattern: words('SALARY', 'SAL CREDIT') },
  { category: 'interest', direction: 'credit', pattern: /\bINTEREST\b|\bINT\.PD\b/ },
  { category: 'investments', direction: 'debit', pattern: words('SIP', 'MUTUAL FUND', 'ZERODHA', 'GROWW') },
  { category: 'rent', direction: 'debit', pattern: words('RENT', 'HOUSE RENT', 'NOBROKER') },
];

// Layer 3 — who was paid.
const MERCHANT_RULES = [
  { category: 'food_dining', pattern: words('SWIGGY', 'ZOMATO', 'CHAI POINT', 'DOMINOS', 'MCDONALDS', 'KFC', 'STARBUCKS', 'EATSURE') },
  { category: 'groceries', pattern: words('BLINKIT', 'ZEPTO', 'BIGBASKET', 'DMART', 'INSTAMART', 'JIOMART') },
  { category: 'transport', pattern: words('UBER', 'OLA', 'OLACABS', 'RAPIDO', 'NAMMA YATRI', 'METRO') },
  { category: 'fuel', pattern: words('HPCL', 'BPCL', 'IOCL', 'INDIAN OIL', 'PETROL', 'SHELL') },
  { category: 'travel', pattern: words('IRCTC', 'MAKEMYTRIP', 'GOIBIBO', 'CLEARTRIP', 'INDIGO', 'REDBUS') },
  { category: 'shopping', pattern: words('AMAZON', 'FLIPKART', 'MYNTRA', 'AJIO', 'MEESHO', 'NYKAA') },
  { category: 'utilities', pattern: words('MSEDCL', 'ELECTRICITY', 'MAHANAGAR GAS', 'AIRTEL', 'JIO', 'BROADBAND', 'BSNL', 'TATA POWER', 'BESCOM') },
  { category: 'entertainment', pattern: words('NETFLIX', 'BOOKMYSHOW', 'HOTSTAR', 'SPOTIFY', 'PRIME VIDEO') },
  { category: 'health', pattern: words('APOLLO', 'PHARMACY', 'PHARMEASY', 'HOSPITAL', 'CLINIC') },
];

// Layer 4 — money moved to or from a person (after merchants, so a UPI
// payment to SWIGGY is food, not a "transfer").
const TRANSFER_RULES = [
  { category: 'transfers_in', direction: 'credit', pattern: words('IMPS', 'NEFT', 'RTGS', 'UPI', 'MMT') },
  { category: 'transfers_out', direction: 'debit', pattern: words('IMPS', 'NEFT', 'RTGS') },
  // UPI to a personal handle (@okicici, @okhdfcbank, @oksbi, @okaxis …).
  { category: 'transfers_out', direction: 'debit', pattern: /@OK[A-Z]+\b/ },
];

const RULE_LAYERS = [
  ['type', TYPE_RULES],
  ['merchant', MERCHANT_RULES],
  ['transfer', TRANSFER_RULES],
];

// → { category, rule } where `rule` says which rule matched (for debugging and
// the evaluation report), or null when no rule applies.
export function categorizeByRules({ description, direction }) {
  const text = description.toUpperCase();
  for (const [layer, rules] of RULE_LAYERS) {
    for (const rule of rules) {
      if (rule.direction && rule.direction !== direction) continue;
      const match = text.match(rule.pattern);
      if (match) return { category: rule.category, rule: `${layer}:${match[0]}` };
    }
  }
  return null;
}
