// Generates HDFC-style CSV statements of any size for large-file tests.
// Balances are computed in whole paise, so they always add up exactly.

const MERCHANTS = [
  ['SWIGGY', 'swiggy@icici'],
  ['BIGBASKET', 'bigbasket@axisbank'],
  ['UBER INDIA', 'uber@hdfcbank'],
  ['UNKNOWN MERCHANT XYZ', 'xyz@ybl'],
];

const HEADER = 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance';

// `rows` valid transactions, one salary every 60 rows, spread over days from
// 1 Jan 2024. `seed` makes references unique per call, so two generated
// files never look like overlapping statements.
export function hdfcStatementCsv(rows, { seed = 0 } = {}) {
  const lines = [HEADER];
  let balancePaise = 5_000_000;
  for (let i = 0; i < rows; i++) {
    const date = dayFirst(new Date(Date.UTC(2024, 0, 1 + Math.floor(i / 20))));
    const ref = String(seed * 10_000_000 + i).padStart(16, '0');
    if (i % 60 === 0) {
      balancePaise += 8_500_000;
      lines.push(`${date},NEFT CR-CITI0000002-ACME TECHNOLOGIES SALARY,${ref},${date},,85000.00,${rupees(balancePaise)}`);
    } else {
      const [name, vpa] = MERCHANTS[i % MERCHANTS.length];
      const amountPaise = 10_000 + ((i * 7919) % 90_000); // ₹100–₹1,000, deterministic
      balancePaise -= amountPaise;
      lines.push(`${date},UPI-${name}-${vpa}-HDFC0000001-${ref.slice(-12)}-UPI,${ref},${date},${rupees(amountPaise)},,${rupees(balancePaise)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// Rows that each fail one check (an impossible date).
export function badRows(count) {
  return Array.from({ length: count }, (_, i) => `32/13/24,BROKEN ROW ${i},REF${i},32/13/24,100.00,,1000.00`).join('\n') + '\n';
}

function rupees(paise) {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function dayFirst(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}
