import PDFDocument from 'pdfkit';
import { CATEGORIES } from '../categorize/categories.js';
import { formatDate, formatRupees } from './format.js';

// The PDF report: summary, spending by category (bar chart + table), months,
// top merchants, and the first transactions. Built with pdfkit's primitives
// (text, rectangles). Amounts say "Rs": the built-in PDF fonts have no ₹ sign.

const PAGE = { size: 'A4', margin: 40 };
const COLORS = { text: '#1f2933', muted: '#616e7c', line: '#d9e2ec', bar: '#3f7fbf', debit: '#b42318', credit: '#067647' };
const CATEGORY = new Map(CATEGORIES.map((c) => [c.key, c]));

// `dashboard`: getDashboard() output (monthly). `transactions`: the first
// rows to list; `moreTransactions`: true if there are more than that.
export function buildReport({ dashboard, transactions, moreTransactions, filtersText, generatedAt }) {
  // bufferPages: keep pages in memory until the end so "Page x of y" can be
  // written once the total is known. Bounded: the transaction list is capped.
  const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Title: 'Expense report' } });
  doc.fillColor(COLORS.text);

  header(doc, dashboard, filtersText, generatedAt);
  summaryBoxes(doc, dashboard.totals);

  const spending = dashboard.byCategory.filter((c) => c.debitPaise > 0).sort((a, b) => b.debitPaise - a.debitPaise);
  section(doc, 'Spending by category');
  if (spending.length === 0) note(doc, 'No money out in this period.');
  else barChart(doc, spending);

  section(doc, 'All categories');
  table(doc, [
    { header: 'Category', width: 215 },
    { header: 'Count', width: 50, align: 'right' },
    { header: 'Money in (Rs)', width: 125, align: 'right' },
    { header: 'Money out (Rs)', width: 125, align: 'right' },
  ], dashboard.byCategory.map((c) => [c.name, String(c.count), formatRupees(c.creditPaise), formatRupees(c.debitPaise)]));

  section(doc, 'By month');
  table(doc, [
    { header: 'Month', width: 115 },
    { header: 'Count', width: 50, align: 'right' },
    { header: 'Money in (Rs)', width: 115, align: 'right' },
    { header: 'Money out (Rs)', width: 115, align: 'right' },
    { header: 'Net (Rs)', width: 120, align: 'right' },
  ], dashboard.timeline.map((m) => [monthName(m.period), String(m.count), formatRupees(m.creditPaise), formatRupees(m.debitPaise), formatRupees(m.netPaise)]));

  if (dashboard.topMerchants.length > 0) {
    section(doc, 'Top merchants (money out)');
    table(doc, [
      { header: 'Merchant', width: 250 },
      { header: 'Category', width: 140 },
      { header: 'Count', width: 40, align: 'right' },
      { header: 'Total (Rs)', width: 85, align: 'right' },
    ], dashboard.topMerchants.map((m) => [m.merchantKey, CATEGORY.get(m.category)?.name ?? m.category, String(m.count), formatRupees(m.debitPaise)]));
  }

  section(doc, moreTransactions ? `Transactions (first ${transactions.length}; export CSV for all)` : 'Transactions');
  table(doc, [
    { header: 'Date', width: 62 },
    { header: 'Description', width: 228 },
    { header: 'Category', width: 95 },
    { header: 'Debit (Rs)', width: 65, align: 'right' },
    { header: 'Credit (Rs)', width: 65, align: 'right' },
  ], transactions.map((t) => [
    formatDate(t.date),
    t.description,
    CATEGORY.get(t.category)?.name ?? t.category,
    t.direction === 'debit' ? formatRupees(t.amountPaise) : '',
    t.direction === 'credit' ? formatRupees(t.amountPaise) : '',
  ]), { fontSize: 7.5 });

  pageNumbers(doc);
  doc.end();
  return doc; // a readable stream of PDF bytes
}

// ---------- sections ----------

