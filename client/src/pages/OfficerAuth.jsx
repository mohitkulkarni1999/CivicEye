import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth, dashboardPath } from '../lib/auth.jsx';
import { PageLoader } from '../components/Spinner.jsx';
import { BrandMark } from '../components/Navbar.jsx';

export default function OfficerAuth() {
  const { login, logout, isAuthed, user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <PageLoader />;
  if (isAuthed) return <Navigate to={dashboardPath(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(email, password);
      if (!['officer', 'moderator', 'admin'].includes(u.role)) {
        logout();
        setError('This portal is for city staff only. Sign in as a citizen instead.');
        return;
      }
      navigate('/officer/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page flex justify-center py-12">
      <div className="w-full max-w-md">
        <div className="card p-8">
          <div className="mb-6 text-center">
            <BrandMark className="mx-auto h-12 w-12" />
            <h1 className="mt-3 text-xl font-bold text-ink-900">Officer portal</h1>
            <p className="mt-1 text-sm text-ink-500">Sign in to manage and resolve civic issues.</p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input" placeholder="you@city.gov" />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="input" placeholder="••••••••" />
            </div>
            <button disabled={busy} className="btn-primary w-full">{busy ? 'Please wait…' : 'Log in'}</button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-ink-400">
          Citizens sign in <Link to="/citizen/login" className="text-brand-600 hover:underline">here</Link>. Officers are provisioned by an administrator.
        </p>
      </div>
    </div>
  );
}
