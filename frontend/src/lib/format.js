// Display helpers. Money arrives as whole paise (integers) and stays an
// integer until it becomes text: no floating point ever touches it.

// 13325000 → "₹1,33,250.00" (Indian grouping).
export function formatRupees(paise, { sign = false } = {}) {
  if (paise === null || paise === undefined) return '—';
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const text = `₹${Math.floor(abs / 100).toLocaleString('en-IN')}.${String(abs % 100).padStart(2, '0')}`;
  if (negative) return `−${text}`; // a real minus sign, easier to read than "-"
  return sign && paise > 0 ? `+${text}` : text;
}

// Short form for chart axes: ₹1.2L, ₹45K, ₹1.3Cr.
export function formatRupeesShort(paise) {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

const trim = (n) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));

// "2026-09-01" → "01/09/2026". Plain string work: these dates have no time
// zone, and new Date("2026-09-01") would shift them in some time zones.
export function formatDate(iso) {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Labels for timeline points (the period's first day).
export function formatPeriod(iso, granularity) {
  const [year, month, day] = iso.split('-');
  if (granularity === 'month') return `${MONTHS[Number(month) - 1]} ${year}`;
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

export function formatDateTime(isoTimestamp) {
  if (!isoTimestamp) return '—';
  return new Date(isoTimestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(count, word, many = `${word}s`) {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? word : many}`;
}
