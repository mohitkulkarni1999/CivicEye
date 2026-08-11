import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../lib/api.js';
import { EmptyState } from '../components/Spinner.jsx';
import Spinner from '../components/Spinner.jsx';
import { timeAgo } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import Skeleton, { SkeletonRows } from '../components/Skeleton.jsx';
import { BellIcon, SparklesIcon, CheckIcon } from '../components/icons.jsx';

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [digest, setDigest] = useState(null);
  const [digesting, setDigesting] = useState(false);
  const toast = useToast();

  const load = () => {
    http
      .get('/api/notifications')
      .then((d) => {
        setNotifs(d.notifications || []);
        setUnread(d.unread || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const markAll = async () => {
    await http.patch('/api/notifications/read-all');
    setDigest(null);
    load();
  };

  const markOne = async (id) => {
    await http.patch(`/api/notifications/${id}/read`);
    setDigest(null);
    load();
  };

  const summarize = async () => {
    setDigesting(true);
    try {
      const res = await http.post('/api/notifications/digest');
      setDigest(res.digest || 'No updates to summarize.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDigesting(false);
    }
  };

  if (loading) {
    return (
      <div className="container-page max-w-3xl py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-24" />
        <div className="mt-6"><SkeletonRows count={4} /></div>
      </div>
    );
  }

  return (
    <div className="container-page max-w-3xl py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink-900">
            <BellIcon size={22} className="text-brand-600" /> Notifications
          </h1>
          <p className="mt-1 text-sm text-ink-500">{unread} unread</p>
        </div>
        {unread > 0 && (
          <div className="flex gap-2">
            <button onClick={summarize} disabled={digesting} className="btn-primary text-sm">
              {digesting ? (
                <><Spinner className="h-4 w-4" /> Summarizing…</>
              ) : (
                <><SparklesIcon size={16} /> AI summary</>
              )}
            </button>
            <button onClick={markAll} className="btn-outline text-sm">
              <CheckIcon size={16} /> Mark all read
            </button>
          </div>
        )}
      </div>

      {digest && (
        <div className="mb-4 rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-800">
            <SparklesIcon size={16} /> AI summary
          </h3>
          <p className="mt-1 text-sm text-brand-900">{digest}</p>
        </div>
      )}

      {notifs.length === 0 ? (
        <EmptyState
          title="No notifications"
          body="Follow issues to get updates when they change."
          action={<Link to="/map" className="btn-primary mt-2">Browse the map</Link>}
        />
      ) : (
        <div className="space-y-2">
          {notifs.map((n) => (
            <button
              key={n.id}
              onClick={() => n.is_read || markOne(n.id)}
              className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition hover:bg-ink-50 ${
                n.is_read ? 'border-ink-200 bg-white' : 'border-brand-200 bg-brand-50'
              }`}
            >
              {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-900">{n.title}</p>
                {n.body && <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>}
                <p className="mt-1 text-xs text-ink-400">{timeAgo(n.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
