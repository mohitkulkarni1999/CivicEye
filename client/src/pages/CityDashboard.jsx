import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../lib/api.js';
import { numberCompact, daysOpenLabel } from '../lib/format.js';
import { SeverityBadge, StatusBadge } from '../components/Badges.jsx';
import Skeleton, { SkeletonStats, SkeletonRows } from '../components/Skeleton.jsx';
import { MapIcon, ClockIcon, CheckIcon, FolderIcon, FlameIcon, SparklesIcon } from '../components/icons.jsx';

function StatCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="card flex items-start gap-3 p-5">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent || 'bg-brand-50 text-brand-600'}`}>
        <Icon size={20} />
      </span>
      <div>
        <p className="text-3xl font-extrabold leading-none text-ink-900">{value}</p>
        <p className="mt-1 text-sm font-medium text-ink-500">{label}</p>
        {sub && <p className="text-xs text-ink-400">{sub}</p>}
      </div>
    </div>
  );
}

function BarRow({ label, total, open, resolved, color, max }) {
  const t = Math.max(total, 1);
  const openW = Math.max(4, (open / t) * 100);
  const resW = Math.max(2, (resolved / t) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-ink-700">{label}</span>
        <span className="text-ink-400">{total}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-ink-100">
        <div className="flex h-full">
          <div style={{ width: `${openW}%`, backgroundColor: color || '#f59e0b' }} title={`open ${open}`} />
          <div style={{ width: `${resW}%`, backgroundColor: '#10b981' }} title={`resolved ${resolved}`} />
        </div>
      </div>
      <div className="mb-1 flex justify-between text-[11px] text-ink-400">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" /> {open} open</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {resolved} resolved</span>
      </div>
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
    );
  }

  const maxTrend = Math.max(1, ...trend.map((d) => Math.max(d.reported, d.resolved)));
  const maxArea = Math.max(1, ...areas.map((a) => a.total));

  return (
    <div className="container-page py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">City dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">Live overview of civic issues in Pune.</p>
        </div>
        <Link to="/map" className="btn-outline"><MapIcon size={16} /> Map</Link>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total reports" value={numberCompact(stats.total)} sub={`${numberCompact(stats.reporters)} active reporters`} icon={FolderIcon} accent="bg-ink-100 text-ink-600" />
          <StatCard label="Open issues" value={numberCompact(stats.open)} sub={`${stats.critical} critical`} icon={FlameIcon} accent="bg-orange-100 text-orange-600" />
          <StatCard label="Resolved" value={numberCompact(stats.resolved)} sub={`${stats.resolvedThisMonth} this month`} icon={CheckIcon} accent="bg-emerald-100 text-emerald-600" />
          <StatCard label="Avg fix time" value={`${Math.round(stats.avgResolutionDays)}d`} sub={`${numberCompact(stats.participants)} participants`} icon={ClockIcon} accent="bg-brand-50 text-brand-600" />
        </div>
      )}

      {insights && (insights.summary || insights.note) && (
        <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-800">
              <SparklesIcon size={16} /> AI city insights
            </h3>
            {insights.summaryProvider && (
              <span className="text-[11px] uppercase tracking-wide text-brand-500">
                {insights.summaryProvider === 'heuristic' ? 'local analysis' : 'AI summary'}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-brand-900">{insights.summary || insights.note}</p>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Trend */}
        <div className="card p-5">
          <h3 className="mb-4 font-semibold text-ink-900">Reports & resolutions — last 30 days</h3>
          <div className="flex h-40 items-end gap-1">
            {trend.map((d) => (
              <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end" title={`${d.day}`}>
                <div className="w-full rounded-t bg-orange-400 transition group-hover:bg-orange-500" style={{ height: `${(d.reported / maxTrend) * 100}%` }} />
                <div className="mt-0.5 w-full rounded-t bg-emerald-500 opacity-80" style={{ height: `${(d.resolved / maxTrend) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-[11px] text-ink-400">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-orange-400" /> Reported</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Resolved</span>
          </div>
        </div>

        {/* Top areas */}
        <div className="card p-5">
          <h3 className="mb-4 font-semibold text-ink-900">Top areas by reports</h3>
          <div className="space-y-3">
            {areas.slice(0, 6).map((a) => (
              <div key={a.area}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-ink-700">{a.area}</span>
                  <span className="text-ink-400">{a.total} · avg priority {a.avg_priority}</span>
                </div>
                <div className="h-2 rounded-full bg-ink-100">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${(a.total / maxArea) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By category */}
        <div className="card p-5">
          <h3 className="mb-4 font-semibold text-ink-900">By category</h3>
          <div className="space-y-3">
            {cats.slice(0, 8).map((c) => (
              <BarRow key={c.slug} label={c.label} total={c.total} open={c.open} resolved={c.resolved} color={c.color} />
            ))}
          </div>
        </div>

        {/* By department */}
        <div className="card p-5">
          <h3 className="mb-4 font-semibold text-ink-900">By department</h3>
          <div className="space-y-3">
            {depts.slice(0, 7).map((d) => (
              <BarRow key={d.slug} label={d.label} total={d.total} open={d.open} resolved={d.resolved} color={d.color} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-ink-900">
            <ClockIcon size={18} className="text-ink-400" /> Longest open issues
          </h3>
          <div className="space-y-2">
            {longest.map((i) => (
              <Link key={i.public_id} to={`/issues/${i.public_id}`} className="flex items-center justify-between rounded-xl border border-ink-100 p-3 hover:bg-ink-50">
                <span className="min-w-0 flex-1 truncate pr-3 text-sm font-medium text-ink-800">{i.title}</span>
                <span className="flex items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  <span className="text-xs font-semibold text-red-600">{daysOpenLabel(i.days_open)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-ink-900">
            <CheckIcon size={18} className="text-emerald-500" /> Recently resolved
          </h3>
          <div className="space-y-2">
            {recent.map((i) => (
              <Link key={i.public_id} to={`/issues/${i.public_id}`} className="flex items-center justify-between rounded-xl border border-ink-100 p-3 hover:bg-ink-50">
                <span className="min-w-0 flex-1 truncate pr-3 text-sm font-medium text-ink-800">{i.title}</span>
                <span className="flex items-center gap-2 text-xs text-ink-400">
                  <StatusBadge status="VERIFIED_RESOLVED" />
                  <span>{new Date(i.resolved_at).toLocaleDateString()}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
