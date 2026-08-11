import { useEffect, useRef, useState } from 'react';
import { http } from '../lib/api.js';
import { StatusBadge, SeverityBadge } from '../components/Badges.jsx';
import { statusLabel, STATUS_FLOW } from '../lib/constants.js';
import { useAuth } from '../lib/auth.jsx';
import Skeleton, { SkeletonStats, SkeletonRows } from '../components/Skeleton.jsx';
import { MapPinIcon, EyeIcon, FlameIcon, CameraIcon, SparklesIcon, SearchIcon, ArrowRightIcon, CheckIcon } from '../components/icons.jsx';

const QUEUE_FILTERS = [
  { value: 'open', label: '🔴 Open queue' },
  { value: 'REPORTED', label: 'Reported' },
  { value: 'AI_REVIEW', label: '🤖 AI review' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: '🔧 In progress' },
  { value: 'RESOLVED', label: '✅ Resolved' },
  { value: 'REOPENED', label: '↩ Reopened' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: '', label: 'All issues' },
];

const STAT_CARDS = [
  { key: 'openIssues', label: 'Open', emoji: '🔴', gradient: 'from-red-500 to-orange-500' },
  { key: 'criticalIssues', label: 'Critical', emoji: '🔥', gradient: 'from-orange-600 to-red-700' },
  { key: 'assignedIssues', label: 'Assigned', emoji: '📌', gradient: 'from-blue-500 to-indigo-600' },
  { key: 'overdueIssues', label: 'Overdue 30d+', emoji: '⏰', gradient: 'from-slate-600 to-slate-800' },
  { key: 'resolvedThisMonth', label: 'Resolved /mo', emoji: '✅', gradient: 'from-emerald-500 to-teal-600' },
  { key: 'avgResolutionDays', label: 'Avg days', emoji: '⚡', gradient: 'from-violet-500 to-purple-600' },
];

