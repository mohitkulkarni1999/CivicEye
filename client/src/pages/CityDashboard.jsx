import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../lib/api.js';
import { numberCompact, daysOpenLabel } from '../lib/format.js';
import { SeverityBadge, StatusBadge } from '../components/Badges.jsx';
import Skeleton, { SkeletonStats, SkeletonRows } from '../components/Skeleton.jsx';
import { MapIcon, ClockIcon, CheckIcon, FolderIcon, FlameIcon, SparklesIcon, ArrowRightIcon } from '../components/icons.jsx';

/* ─── Mini bar chart row ─── */
function BarRow({ label, total, open, resolved, color }) {
  const t = Math.max(total, 1);
  const openPct = Math.round((open / t) * 100);
  const resPct = Math.round((resolved / t) * 100);
  return (
    <div className="group">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-semibold text-ink-800">{label}</span>
        <span className="text-xs text-ink-400">{total} total</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-ink-100">
        <div className="flex h-full gap-px">
          <div
            style={{ width: `${openPct}%`, backgroundColor: color || '#f97316' }}
            title={`${open} open`}
            className="transition-all duration-700"
          />
          <div
            style={{ width: `${resPct}%`, backgroundColor: '#10b981' }}
            title={`${resolved} resolved`}
            className="transition-all duration-700"
          />
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-400">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-orange-400" /> {open} open
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> {resolved} resolved
        </span>
      </div>
    </div>
  );
}

