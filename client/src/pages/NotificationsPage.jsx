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
  const [autoTriggered, setAutoTriggered] = useState(false);
  const toast = useToast();

  const summarize = async () => {
    if (digesting) return;
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

  const load = () => {
    http
      .get('/api/notifications')
      .then((d) => {
        const list = d.notifications || [];
        const unreadCount = d.unread || 0;
        setNotifs(list);
        setUnread(unreadCount);
        // Auto-trigger AI digest if 3+ unread on first load
        if (unreadCount >= 3 && !autoTriggered) {
          setAutoTriggered(true);
          summarize();
        }
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
    load();
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
          <p className="mt-1 text-sm text-ink-500">
            {unread > 0 ? (
              <span className="font-semibold text-brand-700">{unread} unread</span>
            ) : (
              'All caught up!'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={summarize}
            disabled={digesting || notifs.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-sm font-bold text-white shadow transition hover:opacity-90 disabled:opacity-50"
          >
            {digesting ? (
              <><Spinner className="h-4 w-4" /> Summarizing…</>
            ) : (
              <><SparklesIcon size={15} /> AI summary</>
            )}
          </button>
          {unread > 0 && (
            <button onClick={markAll} className="btn-outline text-sm">
              <CheckIcon size={16} /> Mark all read
            </button>
          )}
        </div>
      </div>

      {/* AI Digest Card */}
      {(digest || digesting) && (
        <div className="mb-5 overflow-hidden rounded-2xl shadow-md">
          <div
            className="flex items-center gap-2 px-4 py-3 text-white"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#1a56db)' }}
          >
            <SparklesIcon size={16} />
            <p className="text-sm font-bold">AI Notification Summary</p>
            {digest && (
              <button onClick={() => setDigest(null)} className="ml-auto text-[11px] text-white/70 hover:text-white">
                Dismiss
              </button>
            )}
          </div>
          <div className="bg-violet-50 px-4 py-3">
            {digesting ? (
              <div className="flex items-center gap-2 text-sm text-violet-600">
                <Spinner className="h-4 w-4" /> Generating summary…
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-ink-800">{digest}</p>
            )}
          </div>
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
              onClick={() => !n.is_read && markOne(n.id)}
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
