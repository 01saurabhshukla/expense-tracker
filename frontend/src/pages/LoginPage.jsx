import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';
import { ErrorAlert, asApiError } from '../components/ErrorAlert.jsx';
import { fieldErrors } from '../components/FieldErrors.js';

export function LoginPage() {
  const { status, login, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: location.state?.email ?? '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to={location.state?.from ?? '/'} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(form);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const errors = fieldErrors(error);
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div>
          <h1>Log in</h1>
          <p className="secondary">See where your money goes.</p>
        </div>
        {location.state?.signedUp && <div className="alert success">Account created. Log in to continue.</div>}
        {notice && !error && <div className="alert warning">{notice}</div>}
        {error && !Object.keys(errors).length && <ErrorAlert error={error} />}
        <form onSubmit={submit} noValidate>
          <label className="field">
            Email
            <input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {errors.email && <span className="field-error">{errors.email}</span>}
          </label>
          <label className="field">
            Password
            <input type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            {errors.password && <span className="field-error">{errors.password}</span>}
          </label>
          <button type="submit" className="primary" disabled={submitting}>{submitting ? 'Logging in…' : 'Log in'}</button>
        </form>
        <p className="secondary">No account? <Link to="/signup">Create one</Link></p>
      </div>
    </div>
  );
}
