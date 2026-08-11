import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { http } from '../lib/api.js';
import { numberCompact, timeAgo } from '../lib/format.js';
import { CATEGORY_ICONS } from '../lib/constants.js';
import IssueCard from '../components/IssueCard.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  ArrowRightIcon,
  CameraIcon,
  BotIcon,
  BuildingIcon,
  CheckIcon,
  MapIcon,
  MapPinIcon,
  SparklesIcon,
  SearchIcon,
} from '../components/icons.jsx';

export default function Landing() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [categories, setCategories] = useState([]);
  const [recent, setRecent] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [myResolved, setMyResolved] = useState([]);
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    http.get('/api/city/stats').then((d) => setStats(d.stats)).catch(() => {});
    http.get('/api/categories').then((d) => setCategories(d.categories || [])).catch(() => {});
    http.get('/api/issues', { sort: 'priority', limit: 6, status: 'open' }).then((d) => setRecent(d.issues || [])).catch(() => {});
    http.get('/api/issues', { status: 'resolved', sort: 'resolved', limit: 6 }).then((d) => setResolved(d.issues || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) { setMyResolved([]); return; }
    http.get('/api/issues/my').then((d) => {
      setMyResolved((d.issues || []).filter((i) => ['RESOLVED', 'VERIFIED_RESOLVED'].includes(i.status)));
    }).catch(() => {});
  }, [user]);

  const onSearch = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/explore?q=${encodeURIComponent(q.trim())}` : '/explore');
  };

  const steps = [
    {
      num: '01',
      icon: CameraIcon,
      color: 'from-blue-500 to-blue-600',
      title: 'Snap & Report',
      body: 'Take a photo of the problem and drop a pin on the map. Describe the issue in your own words.',
    },
    {
      num: '02',
      icon: BotIcon,
      color: 'from-violet-500 to-violet-600',
      title: 'AI Verifies',
      body: 'Our AI checks your photo, identifies the type of issue, detects duplicates, and routes it to the right department.',
    },
    {
      num: '03',
      icon: BuildingIcon,
      color: 'from-orange-500 to-orange-600',
      title: 'Department Acts',
      body: 'The verified report is sent to the responsible city department. Community confirmations push urgent issues to the top.',
    },
    {
      num: '04',
      icon: CheckIcon,
      color: 'from-emerald-500 to-emerald-600',
      title: 'Track & Confirm',
      body: 'Follow every status update live. Once fixed, confirm the repair to close the loop and build community trust.',
    },
  ];

  return (
    <div className="overflow-x-hidden">

      {/* ═══════════════════════════════════════
          HERO
      ═══════════════════════════════════════ */}
      <section className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a56db 50%, #0ea5e9 100%)' }}>
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-blue-300/10 blur-3xl" />
        <div className="pointer-events-none absolute right-1/4 top-1/2 h-64 w-64 rounded-full bg-sky-400/10 blur-2xl" />

        <div className="container-page relative py-24 text-center md:py-36">
          {/* Pill badge with live traffic */}
          <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium text-blue-100 backdrop-blur-sm shadow-sm md:text-sm">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_3px_rgba(52,211,153,0.7)]" />
            <span className="font-bold text-white">Live in Pune</span>
            <span className="text-blue-300">•</span>
            <span>👁️ <strong className="text-white">{stats ? numberCompact(stats.todayVisitors || 340) : '300+'}</strong> daily visitors</span>
            <span className="text-blue-300">•</span>
            <span>🔥 <strong className="text-emerald-300">{stats ? stats.activeNow || 18 : 15}</strong> active citizens online</span>
          </div>

          {/* Headline */}
          <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-black leading-[1.1] tracking-tight text-white md:text-7xl">
            See a problem?{' '}
            <span className="bg-gradient-to-r from-sky-300 to-emerald-300 bg-clip-text text-transparent">
              Report it.
            </span>
            <br />
            Watch it get{' '}
            <span className="relative inline-block">
              <span className="relative z-10 text-white">fixed.</span>
              <span className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded bg-emerald-400/30 blur-sm" />
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-blue-100 md:text-xl">
            CivicEye is Pune's citizen platform for reporting potholes, broken streetlights, garbage, flooding and more.
            <br className="hidden md:block" />
            AI routes your report to the right department. You track it until it's resolved.
          </p>

          {/* Search bar */}
          <form onSubmit={onSearch} className="mx-auto mt-10 flex max-w-2xl overflow-hidden rounded-2xl bg-white/15 p-1.5 shadow-2xl backdrop-blur-md ring-1 ring-white/20">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-white px-4 py-2.5 shadow-sm">
              <SearchIcon size={18} className="shrink-0 text-ink-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by area, issue type or report #..."
                className="flex-1 bg-transparent text-sm text-ink-900 placeholder-ink-400 focus:outline-none"
              />
            </div>
            <button type="submit" className="ml-2 flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-400 transition">
              Search
            </button>
          </form>

          {/* Quick action pills */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
            <Link
              to="/report"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 font-bold text-blue-700 shadow-lg transition hover:scale-105 hover:shadow-xl"
            >
              <CameraIcon size={16} /> Report an issue
            </Link>
            <Link
              to="/map"
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 py-2.5 font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              <MapIcon size={16} /> Open live map
            </Link>
            <Link
              to="/explore"
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 py-2.5 font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              Browse all issues <ArrowRightIcon size={16} />
            </Link>
          </div>

          {/* Live Visitor & Activity Bar */}
          {stats && (
            <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {[
                { label: 'Daily visitors', value: `${numberCompact(stats.todayVisitors || 340)}+`, sub: 'citizens today', icon: '👁️' },
                { label: 'Total tracked', value: numberCompact(stats.total), sub: 'community reports', icon: '📋' },
                { label: 'Reported today', value: stats.todayReports ?? 0, sub: 'new issues', icon: '🔴' },
                { label: 'Resolved total', value: numberCompact(stats.resolved), sub: `${stats.resolvedThisMonth || 0} this month`, icon: '✅' },
                { label: 'Avg fix time', value: `${Math.round(stats.avgResolutionDays)}d`, sub: 'resolution speed', icon: '⚡' },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl bg-white/10 p-4 text-center backdrop-blur-md ring-1 ring-white/15 transition hover:bg-white/20">
                  <p className="text-2xl font-black text-white md:text-3xl">{s.value}</p>
                  <p className="mt-0.5 text-xs font-bold text-white">{s.icon} {s.label}</p>
                  <p className="text-[10px] text-blue-200">{s.sub}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══════════════════════════════════════
          WHAT IS CIVICEYE — 3-COLUMN INTRO
      ═══════════════════════════════════════ */}
      <section className="bg-white py-16 md:py-24">
        <div className="container-page">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-4 py-1 text-xs font-bold uppercase tracking-widest text-brand-600">
              What is CivicEye?
            </span>
            <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-black text-ink-900 md:text-4xl">
              Your city's complaint — resolved in days, not years.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-ink-500">
              Unlike old-fashioned complaint portals, CivicEye uses AI to verify your report, assigns it instantly, and lets the whole community track progress in real time.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                emoji: '📸',
                title: 'Upload a photo',
                body: 'Take a photo of the issue on your phone. Our AI reads the image and fills in the category, severity and suggested title automatically.',
                bg: 'bg-blue-50',
                border: 'border-blue-100',
              },
              {
                emoji: '🗺️',
                title: 'Drop a map pin',
                body: 'Tap the map or use GPS to mark the exact location. Your report is instantly routed to the right municipal ward and officer.',
                bg: 'bg-emerald-50',
                border: 'border-emerald-100',
              },
              {
                emoji: '🔔',
                title: 'Get status updates',
                body: 'Follow your report live — from "Reported" all the way to "Resolved". Get notified when the department acts or the community confirms.',
                bg: 'bg-violet-50',
                border: 'border-violet-100',
              },
            ].map((f) => (
              <div key={f.title} className={`rounded-2xl border ${f.border} ${f.bg} p-6`}>
                <span className="text-4xl">{f.emoji}</span>
                <h3 className="mt-4 text-lg font-bold text-ink-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          HOW IT WORKS — Numbered steps
      ═══════════════════════════════════════ */}
      <section className="bg-ink-50 py-16 md:py-24">
        <div className="container-page">
          <div className="mb-12 text-center">
            <span className="rounded-full bg-brand-50 px-4 py-1 text-xs font-bold uppercase tracking-widest text-brand-600">
              How it works
            </span>
            <h2 className="mt-4 text-3xl font-black text-ink-900 md:text-4xl">
              From photo to fixed — in 4 steps
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div key={s.num} className="card group flex flex-col gap-4 p-6 transition hover:-translate-y-1 hover:shadow-lift">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${s.color} text-white shadow-lg`}>
                  <s.icon size={22} />
                </div>
                <span className="text-5xl font-black text-ink-100 group-hover:text-ink-200 transition">{s.num}</span>
                <div className="-mt-6">
                  <h3 className="font-bold text-ink-900">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          CATEGORIES
      ═══════════════════════════════════════ */}
      <section className="bg-white py-16 md:py-24">
        <div className="container-page">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="rounded-full bg-brand-50 px-4 py-1 text-xs font-bold uppercase tracking-widest text-brand-600">
                Categories
              </span>
              <h2 className="mt-4 text-3xl font-black text-ink-900 md:text-4xl">What can you report?</h2>
              <p className="mt-2 text-ink-500">
                Every category is automatically routed to the right city department.
              </p>
            </div>
            <Link to="/explore" className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 transition">
              View all issues →
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {categories.map((c, i) => (
              <Link
                key={c.id}
                to={`/explore?category=${c.slug}`}
                className="group fade-in-up flex flex-col items-center gap-2 rounded-2xl border border-ink-100 bg-white p-4 text-center shadow-card transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift"
                style={{ animationDelay: `${Math.min(i * 30, 200)}ms` }}
              >
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-xl text-white shadow-sm"
                  style={{ backgroundColor: c.color || '#64748b' }}
                >
                  {CATEGORY_ICONS[c.icon] || '•'}
                </span>
                <span className="break-words text-xs font-bold leading-tight text-ink-900 group-hover:text-brand-700">{c.name}</span>
                <span className="text-[10px] text-ink-400">{c.department_name || 'City dept'}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          HIGH PRIORITY ISSUES
      ═══════════════════════════════════════ */}
      <section className="bg-red-50/60 py-16 md:py-24">
        <div className="container-page">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="rounded-full bg-red-100 px-4 py-1 text-xs font-bold uppercase tracking-widest text-red-600">
                🔥 Urgent
              </span>
              <h2 className="mt-4 text-3xl font-black text-ink-900 md:text-4xl">High priority right now</h2>
              <p className="mt-2 text-ink-500">Community-confirmed issues ranked by urgency score. These need attention first.</p>
            </div>
            <Link to="/explore?sort=priority" className="shrink-0 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50">
              See all urgent →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((i) => <IssueCard key={i.id} issue={i} />)}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          RECENTLY RESOLVED
      ═══════════════════════════════════════ */}
      <section className="bg-emerald-50/60 py-16 md:py-24">
        <div className="container-page">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="rounded-full bg-emerald-100 px-4 py-1 text-xs font-bold uppercase tracking-widest text-emerald-600">
                ✅ Fixed
              </span>
              <h2 className="mt-4 text-3xl font-black text-ink-900 md:text-4xl">Recently resolved</h2>
              <p className="mt-2 text-ink-500">Recent fixes confirmed by the community — ordered by latest resolution date.</p>
            </div>
            <Link to="/explore?status=resolved" className="shrink-0 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50">
              View all resolved →
            </Link>
          </div>

          {/* Logged-in user's own resolved issues */}
          {user && myResolved.length > 0 && (
            <div className="mb-8 rounded-2xl border-2 border-emerald-400 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-base">
                <SparklesIcon className="h-5 w-5 text-emerald-500" />
                🎉 Your reports have been fixed!
              </div>
              <p className="mt-1 text-xs text-emerald-600">These issues you reported have been resolved by the department:</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {myResolved.slice(0, 3).map((i) => (
                  <div key={i.id} className="relative overflow-hidden rounded-2xl ring-2 ring-emerald-400 shadow-md">
                    <span className="absolute left-2 top-2 z-10 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                      YOUR REPORT FIXED!
                    </span>
                    <IssueCard issue={i} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guest callout */}
          {!user && (
            <div className="mb-8 flex flex-col items-center justify-between gap-5 rounded-2xl border border-brand-200 bg-white p-6 shadow-sm md:flex-row">
              <div>
                <h3 className="text-lg font-bold text-ink-900">Have a civic problem near you?</h3>
                <p className="mt-1 text-sm text-ink-600">
                  Report it and track it until city departments fix it. Free, no bureaucracy.
                </p>
              </div>
              <div className="flex shrink-0 gap-3">
                <Link to="/report" className="btn-primary">
                  Report an issue <ArrowRightIcon size={16} />
                </Link>
                <Link to="/citizen/login" className="btn-outline">Sign in</Link>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(user && myResolved.length > 0
              ? resolved.filter((i) => !myResolved.some((m) => m.id === i.id))
              : resolved
            ).slice(0, 6).map((i) => <IssueCard key={i.id} issue={i} />)}
          </div>

          {resolved.length === 0 && myResolved.length === 0 && (
            <p className="mt-6 rounded-xl bg-emerald-100 p-4 text-center text-sm text-emerald-800">
              Head to the <Link to="/dashboard" className="font-semibold underline">city dashboard</Link> to see resolution trends.
            </p>
          )}
        </div>
      </section>

      {/* ═══════════════════════════════════════
          FINAL CTA
      ═══════════════════════════════════════ */}
      <section
        className="relative overflow-hidden py-20 text-center text-white md:py-28"
        style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a56db 60%, #0ea5e9 100%)' }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.05)_0%,_transparent_70%)]" />
        <div className="container-page relative">
          <span className="text-5xl">🏙️</span>
          <h2 className="mx-auto mt-4 max-w-2xl text-4xl font-black text-white md:text-5xl">
            Your city needs your eyes.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-blue-100">
            Every report you make helps keep Pune safer and cleaner. Join thousands of citizens working together with city departments to fix what matters.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/report"
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-black text-blue-700 shadow-2xl transition hover:scale-105 hover:shadow-white/20"
            >
              <CameraIcon size={20} /> Report an issue now
            </Link>
            {!user && (
              <Link
                to="/citizen/register"
                className="inline-flex items-center gap-2 rounded-2xl border-2 border-white/30 bg-white/10 px-8 py-4 text-base font-bold text-white backdrop-blur transition hover:bg-white/20"
              >
                Create free account <ArrowRightIcon size={18} />
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
