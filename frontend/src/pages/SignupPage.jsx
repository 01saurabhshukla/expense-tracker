import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { signup } from '../api/endpoints.js';
import { ErrorAlert, asApiError } from '../components/ErrorAlert.jsx';
import { fieldErrors } from '../components/FieldErrors.js';
import { ThemeToggle } from '../components/ThemeToggle.jsx';

export function SignupPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signup(form);
      navigate('/login', { state: { signedUp: true, email: form.email } });
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const errors = fieldErrors(error);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <div className="auth-page">
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <div className="card auth-card">
        <div>
          <h1>Create an account</h1>
          <p className="secondary">Upload bank statements; we sort every transaction into categories.</p>
        </div>
        {error && !Object.keys(errors).length && <ErrorAlert error={error} />}
        <form onSubmit={submit} noValidate>
          <label className="field">
            Name
            <input autoComplete="name" required maxLength={100} value={form.name} onChange={set('name')} />
            {errors.name && <span className="field-error">{errors.name}</span>}
          </label>
          <label className="field">
            Email
            <input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
            {errors.email && <span className="field-error">{errors.email}</span>}
          </label>
          <label className="field">
            Password
            <input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} aria-describedby="password-hint" />
            <span id="password-hint" className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>At least 8 characters.</span>
            {errors.password && <span className="field-error">{errors.password}</span>}
          </label>
          <button type="submit" className="primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="secondary">Already have an account? <Link to="/login">Log in</Link></p>
      </div>
    </div>
  );
}
