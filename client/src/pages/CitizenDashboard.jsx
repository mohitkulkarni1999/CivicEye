import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { StatusBadge } from '../components/Badges.jsx';
import { EmptyState } from '../components/Spinner.jsx';
import { timeAgo } from '../lib/format.js';
import Skeleton, { SkeletonRows } from '../components/Skeleton.jsx';
import { PlusIcon, FolderIcon, BellIcon, EyeIcon } from '../components/icons.jsx';

export default function CitizenDashboard() {
  const { user } = useAuth();
  const [reported, setReported] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    http
      .get('/api/issues/my')
      .then((a) => setReported(a.issues || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container-page max-w-4xl py-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <div className="mt-6"><SkeletonRows count={3} /></div>
      </div>
    );
  }

  return (
    <div className="container-page max-w-4xl py-8">
      <h1 className="text-2xl font-bold text-ink-900">My dashboard</h1>
      <p className="mt-1 text-sm text-ink-500">
        Welcome, <span className="font-semibold text-ink-700">{user?.name}</span>. Track the issues you care about.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Link to="/report" className="card group flex items-center gap-3 p-4 transition hover:border-brand-300">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <PlusIcon size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink-900">Report an issue</span>
            <span className="block text-xs text-ink-500">With photo, video, audio & GPS</span>
          </span>
        </Link>
        <Link to="/my-reports" className="card group flex items-center gap-3 p-4 transition hover:border-brand-300">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-100 text-ink-600">
            <FolderIcon size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink-900">My reports</span>
            <span className="block text-xs text-ink-500">{reported.length} reported</span>
          </span>
        </Link>
        <Link to="/notifications" className="card group flex items-center gap-3 p-4 transition hover:border-brand-300">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <BellIcon size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink-900">Notifications</span>
            <span className="block text-xs text-ink-500">Followed issues & updates</span>
          </span>
        </Link>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 font-semibold text-ink-900">Recent reports</h2>
        {reported.length === 0 ? (
          <div className="card">
            <EmptyState
              title="No reports yet"
              body="Spot something broken? Report it in under a minute."
              action={
                <Link to="/report" className="btn-primary mt-2"><PlusIcon size={16} /> Report an issue</Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
            {reported.slice(0, 8).map((i) => (
              <Link
                key={i.id}
                to={`/issues/${i.public_id}`}
                className="flex items-center gap-4 border-b border-ink-100 p-4 transition last:border-0 hover:bg-ink-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink-900">{i.title}</p>
                  <p className="text-xs text-ink-500">
                    #{i.public_id} · {i.category_name} · {timeAgo(i.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1"><EyeIcon size={14} className="text-ink-400" /> {i.confirmations ?? 0}</span>
                  <StatusBadge status={i.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
