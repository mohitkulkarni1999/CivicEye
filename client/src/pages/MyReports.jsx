import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../lib/api.js';
import { StatusBadge } from '../components/Badges.jsx';
import { EmptyState } from '../components/Spinner.jsx';
import { timeAgo } from '../lib/format.js';
import Skeleton, { SkeletonRows } from '../components/Skeleton.jsx';
import { EyeIcon, PlusIcon } from '../components/icons.jsx';

export default function MyReports() {
  const [reported, setReported] = useState([]);
  const [confirmed, setConfirmed] = useState([]);
  const [tab, setTab] = useState('reported');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([http.get('/api/issues/my'), http.get('/api/issues/my/confirmed')])
      .then(([a, b]) => {
        setReported(a.issues || []);
        setConfirmed(b.issues || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container-page max-w-4xl py-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-6 flex gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="mt-6"><SkeletonRows count={4} /></div>
      </div>
    );
  }

  const list = tab === 'reported' ? reported : confirmed;

  return (
    <div className="container-page max-w-4xl py-8">
      <h1 className="text-2xl font-bold text-ink-900">My reports</h1>
      <p className="mt-1 text-sm text-ink-500">Everything you have reported or confirmed.</p>

      <div className="mt-6 flex gap-2">
        <button
          onClick={() => setTab('reported')}
          className={`btn ${tab === 'reported' ? 'btn-primary' : 'btn-outline'}`}
        >
          I reported ({reported.length})
        </button>
        <button
          onClick={() => setTab('confirmed')}
          className={`btn ${tab === 'confirmed' ? 'btn-primary' : 'btn-outline'}`}
        >
          I confirmed ({confirmed.length})
        </button>
      </div>

      {list.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={tab === 'reported' ? 'No reports yet' : 'No confirmations yet'}
            body={tab === 'reported' ? 'Spot something broken? Report it in under a minute.' : 'Head to the map and confirm issues you have seen.'}
            action={
              tab === 'reported' ? (
                <Link to="/report" className="btn-primary mt-2"><PlusIcon size={16} /> Report an issue</Link>
              ) : (
                <Link to="/map" className="btn-primary mt-2">Open the map</Link>
              )
            }
          />
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-ink-200 bg-white">
          {list.map((i) => (
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
  );
}
