import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { StatusBadge } from '../components/Badges.jsx';
import { EmptyState } from '../components/Spinner.jsx';
import { timeAgo } from '../lib/format.js';
import Skeleton, { SkeletonRows } from '../components/Skeleton.jsx';
import { PlusIcon, FolderIcon, BellIcon, EyeIcon, ArrowRightIcon, MapPinIcon } from '../components/icons.jsx';

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
      <div className="min-h-screen bg-ink-50">
        <div className="container-page max-w-4xl py-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-4 w-72" />
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <div className="mt-6"><SkeletonRows count={3} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg,#f0f4ff 0%,#f8fafc 100%)' }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg,#1e3a5f 0%,#1a56db 100%)' }} className="py-8 text-white">
        <div className="container-page max-w-4xl">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-2xl shadow-inner">
              👤
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight">Citizen Portal</h1>
              <p className="text-sm text-blue-200">
                Welcome back, <span className="font-bold text-white">{user?.name}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container-page max-w-4xl py-8 space-y-8">

        {/* ── Quick Action Cards ── */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Link
            to="/report"
            className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 text-white backdrop-blur">
                <PlusIcon size={20} />
              </span>
              <ArrowRightIcon size={16} className="text-white/60 transition group-hover:translate-x-1 group-hover:text-white" />
            </div>
            <p className="mt-4 text-base font-bold">Report an issue</p>
            <p className="mt-0.5 text-xs text-blue-100">Upload photos, video, voice & pin location</p>
          </Link>

          <Link
            to="/my-reports"
            className="group relative overflow-hidden rounded-2xl border border-ink-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <FolderIcon size={20} />
              </span>
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-extrabold text-blue-700">
                {reported.length}
              </span>
            </div>
            <p className="mt-4 text-base font-bold text-ink-900">My reports</p>
            <p className="mt-0.5 text-xs text-ink-400">View status & track progress</p>
          </Link>

          <Link
            to="/notifications"
            className="group relative overflow-hidden rounded-2xl border border-ink-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <BellIcon size={20} />
              </span>
              <ArrowRightIcon size={16} className="text-ink-300 transition group-hover:translate-x-1 group-hover:text-ink-600" />
            </div>
            <p className="mt-4 text-base font-bold text-ink-900">Notifications</p>
            <p className="mt-0.5 text-xs text-ink-400">Followed issues & updates</p>
          </Link>
        </div>

        {/* ── Recent Reports ── */}
        <div className="rounded-2xl border border-ink-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4">
            <div>
              <h2 className="font-bold text-ink-900 text-lg">My Recent Reports</h2>
              <p className="text-xs text-ink-400">Track resolution progress in real time</p>
            </div>
            {reported.length > 0 && (
              <Link to="/my-reports" className="text-xs font-bold text-blue-600 hover:underline">
                View all ({reported.length}) →
              </Link>
            )}
          </div>

          {reported.length === 0 ? (
            <div className="p-12">
              <EmptyState
                title="No reports submitted yet"
                body="Spotted a pothole, broken streetlight, or garbage pile? Submit a report in under a minute."
                action={
                  <Link to="/report" className="btn-primary mt-3 inline-flex items-center gap-2">
                    <PlusIcon size={16} /> Report issue now
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-ink-100">
              {reported.slice(0, 8).map((i) => (
                <Link
                  key={i.id}
                  to={`/issues/${i.public_id}`}
                  className="flex items-center gap-4 px-6 py-4 transition hover:bg-blue-50/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-blue-600">#{i.public_id}</span>
                      <p className="truncate font-bold text-ink-900">{i.title}</p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 font-semibold text-ink-600">
                        {i.category_name}
                      </span>
                      {i.area && (
                        <span className="flex items-center gap-1">
                          <MapPinIcon size={11} /> {i.area}
                        </span>
                      )}
                      <span>{timeAgo(i.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="flex items-center gap-1 text-xs text-ink-400">
                      <EyeIcon size={13} /> {i.confirmations ?? 0}
                    </span>
                    <StatusBadge status={i.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
