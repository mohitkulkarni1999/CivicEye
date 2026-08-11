import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { http } from '../lib/api.js';
import { numberCompact, timeAgo } from '../lib/format.js';
import { CATEGORY_ICONS } from '../lib/constants.js';
import IssueCard from '../components/IssueCard.jsx';
import { useAuth } from '../lib/auth.jsx';
import { ArrowRightIcon, CameraIcon, BotIcon, BuildingIcon, CheckIcon, MapIcon, MapPinIcon, SparklesIcon } from '../components/icons.jsx';

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
    http.get('/api/issues', { sort: 'priority', limit: 6 }).then((d) => setRecent(d.issues || [])).catch(() => {});
    http.get('/api/issues', { status: 'resolved', sort: 'resolved', limit: 6 }).then((d) => setResolved(d.issues || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setMyResolved([]);
      return;
    }
    http.get('/api/issues/my').then((d) => {
      const myRes = (d.issues || []).filter((i) => ['RESOLVED', 'VERIFIED_RESOLVED'].includes(i.status));
      setMyResolved(myRes);
    }).catch(() => {});
  }, [user]);

  const onSearch = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/explore?q=${encodeURIComponent(q.trim())}` : '/explore');
  };

  return (
    <div>
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-700 via-brand-600 to-brand-500 text-white">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-ink-900/20 blur-2xl" />
        <div className="container-page relative py-20 text-center md:py-28">
          <span className="badge inline-flex items-center gap-1.5 bg-white/15 text-white">
            <MapPinIcon size={14} /> Pune · AI-powered civic accountability
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            See it. Report it. <span className="text-brand-200">Watch it get fixed.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-brand-100 md:text-lg">
            Report potholes, broken streetlights, garbage dumping and more — with photos and GPS location.
            CivicEye verifies reports with AI, routes them to the right department, and tracks them until resolved.
          </p>

          <form onSubmit={onSearch} className="mx-auto mt-8 flex max-w-2xl items-center gap-2 rounded-2xl bg-white p-2 shadow-lift">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by area, issue or report number…"
              className="flex-1 bg-transparent px-3 py-2 text-sm text-ink-900 placeholder-ink-400 focus:outline-none"
            />
            <button type="submit" className="btn-primary !px-5">
              Search
            </button>
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-brand-100">
            <Link to="/map" className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 font-medium backdrop-blur hover:bg-white/20">
              <MapIcon size={16} /> Open live map
            </Link>
            <Link to="/report" className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 font-medium backdrop-blur hover:bg-white/20">
              Report an issue <ArrowRightIcon size={16} />
            </Link>
          </div>

          {stats && (
            <div className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: 'Issues tracked', value: numberCompact(stats.total) },
                { label: 'Still open', value: numberCompact(stats.open) },
                { label: 'Resolved', value: numberCompact(stats.resolved) },
                { label: 'Avg. fix time', value: `${Math.round(stats.avgResolutionDays)}d` },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl bg-white/10 p-4 backdrop-blur">
                  <p className="text-2xl font-extrabold md:text-3xl">{s.value}</p>
                  <p className="text-xs text-brand-100">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CATEGORIES */}
      <section className="container-page py-16">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-ink-900 md:text-3xl">What can you report?</h2>
            <p className="mt-1 text-ink-500">Pick a category — each one is routed to the right department automatically.</p>
          </div>
          <Link to="/explore" className="hidden text-sm font-semibold text-brand-600 hover:underline md:block">
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {categories.map((c, i) => (
            <Link
              key={c.id}
              to={`/explore?category=${c.slug}`}
              className="card group fade-in-up flex flex-col items-center gap-2 p-4 text-center transition hover:-translate-y-0.5 hover:shadow-lift"
              style={{ animationDelay: `${Math.min(i * 40, 240)}ms` }}
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl text-lg text-white"
                style={{ backgroundColor: c.color || '#64748b' }}
              >
                {CATEGORY_ICONS[c.icon] || '•'}
              </span>
              <span className="break-words text-sm font-semibold leading-tight text-ink-900 group-hover:text-brand-700">{c.name}</span>
              <span className="text-xs text-ink-400">{c.department_name || 'City dept'}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* TOP ISSUES */}
      <section className="bg-ink-100/60 py-16">
        <div className="container-page">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-bold text-ink-900 md:text-3xl">High priority right now</h2>
              <p className="mt-1 text-ink-500">Community-confirmed issues ranked by urgency.</p>
            </div>
            <Link to="/explore" className="text-sm font-semibold text-brand-600 hover:underline">
              See all →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((i) => (
              <IssueCard key={i.id} issue={i} />
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="container-page py-16">
        <h2 className="text-center text-2xl font-bold text-ink-900 md:text-3xl">How it works</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-ink-500">
          From spotting the problem to seeing it resolved — four simple steps.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {[
            { icon: CameraIcon, title: '1 · Snap it', body: 'Take a photo and drop a pin on the map. Add a short description.' },
            { icon: BotIcon, title: '2 · AI verifies', body: 'CivicEye checks the photo for duplicates and confirms the category.' },
            { icon: BuildingIcon, title: '3 · Department acts', body: 'Verified reports are assigned to the responsible city department.' },
            { icon: CheckIcon, title: '4 · Track progress', body: 'Follow status changes and community updates until it is fixed.' },
          ].map((s) => (
            <div key={s.title} className="card p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <s.icon size={22} />
              </span>
              <h3 className="mt-3 font-semibold text-ink-900">{s.title}</h3>
              <p className="mt-1 text-sm text-ink-500">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* RECENTLY RESOLVED */}
      <section className="bg-ink-100/60 py-16">
        <div className="container-page">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold text-ink-900 md:text-3xl">
                <CheckIcon size={26} className="text-emerald-500" /> Recently resolved
              </h2>
              <p className="mt-1 text-ink-500">Recent fixes confirmed by the community, ordered by latest resolution.</p>
            </div>
            <Link to="/explore?status=resolved" className="text-sm font-semibold text-brand-600 hover:underline">
              View all resolved →
            </Link>
          </div>

          {/* User's Own Resolved Issues Highlight Banner */}
          {user && myResolved.length > 0 && (
            <div className="mt-6 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-base">
                <SparklesIcon className="text-emerald-600 h-5 w-5" />
                Your Reported Issues have been Resolved! 🎉
              </div>
              <p className="mt-1 text-xs text-emerald-700">
                Great job citizen! Here are your reports that local departments have successfully fixed:
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {myResolved.slice(0, 3).map((i) => (
                  <div key={i.id} className="relative ring-2 ring-emerald-500 rounded-2xl overflow-hidden bg-white shadow-md">
                    <span className="absolute top-2 left-2 z-10 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold text-white shadow">
                      YOUR REPORT FIXED!
                    </span>
                    <IssueCard issue={i} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guest Accountability Callout Banner */}
          {!user && (
            <div className="mt-6 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 via-white to-brand-50 p-6 text-center shadow-sm md:flex md:items-center md:justify-between md:text-left">
              <div>
                <h3 className="text-lg font-bold text-ink-900">Spotted a civic problem in your area?</h3>
                <p className="mt-1 text-sm text-ink-600">
                  Upload your issue here to hold local government accountable! Track your issue step-by-step from report to repair.
                </p>
              </div>
              <div className="mt-4 flex shrink-0 items-center justify-center gap-3 md:mt-0">
                <Link to="/report" className="btn-primary">
                  Report an issue <ArrowRightIcon size={16} />
                </Link>
                <Link to="/citizen/login" className="btn-outline">
                  Sign in to track
                </Link>
              </div>
            </div>
          )}

          {/* All Resolved Issues Grid */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(user && myResolved.length > 0
              ? resolved.filter((i) => !myResolved.some((m) => m.id === i.id))
              : resolved
            )
              .slice(0, 6)
              .map((i) => (
                <IssueCard key={i.id} issue={i} />
              ))}
          </div>

          {resolved.length === 0 && myResolved.length === 0 && (
            <p className="mt-6 rounded-xl bg-brand-50 p-4 text-center text-sm text-brand-800">
              Head to the <Link to="/dashboard" className="font-semibold underline">city dashboard</Link> to see resolution trends.
            </p>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 py-16 text-center text-white">
        <div className="container-page">
          <h2 className="text-3xl font-extrabold">Your city needs your eyes.</h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-100">
            Every report makes Pune safer. Join the community working with departments to fix what matters.
          </p>
          <div className="mt-7 flex justify-center gap-3">
            <Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-brand-700 shadow hover:bg-brand-50">
              Report an issue <ArrowRightIcon size={18} />
            </Link>
            <Link to="/citizen/register" className="rounded-xl bg-white/10 px-6 py-3 font-semibold backdrop-blur hover:bg-white/20">
              Create free account
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
