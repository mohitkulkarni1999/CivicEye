import { useEffect, useRef, useState } from 'react';
import { http } from '../lib/api.js';
import { StatusBadge, SeverityBadge } from '../components/Badges.jsx';
import { statusLabel, STATUS_FLOW } from '../lib/constants.js';
import { useAuth } from '../lib/auth.jsx';
import Skeleton, { SkeletonStats, SkeletonRows } from '../components/Skeleton.jsx';
import { MapPinIcon, EyeIcon, FlameIcon, CameraIcon, SparklesIcon } from '../components/icons.jsx';

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

  const doSearch = (e) => {
    e.preventDefault();
    load();
  };

  if (loading && !issues.length) {
    return (
      <div className="container-page max-w-6xl py-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-6"><SkeletonStats count={6} cols="md:grid-cols-6" /></div>
        <Skeleton className="mt-6 h-14 w-full" />
        <div className="mt-6"><SkeletonRows count={4} /></div>
      </div>
    );
  }

  return (
    <div className="container-page max-w-6xl py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Officer console</h1>
          <p className="mt-1 text-sm text-ink-500">
            Signed in as <span className="font-semibold">{user?.name}</span>
            {user?.department_name ? ` · ${user.department_name}` : ' · All departments'}
          </p>
        </div>
      </div>

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
          {[
            { l: 'Open', v: stats.openIssues },
            { l: 'Critical', v: stats.criticalIssues },
            { l: 'Assigned', v: stats.assignedIssues },
            { l: 'Overdue 30d+', v: stats.overdueIssues },
            { l: 'Resolved /mo', v: stats.resolvedThisMonth },
            { l: 'Avg days', v: stats.avgResolutionDays },
          ].map((s) => (
            <div key={s.l} className="card p-3 text-center">
              <p className="text-2xl font-extrabold text-ink-900">{s.v}</p>
              <p className="text-[11px] text-ink-500">{s.l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="input w-auto">
          <option value="open">Open queue</option>
          <option value="REPORTED">Reported</option>
          <option value="AI_REVIEW">AI review</option>
          <option value="VERIFIED">Verified</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="REOPENED">Reopened</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
        <form onSubmit={doSearch} className="flex flex-1 gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or #report…" className="input flex-1" />
          <button type="submit" className="btn-outline">Search</button>
        </form>
      </div>

      {issues.length === 0 ? (
        <div className="card p-12 text-center text-ink-400">No issues in this queue.</div>
      ) : (
        <div className="space-y-2">
          {issues.map((i) => (
            <div key={i.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/issues/${i.public_id}`} className="font-semibold text-ink-900 hover:text-brand-700">
                  #{i.public_id} · {i.title}
                </a>
                <span className="ml-auto flex items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  <StatusBadge status={i.status} />
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                <span>{i.category_name}</span>
                <span>{i.department_name}</span>
                <span className="inline-flex items-center gap-1"><MapPinIcon size={13} className="text-ink-400" /> {i.area}</span>
                <span className="inline-flex items-center gap-1"><EyeIcon size={13} className="text-ink-400" /> {i.confirmations}</span>
                <span className="inline-flex items-center gap-1"><FlameIcon size={13} className="text-orange-500" /> {Math.round(i.priority_score)}</span>
                {i.age_days != null && <span className="font-medium text-red-600">{Math.floor(i.age_days)}d open</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setActive(active === i.id ? null : i.id)} className="btn-outline text-sm">
                  {active === i.id ? 'Close panel' : 'Update status / assign'}
                </button>
                <a href={`/issues/${i.public_id}`} className="btn-ghost text-sm">View →</a>
              </div>
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
  );
}

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
  const [triageLoading, setTriageLoading] = useState(false);
  const fileRef = useRef(null);

  const flash = (type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: '', text: '' }), 4000);
  };

  const runTriage = async () => {
    setTriageLoading(true);
    try {
      const res = await http.post('/api/ai/triage', { issueId: issue.id });
      const t = res.suggestion;
      if (t.suggestedDepartmentId) setDeptId(t.suggestedDepartmentId);
      if (t.suggestedStatus) setToStatus(t.suggestedStatus);
      if (t.priorityRationale) setNote(t.priorityRationale);
      if (t.draftUpdate) setOfficialUpdate(t.draftUpdate);
      flash('ok', 'AI suggestion applied — please review before posting');
    } catch (e) {
      flash('error', e.message);
    } finally {
      setTriageLoading(false);
    }
  };

  const uploadAfter = async () => {
    if (!afterFile) return setAfterImageId('');
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
        if (!id) return flash('error', 'An after-photo is required to resolve an issue');
        body.afterImageId = id;
      }
      const res = await http.patch(`/api/officer/issues/${issue.id}/status`, body);
      flash('ok', `Status updated${res.verification ? ' · AI verified repair' : ''}`);
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
    <div className="mt-4 grid gap-4 rounded-xl border border-ink-200 bg-ink-50 p-4 md:grid-cols-2">
      {msg.text && (
        <div className={`md:col-span-2 rounded-lg px-3 py-2 text-sm ${msg.type === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
          {msg.text}
        </div>
      )}

      <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs text-brand-800">
          <SparklesIcon size={14} /> <span className="font-semibold">AI triage</span> — suggests a department, status, and a draft update. Review before posting.
        </p>
        <button onClick={runTriage} disabled={busy || triageLoading} className="btn-outline shrink-0 text-sm">
          {triageLoading ? 'Thinking…' : 'Suggest'}
        </button>
      </div>

      <div>
        <label className="label">Change status to</label>
        <select value={toStatus} onChange={(e) => setToStatus(e.target.value)} className="input">
          <option value="">Select…</option>
          {(STATUS_FLOW[issue.status] || []).map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        {toStatus === 'RESOLVED' && (
          <div className="mt-3">
            <label className="label">After-photo (required)</label>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => setAfterFile(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} className="input flex items-center gap-2 text-left text-ink-500">
              <CameraIcon size={16} className="text-ink-400" />
              {afterFile ? afterFile.name : 'Choose after-photo…'}
            </button>
          </div>
        )}
        <label className="label mt-3">Note</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input resize-none" placeholder="Short note for the timeline" />
        <button onClick={changeStatus} disabled={busy} className="btn-primary mt-3 w-full">Update status</button>
      </div>

      <div>
        <label className="label">Assign department</label>
        <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="input">
          <option value="">Keep current ({issue.department_name || '—'})</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <label className="label mt-3">Assign officer</label>
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input">
          <option value="">No specific officer</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <button onClick={assign} disabled={busy} className="btn-outline mt-3 w-full">Assign</button>
      </div>

      <div className="md:col-span-2">
        <label className="label">Post official update</label>
        <div className="flex gap-2">
          <input
            value={officialUpdate}
            onChange={(e) => setOfficialUpdate(e.target.value)}
            placeholder="e.g. Crew dispatched, repair scheduled for tomorrow"
            className="input"
          />
          <button onClick={postUpdate} disabled={busy} className="btn-primary shrink-0">Post</button>
        </div>
      </div>
    </div>
  );
}
