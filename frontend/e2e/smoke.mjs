// End-to-end smoke test: drives the real app in Chrome, start to finish.
//
// Needs the backend API + worker and the frontend running, e.g.
//   cd backend && npm run dev            (another terminal) npm run dev:worker
//   cd frontend && npm run dev           (or: npm run build && npm run preview -- --port 5173)
//   cd frontend && npm run e2e
//
// Settings (environment variables):
//   E2E_BASE_URL  the frontend (default http://localhost:5173)
//   CHROME_PATH   a Chrome/Chromium binary (default /usr/bin/google-chrome)
//   E2E_SHOTS     a folder for screenshots (default: none taken)
//
// Each run signs up 2 new users from your IP; the backend allows 5 sign-ups
// per hour per IP. To run it repeatedly, start the backend with
// RATE_LIMIT_ENABLED=false.
//
// Each run signs up NEW users (…@e2e.example.test) and uploads the sample
// statements. Remove them afterwards with:
//   DELETE FROM users WHERE email LIKE '%@e2e.example.test';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const OUT = process.env.E2E_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
const FIXTURES = fileURLToPath(new URL('../../backend/tests/fixtures/statements/', import.meta.url));
const PASSWORD = 'correct-horse-battery';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true });
// 4xx answers are part of the flow (short password, duplicate file, checking
// the session while logged out); only page crashes and 5xx are problems.
const problems = [];
const watch = (page) => {
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('response', (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url()}`));
};
const shot = (page, name) => OUT && page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const step = (name) => console.log(`✓ ${name}`);

async function signUpAndLogIn(page, email) {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel('Name').fill('E2E Test');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Account created').waitFor();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  watch(page);

  // ---- landing page and theme (logged out) ----
  await page.goto(`${BASE}/`);
  await page.getByRole('heading', { level: 1, name: /See where your money went/ }).waitFor();
  await shot(page, '00-landing-light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Switch to light theme' }).waitFor(); // still dark after reload
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') throw new Error('dark theme not remembered');
  await shot(page, '00-landing-dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  step('landing page; theme switch remembered across a reload');

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${BASE}/`);
  await phone.getByRole('heading', { level: 1, name: /See where your money went/ }).waitFor();
  const landingOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (landingOverflow > 0) throw new Error(`the landing page scrolls sideways on a phone (${landingOverflow}px)`);
  const cramped = await phone.$$eval('.landing-tile', (els) => els.filter((e) => e.querySelector('.value').scrollWidth > e.clientWidth).length);
  if (cramped > 0) throw new Error(`${cramped} amount(s) overflow their tile on a phone`);
  await shot(phone, '00-landing-phone');
  await phone.close();
  step('landing page at phone width: no sideways scrolling');

  // ---- sign up: the backend's validation message reaches the field ----
  await page.getByRole('link', { name: 'Create account' }).click();
  await page.waitForURL(/\/signup$/);
  await page.getByLabel('Name').fill('E2E Test');
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@e2e.example.test`);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Password must be at least 8 characters').waitFor();
  step('signup shows the field error from the backend');

  await signUpAndLogIn(page, `e2e-${Date.now()}@e2e.example.test`);
  await page.getByText('No transactions yet').waitFor();
  step('signup → login → empty dashboard');

  // ---- uploads ----
  await page.getByRole('link', { name: 'Upload a statement' }).click();
  await page.locator('input[type=file]').setInputFiles(
    ['hdfc_sep2026.csv', 'edge_hdfc_overlap_15sep_06oct.csv', 'xlsx/sbi_sep2026.xlsx', 'edge_malformed_rows.csv'].map((f) => FIXTURES + f),
  );
  await page.getByText('Uploaded · view progress').nth(3).waitFor({ timeout: 30_000 });
  step('4 files uploaded (CSV and Excel)');

  await page.locator('input[type=file]').setInputFiles([`${FIXTURES}hdfc_sep2026.csv`]);
  await page.getByText('You have already uploaded this exact file.').waitFor();
  step('the same file again is refused, with a link to the first upload');

  await page.waitForFunction(() => [...document.querySelectorAll('.badge')].filter((b) => b.textContent === 'Done').length >= 4, null, { timeout: 60_000 });
  step('all 4 processed in the background (list polled until Done)');
  await shot(page, '01-uploads');

  await page.getByRole('link', { name: 'edge_malformed_rows.csv' }).click();
  await page.getByText("The running balance doesn't add up").waitFor();
  await page.getByText("Rows we couldn't read").waitFor();
  step('upload report: balance warning and problem rows');

  // ---- dashboard ----
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByText('Spending by category').waitFor();
  await page.locator('.recharts-bar-rectangle').first().waitFor();
  await shot(page, '02-dashboard');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.waitForURL(/granularity=week/);
  await page.getByRole('button', { name: 'Show as table' }).click();
  await page.getByRole('cell', { name: '31 Aug', exact: true }).waitFor();
  step('dashboard: chart, weekly grouping, table view');

  await page.locator('.donut svg').first().waitFor();
  await page.getByText('Biggest single payment').waitFor();
  const amounts = async () => (await page.locator('.bar-row .num').allTextContents()).map((t) => Number(t.replace(/[^\d.]/g, '').split('.').slice(0, 2).join('.')));
  const highestFirst = await amounts();
  await page.getByRole('group', { name: 'Sort categories by spending' }).getByRole('button', { name: 'Lowest first' }).click();
  const lowestFirst = await amounts();
  if (highestFirst[0] < highestFirst.at(-1) || lowestFirst[0] > lowestFirst.at(-1)) throw new Error('category sort did not switch order');
  step('pies, "at a glance" and highest/lowest sorting');

  // ---- correction ----
  await page.getByRole('link', { name: 'Transactions' }).click();
  await page.getByLabel('Search').fill('chai point');
  // Wait for the filtered rows, not just the URL: the old list is shown
  // (faded) until the new one arrives.
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    return rows.length > 0 && rows.every((tr) => tr.textContent.includes('CHAI POINT'));
  });
  const rows = await page.locator('tbody tr').count();
  await page.locator('tbody tr').first().getByRole('button').click();
  await page.getByRole('dialog').getByLabel('Category').selectOption('groceries');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByText(/Updated \d+ transactions from chaipoint@ybl/).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].every((tr) => tr.textContent.includes('Groceries') && tr.textContent.includes('You')));
  step(`correction applied to the merchant: all ${rows} rows now Groceries`);
  await shot(page, '03-transactions');

  await page.getByRole('link', { name: 'Rules' }).click();
  await page.getByRole('cell', { name: 'chaipoint@ybl', exact: true }).waitFor();
  step('the rule is listed');

  // ---- exports ----
  await page.goto(`${BASE}/transactions`);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF report' }).click()]);
  step(`exports: ${csv.suggestedFilename()}, ${pdf.suggestedFilename()}`);

  // ---- session ----
  await page.reload();
  await page.getByRole('heading', { name: 'Transactions' }).waitFor();
  step('a reload keeps the session (refresh cookie)');

  const tabs = await Promise.all([1, 2, 3].map(() => context.newPage()));
  await Promise.all(tabs.map((t) => t.goto(`${BASE}/`)));
  const states = await Promise.all(tabs.map((t) => t.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 15_000 }).then(() => true, () => false)));
  if (!states.every(Boolean)) throw new Error('a tab was logged out when several tabs refreshed at once');
  step('3 tabs opened at once all stay logged in (refreshes take turns)');
  await Promise.all(tabs.map((t) => t.close()));

  // ---- layout ----
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${BASE}/`);
  await mobile.locator('.recharts-bar-rectangle').first().waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`the page scrolls sideways on a phone (${overflow}px)`);
  step('phone width: no sideways scrolling');
  await shot(mobile, '04-mobile');
  await mobile.close();

  const dark = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', storageState: await context.storageState() });
  const darkPage = await dark.newPage();
  await darkPage.goto(`${BASE}/`);
  await darkPage.locator('.recharts-bar-rectangle').first().waitFor();
  await shot(darkPage, '05-dark');
  step('dark mode renders');
  await dark.close();

  // ---- logout ----
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByRole('heading', { name: 'Log in' }).waitFor();
  await page.goto(`${BASE}/`);
  await page.getByRole('heading', { level: 1, name: /See where your money went/ }).waitFor();
  await page.goto(`${BASE}/transactions`);
  await page.getByRole('heading', { name: 'Log in' }).waitFor();
  step('logout; "/" is the landing page again and protected pages go to login');
} catch (err) {
  process.exitCode = 1;
  console.log('✗ FAILED:', err.message.split('\n')[0]);
} finally {
  if (problems.length) process.exitCode = 1;
  console.log(problems.length ? `problems:\n${problems.join('\n')}` : 'no page errors, no 5xx');
  await browser.close();
}