function header(doc, dashboard, filtersText, generatedAt) {
  doc.font('Helvetica-Bold').fontSize(20).text('Expense report');
  const { from, to } = dashboard.period;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted);
  doc.text(from ? `${formatDate(from)} to ${formatDate(to)}` : 'No transactions match these filters');
  if (filtersText) doc.text(`Filters: ${filtersText}`);
  doc.text(`Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  doc.fillColor(COLORS.text).moveDown(1);
}

function summaryBoxes(doc, totals) {
  const boxes = [
    ['Money in', `Rs ${formatRupees(totals.creditPaise)}`, COLORS.credit],
    ['Money out', `Rs ${formatRupees(totals.debitPaise)}`, COLORS.debit],
    ['Net', `Rs ${formatRupees(totals.netPaise)}`, totals.netPaise < 0 ? COLORS.debit : COLORS.credit],
    ['Transactions', String(totals.count), COLORS.text],
  ];
  const width = (contentWidth(doc) - 3 * 10) / 4;
  const y = doc.y;
  boxes.forEach(([label, value, color], i) => {
    const x = doc.page.margins.left + i * (width + 10);
    doc.roundedRect(x, y, width, 46, 4).strokeColor(COLORS.line).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(label, x + 8, y + 8, { width: width - 16 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(color).text(value, x + 8, y + 22, { width: width - 16 });
  });
  doc.fillColor(COLORS.text);
  doc.x = doc.page.margins.left;
  doc.y = y + 60;
}

function barChart(doc, spending) {
  const max = spending[0].debitPaise;
  const labelWidth = 150;
  const amountWidth = 90;
  const barMax = contentWidth(doc) - labelWidth - amountWidth - 10;
  for (const c of spending) {
    ensureSpace(doc, 16);
    const y = doc.y;
    const x = doc.page.margins.left;
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(c.name, x, y, { width: labelWidth, lineBreak: false });
    doc.rect(x + labelWidth, y + 1, Math.max(1, (c.debitPaise / max) * barMax), 9).fillColor(COLORS.bar).fill();
    doc.fillColor(COLORS.text).text(formatRupees(c.debitPaise), x + labelWidth + barMax + 10, y, { width: amountWidth, align: 'right', lineBreak: false });
    doc.y = y + 15;
  }
  doc.x = doc.page.margins.left;
}

function section(doc, title) {
  ensureSpace(doc, 60);
  doc.moveDown(0.8);
  doc.x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text).text(title);
  doc.moveDown(0.3);
}

function note(doc, text) {
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(text).fillColor(COLORS.text);
}

// A simple table: one line per row (long text is cut with "…"), the header
// repeated on every new page.
function table(doc, columns, rows, { fontSize = 8.5 } = {}) {
  const rowHeight = fontSize + 6;
  const drawHeader = () => {
    drawRow(doc, columns, columns.map((c) => c.header), { font: 'Helvetica-Bold', fontSize, color: COLORS.muted });
    const y = doc.y - 2;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + contentWidth(doc), y).strokeColor(COLORS.line).stroke();
  };
  if (rows.length === 0) return note(doc, 'Nothing to show.');
  ensureSpace(doc, rowHeight * 3);
  drawHeader();
  for (const row of rows) {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }
    drawRow(doc, columns, row, { font: 'Helvetica', fontSize, color: COLORS.text });
  }
  doc.x = doc.page.margins.left;
}

function drawRow(doc, columns, cells, { font, fontSize, color }) {
  const y = doc.y;
  let x = doc.page.margins.left;
  doc.font(font).fontSize(fontSize).fillColor(color);
  columns.forEach((column, i) => {
    const text = fit(doc, pdfSafe(cells[i] ?? ''), column.width - 6);
    doc.text(text, x, y, { width: column.width - 6, align: column.align ?? 'left', lineBreak: false });
    x += column.width;
  });
  doc.x = doc.page.margins.left;
  doc.y = y + fontSize + 6;
}

function pageNumbers(doc) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing inside the margin must not add a page
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
      .text(`Page ${i + 1} of ${count}`, doc.page.margins.left, doc.page.height - 28, { width: contentWidth(doc), align: 'right' });
    doc.page.margins.bottom = bottom;
  }
}

// ---------- helpers ----------

function ensureSpace(doc, height) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

// Cuts text to fit the width, ending with "…".
function fit(doc, text, width) {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 0 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// The built-in fonts only cover Western European characters; anything else
// (₹, Devanagari) would print as junk, so it's shown as "?".
function pdfSafe(text) {
  return String(text).replace(/[^\x20-\x7E\xA0-\xFF…]/g, '?');
}

function monthName(periodStart) {
  const [year, month] = periodStart.split('-');
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
