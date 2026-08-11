import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth, dashboardPath } from '../lib/auth.jsx';
import { PageLoader } from '../components/Spinner.jsx';
import { BrandMark } from '../components/Navbar.jsx';

export default function Auth({ defaultMode = 'login' }) {
  const { login, register, isAuthed, user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState(defaultMode === 'register' ? 'register' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <PageLoader />;
  if (isAuthed) return <Navigate to={dashboardPath(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const u = mode === 'login' ? await login(email, password) : await register({ name, email, password });
      navigate(dashboardPath(u), { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m) => {
    setMode(m);
    setError('');
    navigate(m === 'register' ? '/citizen/register' : '/citizen/login', { replace: true });
  };

  const input = 'input';

  return (
    <div className="container-page flex justify-center py-12">
      <div className="w-full max-w-md">
        <div className="card p-8">
          <div className="mb-6 text-center">
            <BrandMark className="mx-auto h-12 w-12" />
            <h1 className="mt-3 text-xl font-bold text-ink-900">
              {mode === 'login' ? 'Welcome back' : 'Create your citizen account'}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {mode === 'login' ? 'Log in to report and track civic issues.' : 'Join the community that fixes your city.'}
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 rounded-xl bg-ink-100 p-1">
            {['login', 'register'].map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`rounded-lg py-2 text-sm font-semibold transition ${
                  mode === m ? 'bg-white text-ink-900 shadow' : 'text-ink-500'
                }`}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="label">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className={input} placeholder="Your name" />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={input} placeholder="you@example.com" />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 8 : 1}
                className={input}
                placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              />
            </div>
            {mode === 'register' && (
              <div>
                <label className="label">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  className={input}
                  placeholder="Repeat your password"
                />
              </div>
            )}
            <button disabled={busy} className="btn-primary w-full">
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create citizen account'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-ink-400">
            {mode === 'login' ? 'New to CivicEye? ' : 'Already have a citizen account? '}
            <button onClick={() => switchMode(mode === 'login' ? 'register' : 'login')} className="font-semibold text-brand-600 hover:underline">
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-ink-400">
          City staff? Use the <Link to="/officer/login" className="text-brand-600 hover:underline">officer portal</Link> or{' '}
          <Link to="/admin/login" className="text-brand-600 hover:underline">admin portal</Link>.
        </p>
      </div>
    </div>
  );
}