/* ─── Stat card ─── */
function StatCard({ label, value, sub, emoji, gradient, textColor }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 shadow-sm ${gradient}`}>
      <div className="pointer-events-none absolute -right-4 -top-4 text-7xl opacity-10 select-none">{emoji}</div>
      <p className={`text-3xl font-black leading-none ${textColor}`}>{value}</p>
      <p className={`mt-1.5 text-sm font-bold ${textColor} opacity-80`}>{label}</p>
      {sub && <p className={`mt-0.5 text-xs ${textColor} opacity-60`}>{sub}</p>}
    </div>
  );
}

export default function CityDashboard() {
  const [stats, setStats] = useState(null);
  const [cats, setCats] = useState([]);
  const [depts, setDepts] = useState([]);
  const [areas, setAreas] = useState([]);
  const [longest, setLongest] = useState([]);
  const [recent, setRecent] = useState([]);
  const [trend, setTrend] = useState([]);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      http.get('/api/city/stats'),
      http.get('/api/city/categories'),
      http.get('/api/city/departments'),
      http.get('/api/city/areas'),
      http.get('/api/city/longest', { limit: 8 }),
      http.get('/api/city/recent-resolved', { limit: 8 }),
      http.get('/api/city/trend', { days: 30 }),
      http.get('/api/city/insights').catch(() => null),
    ])
      .then(([s, c, d, a, l, r, t, ins]) => {
        setStats(s.stats);
        setCats(c.categories || []);
        setDepts(d.departments || []);
        setAreas(a.areas || []);
        setLongest(l.issues || []);
        setRecent(r.issues || []);
        setTrend(t.trend || []);
        setInsights(ins);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-50">
        <div className="container-page py-8">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="mt-2 h-4 w-80" />
          <div className="mt-6"><SkeletonStats count={4} /></div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="card p-5"><Skeleton className="h-5 w-60" /><Skeleton className="mt-4 h-40 w-full" /></div>
            <div className="card p-5"><Skeleton className="h-5 w-48" /><Skeleton className="mt-4 h-40 w-full" /></div>
          </div>
          <div className="mt-6"><SkeletonRows count={4} /></div>
        </div>
      </div>
    );
  }

  const maxTrend = Math.max(1, ...trend.map((d) => Math.max(d.reported, d.resolved)));
  const maxArea = Math.max(1, ...areas.map((a) => a.total));

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg,#f0f7ff 0%,#f8fafc 100%)' }}>

      {/* ── Page Header ── */}
      <div style={{ background: 'linear-gradient(135deg,#1e3a5f 0%,#1a56db 100%)' }} className="py-8 text-white">
        <div className="container-page flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 text-xl">🏙️</span>
              <div>
                <h1 className="text-2xl font-black tracking-tight">City Dashboard</h1>
                <p className="text-sm text-blue-200">Live overview of civic issues in Pune</p>
              </div>
            </div>
          </div>
          <Link to="/map" className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20">
            <MapIcon size={16} /> Open live map
          </Link>
        </div>
      </div>

      <div className="container-page py-8 space-y-8">

        {/* ── Stats ── */}
        {stats && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Total reports"
              value={numberCompact(stats.total)}
              sub={`${numberCompact(stats.reporters)} reporters`}
              emoji="📋"
              gradient="bg-gradient-to-br from-slate-700 to-slate-900"
              textColor="text-white"
            />
            <StatCard
              label="Open issues"
              value={numberCompact(stats.open)}
              sub={`${stats.critical} critical`}
              emoji="🔥"
              gradient="bg-gradient-to-br from-orange-500 to-red-600"
              textColor="text-white"
            />
            <StatCard
              label="Resolved"
              value={numberCompact(stats.resolved)}
              sub={`${stats.resolvedThisMonth} this month`}
              emoji="✅"
              gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
              textColor="text-white"
            />
            <StatCard
              label="Avg fix time"
              value={`${Math.round(stats.avgResolutionDays)}d`}
              sub={`${numberCompact(stats.participants)} participants`}
              emoji="⚡"
              gradient="bg-gradient-to-br from-blue-500 to-indigo-600"
              textColor="text-white"
            />
          </div>
        )}

        {/* ── AI Insights ── */}
        {insights && (insights.summary || insights.note) && (
          <div className="overflow-hidden rounded-2xl shadow-md">
            <div
              className="flex items-center gap-2 px-5 py-3 text-white"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#1a56db)' }}
            >
              <SparklesIcon size={16} />
              <p className="font-bold">AI City Insights</p>
              {insights.summaryProvider && (
                <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  {insights.summaryProvider === 'heuristic' ? 'Local analysis' : 'Gemini AI'}
                </span>
              )}
            </div>
            <div className="bg-violet-50 px-5 py-4">
              <p className="text-sm leading-relaxed text-ink-800">{insights.summary || insights.note}</p>
            </div>
          </div>
        )}

        {/* ── Trend Chart + Top Areas ── */}
        <div className="grid gap-6 lg:grid-cols-2">

          {/* Trend bar chart */}
          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
            <h3 className="mb-1 font-bold text-ink-900">Reports & resolutions</h3>
            <p className="mb-5 text-xs text-ink-400">Last 30 days</p>
            <div className="flex h-44 items-end gap-1">
              {trend.map((d, idx) => (
                <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end gap-0.5" title={d.day}>
                  <div
                    className="w-full rounded-t-sm bg-orange-400 transition-all duration-300 group-hover:bg-orange-500"
                    style={{ height: `${(d.reported / maxTrend) * 100}%` }}
                  />
                  <div
                    className="w-full rounded-t-sm bg-emerald-500 transition-all duration-300 group-hover:bg-emerald-600"
                    style={{ height: `${(d.resolved / maxTrend) * 100}%` }}
                  />
                  {idx % 7 === 0 && (
                    <span className="absolute -bottom-5 text-[9px] text-ink-300 rotate-[-30deg] origin-top-left">
                      {d.day?.slice(5)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-8 flex gap-4 text-xs text-ink-400">
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-orange-400" /> Reported</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-emerald-500" /> Resolved</span>
            </div>
          </div>

          {/* Top areas */}
          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
            <h3 className="mb-1 font-bold text-ink-900">Top areas by reports</h3>
            <p className="mb-5 text-xs text-ink-400">Sorted by volume</p>
            <div className="space-y-4">
              {areas.slice(0, 6).map((a, i) => (
                <div key={a.area}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-semibold text-ink-800">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-black text-brand-700">
                        {i + 1}
                      </span>
                      {a.area}
                    </span>
                    <span className="text-xs text-ink-400">{a.total} · priority {a.avg_priority}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all duration-700"
                      style={{ width: `${(a.total / maxArea) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By category */}
          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
            <h3 className="mb-1 font-bold text-ink-900">By category</h3>
            <p className="mb-5 text-xs text-ink-400">Open vs resolved breakdown</p>
            <div className="space-y-4">
              {cats.slice(0, 8).map((c) => (
                <BarRow key={c.slug} label={c.label} total={c.total} open={c.open} resolved={c.resolved} color={c.color} />
              ))}
            </div>
          </div>

          {/* By department */}
          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
            <h3 className="mb-1 font-bold text-ink-900">By department</h3>
            <p className="mb-5 text-xs text-ink-400">Workload distribution</p>
            <div className="space-y-4">
              {depts.slice(0, 7).map((d) => (
                <BarRow key={d.slug} label={d.label} total={d.total} open={d.open} resolved={d.resolved} color="#6366f1" />
              ))}
            </div>
          </div>
        </div>

        {/* ── Longest open + Recently resolved ── */}
        <div className="grid gap-6 lg:grid-cols-2">

          {/* Longest open */}
          <div className="rounded-2xl border border-ink-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
              <div>
                <h3 className="flex items-center gap-2 font-bold text-ink-900">
                  <ClockIcon size={17} className="text-red-400" /> Longest open issues
                </h3>
                <p className="mt-0.5 text-xs text-ink-400">Needs immediate attention</p>
              </div>
              <Link to="/explore?sort=oldest" className="text-xs font-bold text-brand-600 hover:underline">
                See all <ArrowRightIcon size={12} className="inline" />
              </Link>
            </div>
            <div className="divide-y divide-ink-50">
              {longest.map((i) => (
                <Link
                  key={i.public_id}
                  to={`/issues/${i.public_id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition hover:bg-ink-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-800">{i.title}</p>
                    <p className="text-xs text-ink-400">#{i.public_id}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <SeverityBadge severity={i.severity} />
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                      {daysOpenLabel(i.days_open)}
                    </span>
                  </div>
                </Link>
              ))}
              {!longest.length && (
                <p className="px-5 py-6 text-center text-sm text-ink-400">No long-open issues 🎉</p>
              )}
            </div>
          </div>

          {/* Recently resolved */}
          <div className="rounded-2xl border border-ink-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
              <div>
                <h3 className="flex items-center gap-2 font-bold text-ink-900">
                  <CheckIcon size={17} className="text-emerald-500" /> Recently resolved
                </h3>
                <p className="mt-0.5 text-xs text-ink-400">Latest fixes confirmed by community</p>
              </div>
              <Link to="/explore?status=resolved&sort=resolved" className="text-xs font-bold text-brand-600 hover:underline">
                See all <ArrowRightIcon size={12} className="inline" />
              </Link>
            </div>
            <div className="divide-y divide-ink-50">
              {recent.map((i) => (
                <Link
                  key={i.public_id}
                  to={`/issues/${i.public_id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition hover:bg-ink-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-800">{i.title}</p>
                    <p className="text-xs text-ink-400">#{i.public_id}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      ✓ RESOLVED
                    </span>
                    <span className="text-xs text-ink-400">
                      {i.resolved_at ? new Date(i.resolved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                    </span>
                  </div>
                </Link>
              ))}
              {!recent.length && (
                <p className="px-5 py-6 text-center text-sm text-ink-400">No recent resolutions yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