export default function OfficerDashboard() {
  const { user } = useAuth();
  const [issues, setIssues] = useState([]);
  const [stats, setStats] = useState(null);
  const [depts, setDepts] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      http.get('/api/officer/issues', { status: filter, q: search || undefined }),
      http.get('/api/officer/stats'),
    ])
      .then(([a, b]) => {
        setIssues(a.issues || []);
        setStats(b.stats);
        setDepts(b.departments || []);
        setOfficers(b.officers || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  const doSearch = (e) => { e.preventDefault(); load(); };

  if (loading && !issues.length) {
    return (
      <div className="min-h-screen bg-ink-50">
        <div className="container-page max-w-6xl py-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-4 w-72" />
          <div className="mt-6"><SkeletonStats count={6} cols="md:grid-cols-6" /></div>
          <Skeleton className="mt-6 h-14 w-full" />
          <div className="mt-6"><SkeletonRows count={4} /></div>
        </div>
      </div>
    );
  }

  const activeFilter = QUEUE_FILTERS.find((f) => f.value === filter);

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg,#f0f4ff 0%,#f8fafc 100%)' }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg,#1e3a5f 0%,#1a56db 100%)' }} className="py-8 text-white">
        <div className="container-page max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 text-xl">🛡️</span>
              <div>
                <h1 className="text-2xl font-black tracking-tight">Officer Console</h1>
                <p className="text-sm text-blue-200">
                  Signed in as <span className="font-bold text-white">{user?.name}</span>
                  {user?.department_name ? ` · ${user.department_name}` : ' · All departments'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-sm text-blue-100 backdrop-blur">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]" />
              Live queue
            </div>
          </div>

          {/* Stats row */}
          {stats && (
            <div className="mt-6 grid grid-cols-3 gap-3 md:grid-cols-6">
              {STAT_CARDS.map((s) => (
                <div
                  key={s.key}
                  className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${s.gradient} p-4 text-white shadow-sm`}
                >
                  <p className="text-2xl font-black leading-none">{stats[s.key] ?? 0}</p>
                  <p className="mt-1 text-[11px] font-semibold text-white/80">{s.label}</p>
                  <span className="pointer-events-none absolute -right-2 -top-2 text-4xl opacity-20">{s.emoji}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="container-page max-w-6xl py-8">

        {/* ── Queue filter pills + search ── */}
        <div className="mb-5 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
          {/* Filter pills — scrollable on mobile */}
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {QUEUE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => { setFilter(f.value); setActive(null); }}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  filter === f.value
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <form onSubmit={doSearch} className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or #report number…"
                className="input pl-9"
              />
            </div>
            <button type="submit" className="btn-primary shrink-0">Search</button>
          </form>
        </div>

        {/* ── Queue count header ── */}
        <div className="mb-3 flex items-center gap-2 text-sm text-ink-500">
          <span className="font-bold text-ink-900">{issues.length}</span> issues ·
          <span className="font-semibold text-blue-700">{activeFilter?.label}</span>
        </div>

        {/* ── Issue list ── */}
        {issues.length === 0 ? (
          <div className="rounded-2xl border border-ink-200 bg-white p-16 text-center shadow-sm">
            <p className="text-4xl">🎉</p>
            <p className="mt-3 font-bold text-ink-800">Queue is empty</p>
            <p className="mt-1 text-sm text-ink-400">No issues match this filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {issues.map((i) => (
              <div
                key={i.id}
                className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition ${
                  active === i.id ? 'border-blue-300 shadow-md' : 'border-ink-200 hover:border-ink-300'
                }`}
              >
                {/* Issue row */}
                <div className="flex flex-wrap items-start gap-3 p-4">
                  {/* Left: severity stripe */}
                  <div className={`mt-1 h-12 w-1 shrink-0 rounded-full ${
                    i.severity === 'CRITICAL' ? 'bg-red-500'
                    : i.severity === 'HIGH' ? 'bg-orange-500'
                    : i.severity === 'MODERATE' ? 'bg-amber-400'
                    : 'bg-emerald-400'
                  }`} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/issues/${i.public_id}`}
                        className="font-bold text-ink-900 hover:text-blue-700 transition"
                      >
                        #{i.public_id} — {i.title}
                      </a>
                      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
                        <SeverityBadge severity={i.severity} />
                        <StatusBadge status={i.status} />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 font-medium">{i.category_name}</span>
                      <span className="font-medium text-ink-600">{i.department_name}</span>
                      <span className="flex items-center gap-1"><MapPinIcon size={11} /> {i.area}</span>
                      <span className="flex items-center gap-1"><EyeIcon size={11} /> {i.confirmations} confirmed</span>
                      <span className="flex items-center gap-1 font-semibold text-orange-600">
                        <FlameIcon size={11} /> {Math.round(i.priority_score)}
                      </span>
                      {i.age_days != null && (
                        <span className={`font-bold ${i.age_days > 30 ? 'text-red-600' : 'text-amber-600'}`}>
                          {Math.floor(i.age_days)}d open
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action bar */}
                <div className="flex items-center gap-2 border-t border-ink-100 bg-ink-50/50 px-4 py-2.5">
                  <button
                    onClick={() => setActive(active === i.id ? null : i.id)}
                    className={`rounded-xl px-4 py-1.5 text-xs font-bold transition ${
                      active === i.id
                        ? 'bg-blue-600 text-white'
                        : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
                    }`}
                  >
                    {active === i.id ? '✕ Close panel' : '⚡ Update / assign'}
                  </button>
                  <a
                    href={`/issues/${i.public_id}`}
                    className="flex items-center gap-1 rounded-xl border border-ink-200 bg-white px-4 py-1.5 text-xs font-bold text-ink-600 transition hover:bg-ink-50"
                  >
                    View <ArrowRightIcon size={12} />
                  </a>
                </div>

                {/* Officer panel */}
                {active === i.id && (
                  <OfficerPanel
                    issue={i}
                    depts={depts}
                    officers={officers}
                    onDone={() => { setActive(null); load(); }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Officer action panel ─── */
function OfficerPanel({ issue, depts, officers, onDone }) {
  const [toStatus, setToStatus] = useState('');
  const [note, setNote] = useState('');
  const [deptId, setDeptId] = useState(issue.department_id || '');
  const [assignedTo, setAssignedTo] = useState('');
  const [officialUpdate, setOfficialUpdate] = useState('');
  const [afterFile, setAfterFile] = useState(null);
  const [afterImageId, setAfterImageId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [triageSuggestion, setTriageSuggestion] = useState(null);
  const [triageLoading, setTriageLoading] = useState(false);
  const fileRef = useRef(null);

  const flash = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: '', text: '' }), 4000);
  };

  const runTriage = async () => {
    setTriageLoading(true);
    setTriageSuggestion(null);
    try {
      const res = await http.post('/api/ai/triage', { issueId: issue.id });
      setTriageSuggestion(res.suggestion);
    } catch (e) {
      flash('error', e.message);
    } finally {
      setTriageLoading(false);
    }
  };

  const acceptTriage = () => {
    if (!triageSuggestion) return;
    const t = triageSuggestion;
    if (t.suggestedDepartmentId) setDeptId(t.suggestedDepartmentId);
    if (t.suggestedStatus) setToStatus(t.suggestedStatus);
    if (t.priorityRationale) setNote(t.priorityRationale);
    if (t.draftUpdate) setOfficialUpdate(t.draftUpdate);
    setTriageSuggestion(null);
    flash('ok', 'AI suggestion applied — review before posting');
  };

  const uploadAfter = async () => {
    if (!afterFile) return '';
    const fd = new FormData();
    fd.append('images', afterFile);
    const res = await http.upload('/api/uploads/images', fd);
    return res.uploads?.[0]?.id || '';
  };

  const changeStatus = async () => {
    if (!toStatus) return flash('error', 'Pick a target status');
    setBusy(true);
    try {
      let body = { toStatus, note: note.trim() };
      if (toStatus === 'RESOLVED') {
        const id = afterImageId || (afterFile ? await uploadAfter() : '');
        if (!id) return flash('error', 'An after-photo is required to resolve');
        body.afterImageId = id;
      }
      const res = await http.patch(`/api/officer/issues/${issue.id}/status`, body);
      flash('ok', `Status updated${res.verification ? ' · AI verified repair ✓' : ''}`);
      onDone();
    } catch (e) {
      flash('error', e.message);
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    setBusy(true);
    try {
      await http.post(`/api/officer/issues/${issue.id}/assign`, {
        departmentId: deptId || undefined,
        assignedTo: assignedTo || null,
        note: note.trim() || undefined,
      });
      flash('ok', 'Issue assigned');
      onDone();
    } catch (e) {
      flash('error', e.message);
    } finally {
      setBusy(false);
    }
  };

  const postUpdate = async () => {
    if (!officialUpdate.trim()) return flash('error', 'Update text is required');
    setBusy(true);
    try {
      await http.post(`/api/officer/issues/${issue.id}/update`, { body: officialUpdate.trim() });
      setOfficialUpdate('');
      flash('ok', 'Official update posted');
    } catch (e) {
      flash('error', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-blue-100 bg-gradient-to-br from-blue-50/50 to-violet-50/50 p-5">

      {/* Flash message */}
      {msg.text && (
        <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${
          msg.type === 'ok'
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-red-100 text-red-800'
        }`}>
          {msg.type === 'ok' ? '✓' : '⚠'} {msg.text}
        </div>
      )}

      {/* AI Triage */}
      <div className="mb-5">
        {!triageSuggestion ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-white px-5 py-4 shadow-sm">
            <div>
              <p className="flex items-center gap-2 font-bold text-violet-800">
                <SparklesIcon size={16} className="text-violet-500" /> AI Triage Assistant
              </p>
              <p className="mt-0.5 text-xs text-violet-500">
                Get AI routing suggestion, status recommendation & a draft update
              </p>
            </div>
            <button
              onClick={runTriage}
              disabled={busy || triageLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow transition hover:opacity-90 disabled:opacity-50"
            >
              {triageLoading ? (
                <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Thinking…</>
              ) : (
                <><SparklesIcon size={14} /> Suggest</>
              )}
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-violet-200 shadow-sm">
            <div
              className="flex items-center gap-2 px-5 py-3 text-white"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#1a56db)' }}
            >
              <SparklesIcon size={15} />
              <p className="font-bold">AI Triage Suggestion</p>
              <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-black">
                {Math.round((triageSuggestion.confidence || 0) * 100)}% confidence
              </span>
            </div>
            <div className="divide-y divide-violet-100 bg-violet-50">
              {[
                { label: 'Status', value: triageSuggestion.suggestedStatus },
                { label: 'Department', value: triageSuggestion.suggestedDepartmentName },
                { label: 'Rationale', value: triageSuggestion.priorityRationale },
                { label: 'Draft update', value: triageSuggestion.draftUpdate, italic: true },
              ].filter((r) => r.value).map((row) => (
                <div key={row.label} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <span className="w-24 shrink-0 pt-0.5 text-[11px] font-black uppercase tracking-wider text-violet-400">
                    {row.label}
                  </span>
                  <span className={`text-ink-800 ${row.italic ? 'italic' : 'font-semibold'}`}>
                    {row.italic ? `"${row.value}"` : row.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t border-violet-100 bg-white px-5 py-3">
              <button
                onClick={acceptTriage}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2 text-sm font-bold text-white shadow transition hover:bg-violet-700"
              >
                <CheckIcon size={14} /> Accept all
              </button>
              <button
                onClick={() => setTriageSuggestion(null)}
                className="rounded-xl border border-ink-200 bg-white px-5 py-2 text-sm font-semibold text-ink-600 transition hover:bg-ink-50"
              >
                Modify manually
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action grid */}
      <div className="grid gap-5 md:grid-cols-2">

        {/* Change status */}
        <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-xs">⚡</span>
            Update status
          </h4>
          <select value={toStatus} onChange={(e) => setToStatus(e.target.value)} className="input">
            <option value="">Select new status…</option>
            {(STATUS_FLOW[issue.status] || []).map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          {toStatus === 'RESOLVED' && (
            <div className="mt-3">
              <label className="label">After-photo <span className="text-red-500">*</span></label>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => setAfterFile(e.target.files?.[0])} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={`input flex items-center gap-2 text-left transition ${afterFile ? 'border-emerald-400 text-emerald-700' : 'text-ink-500'}`}
              >
                <CameraIcon size={15} className="shrink-0" />
                {afterFile ? `✓ ${afterFile.name}` : 'Choose after-photo…'}
              </button>
            </div>
          )}

          <label className="label mt-3">Note for timeline</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="input resize-none"
            placeholder="Short note (e.g. Repair crew dispatched)"
          />
          <button
            onClick={changeStatus}
            disabled={busy || !toStatus}
            className="btn-primary mt-3 w-full"
          >
            Update status
          </button>
        </div>

        {/* Assign */}
        <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-xs">📌</span>
            Assign
          </h4>
          <label className="label">Department</label>
          <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="input">
            <option value="">Keep current ({issue.department_name || '—'})</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <label className="label mt-3">Officer</label>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input">
            <option value="">No specific officer</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button onClick={assign} disabled={busy} className="btn-outline mt-3 w-full">
            Assign
          </button>
        </div>

        {/* Official update */}
        <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm md:col-span-2">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-100 text-xs">📣</span>
            Post official update
          </h4>
          <div className="flex gap-2">
            <input
              value={officialUpdate}
              onChange={(e) => setOfficialUpdate(e.target.value)}
              placeholder="e.g. Crew dispatched, repair scheduled for tomorrow…"
              className="input flex-1"
            />
            <button onClick={postUpdate} disabled={busy} className="btn-primary shrink-0">Post</button>
          </div>
          <p className="mt-1.5 text-xs text-ink-400">Visible to all citizens following this issue</p>
        </div>
      </div>
    </div>
  );
}
