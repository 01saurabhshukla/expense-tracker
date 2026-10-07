import { Link } from 'react-router';
import { ThemeToggle } from '../components/ThemeToggle.jsx';

// The home page for visitors who aren't logged in (logged-in users get the
// dashboard at "/"). Everything it promises is something the app really
// does; the example figures come from the sample HDFC statement.

const SAMPLE = {
  totals: [
    { label: 'Money in', value: '₹1,73,912.55' },
    { label: 'Money out', value: '₹1,22,304.34' },
    { label: 'Net', value: '+₹51,608.21', good: true },
  ],
  // [month, money out, money in] in rupees
  months: [
    ['Sep 2026', 86451.03, 88912.55],
    ['Oct 2026', 35853.31, 85000.0],
  ],
  categories: [
    ['Rent & Housing', 44000.0, '₹44,000.00'],
    ['Shopping', 28568.08, '₹28,568.08'],
    ['Bills & Utilities', 14017.25, '₹14,017.25'],
    ['Investments', 10000.0, '₹10,000.00'],
  ],
};

const STEPS = [
  ['Upload your statement', 'Drop a CSV or Excel export from your bank. Files are checked before they are stored, and processing runs in the background while you watch the progress.'],
  ['Review the categories', 'Food, groceries, fuel, bills, rent, salary and more are filled in for you. Correct one merchant once and it is remembered for every future upload.'],
  ['Understand and export', 'See money in and out by day, week or month, your top merchants and categories, then download the data as CSV or a PDF report.'],
];

const BANKS = ['HDFC', 'SBI', 'ICICI', 'Axis', 'Kotak'];

const SAFETY = [
  ['Encrypted in transit', 'Every page and API call uses HTTPS, and browsers are told never to fall back to plain HTTP.'],
  ['Only you see your data', 'Every request is checked against your account; another person’s statement simply does not exist for you.'],
  ['Passwords never stored', 'Only a slow bcrypt hash is kept. Repeated wrong logins are rate-limited.'],
  ['Short sessions', 'Sign-in tokens last 15 minutes and are kept out of reach of page scripts; logging out ends the session on every tab.'],
  ['Files checked first', 'Empty, corrupt or disguised files are refused before anything is saved, and uploaded statements are never public.'],
  ['Least access everywhere', 'The app’s own database account can only read and write rows — it cannot change or drop tables.'],
];

export function LandingPage() {
  const maxMonth = Math.max(...SAMPLE.months.flatMap(([, out, inn]) => [out, inn]));
  const maxCategory = SAMPLE.categories[0][1];

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-container landing-header-row">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" />
            Expense Tracker
          </Link>
          <nav className="landing-nav" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#banks">Banks</a>
            <a href="#privacy">Privacy &amp; security</a>
          </nav>
          <div className="landing-actions">
            <ThemeToggle />
            <Link to="/login" className="button ghost">Log in</Link>
            <Link to="/signup" className="button primary">Create account</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-container landing-hero">
          <div className="landing-hero-text">
            <p className="landing-badge">
              <ShieldIcon />
              Private by design — your statements are visible only to you
            </p>
            <h1>See where your money went — from one bank statement.</h1>
            <p className="landing-lead">
              Upload a CSV or Excel statement. Every transaction is sorted into categories, the running balance is
              checked row by row, and your spending is charted by day, week or month.
            </p>
            <div className="landing-ctas">
              <Link to="/signup" className="button primary large">Create a free account</Link>
              <a href="#how" className="button large">How it works</a>
            </div>
            <p className="muted landing-small">Works with HDFC, SBI, ICICI, Axis and Kotak exports · CSV or .xlsx up to 10 MB</p>
          </div>

          <figure className="landing-preview card" aria-label="Example dashboard for a sample statement">
            <div className="landing-preview-head">
              <strong>Dashboard</strong>
              <span className="muted">Sample statement · Sep–Oct 2026</span>
            </div>
            <div className="landing-preview-tiles">
              {SAMPLE.totals.map((t) => (
                <div key={t.label} className="landing-tile">
                  <div className="secondary">{t.label}</div>
                  <div className={t.good ? 'value good' : 'value'}>{t.value}</div>
                </div>
              ))}
            </div>
            <div className="legend" aria-hidden="true">
              <span><i style={{ background: 'var(--series-1)' }} />Money out</span>
              <span><i style={{ background: 'var(--series-2)' }} />Money in</span>
            </div>
            <div className="landing-bars">
              {SAMPLE.months.map(([month, out, inn]) => (
                <div key={month} className="landing-bar-group">
                  <div className="landing-bar-pair">
                    <span className="landing-bar out" style={{ height: `${(out / maxMonth) * 100}%` }} title={`${month}: money out`} />
                    <span className="landing-bar in" style={{ height: `${(inn / maxMonth) * 100}%` }} title={`${month}: money in`} />
                  </div>
                  <span className="muted">{month}</span>
                </div>
              ))}
            </div>
            <div className="landing-cats">
              {SAMPLE.categories.map(([name, value, label]) => (
                <div key={name} className="bar-row">
                  <span>{name}</span>
                  <div className="bar-track" aria-hidden="true">
                    <div className="bar-fill" style={{ width: `${(value / maxCategory) * 100}%` }} />
                  </div>
                  <span className="num secondary">{label}</span>
                </div>
              ))}
            </div>
          </figure>
        </section>

        <section id="how" className="landing-band">
          <div className="landing-container">
            <h2>How it works</h2>
            <p className="landing-sub">Three steps, a few minutes, no spreadsheets.</p>
            <ol className="landing-steps">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="landing-step">
                  <span className="landing-step-number" aria-hidden="true">{i + 1}</span>
                  <h3>{title}</h3>
                  <p className="secondary">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="banks" className="landing-container landing-split">
          <div>
            <h2>Your bank’s export, as it is</h2>
            <p className="landing-sub">
              Download the statement from net banking and upload it unchanged. Overlapping statements are fine —
              transactions already imported are recognised and skipped, never counted twice.
            </p>
          </div>
          <ul className="landing-banks" aria-label="Supported banks">
            {BANKS.map((bank) => (
              <li key={bank}>{bank}</li>
            ))}
          </ul>
        </section>

        <section id="privacy" className="landing-band">
          <div className="landing-container">
            <h2>Built for personal financial data</h2>
            <p className="landing-sub">A bank statement says a lot about you. Here is exactly how this app protects it.</p>
            <ul className="landing-safety">
              {SAFETY.map(([title, text]) => (
                <li key={title}>
                  <span className="landing-check" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <span className="secondary">{text}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-container landing-final">
          <h2>Know your month in minutes.</h2>
          <p className="landing-sub">Create an account, upload last month’s statement, and see the breakdown before your coffee gets cold.</p>
          <div className="landing-ctas center">
            <Link to="/signup" className="button primary large">Create a free account</Link>
            <Link to="/login" className="button large">I already have one</Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-row muted">
          <span>Expense Tracker · a personal finance project</span>
          <span>Light or dark: use the button at the top — your choice is remembered on this device.</span>
        </div>
      </footer>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
