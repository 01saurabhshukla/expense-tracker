// A short, stable name for "who was paid", used to remember the user's
// corrections ("always put this merchant in Food & Dining").
//
// 1. A UPI handle (swiggy@icici) when there is one: it's the same in every
//    bank's export that includes it, so a correction made on an HDFC
//    statement also applies to the same merchant on an SBI statement.
// 2. Otherwise the description with numbers, card masks and banking words
//    removed: "POS 416021XXXXXX4821 NETFLIX" → "NETFLIX".

// The handle must start after a separator. No "-" inside it: HDFC uses "-"
// between fields ("UPI-MAHANAGAR GAS-mgl@hdfcbank"), and allowing it would
// capture "gas-mgl@hdfcbank" instead of "mgl@hdfcbank".
const UPI_HANDLE = /(?:^|[\s/*:-])([a-z0-9][a-z0-9._]{1,63}@[a-z]{2,32})(?![a-z])/i;

// Phrases about *how* money moved, removed before splitting into words.
const NOISE_PHRASES = [/PAY TO MERCHANT/g, /UPI PAYMENT/g, /POS ATM PURCH/g, /ECOM PUR/g];

// Single words about *how* money moved, not *who* received it.
const NOISE_WORDS = new Set([
  'UPI', 'DR', 'CR', 'D', 'POS', 'ACH', 'ACHDR', 'DEBIT', 'CREDIT', 'TO', 'BY', 'TRANSFER',
  'PAYMENT', 'P2M', 'P2A', 'PCD', 'BIL', 'ONL', 'BRN', 'FLEX', 'INB', 'NEFT', 'IMPS', 'MMT',
  'RTGS', 'ATM', 'ATL', 'OTHPG', 'YESB', 'BANK', 'AXIS', 'MUMBAI', 'N',
]);

export function merchantKey(description) {
  const handle = description.match(UPI_HANDLE);
  if (handle) return handle[1].toLowerCase();

  let text = description.toUpperCase();
  for (const phrase of NOISE_PHRASES) text = text.replace(phrase, ' ');

  const words = text
    .split(/[^A-Z0-9]+/)
    .filter((word) => word && !/\d/.test(word) && !/^X+$/.test(word) && !NOISE_WORDS.has(word));

  const name = words.join(' ').slice(0, 200);
  return name || null;
}
