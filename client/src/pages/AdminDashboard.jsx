import { useEffect, useRef, useState } from 'react';
import { http } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import Skeleton, { SkeletonStats } from '../components/Skeleton.jsx';
import Spinner from '../components/Spinner.jsx';
import { FolderIcon, FlameIcon, AlertIcon, CheckIcon, ClockIcon, BotIcon, UploadIcon, CameraIcon } from '../components/icons.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'officers', label: 'Officers' },
  { id: 'users', label: 'Users' },
  { id: 'categories', label: 'Categories & depts' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'locations', label: 'Locations' },
  { id: 'import', label: 'Import CSV' },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="container-page max-w-6xl py-8">
      <h1 className="text-2xl font-bold text-ink-900">Admin console</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`btn ${tab === t.id ? 'btn-primary' : 'btn-outline'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === 'overview' && <Overview />}
        {tab === 'resolved' && <Resolved />}
        {tab === 'officers' && <Officers />}
        {tab === 'users' && <Users />}
        {tab === 'categories' && <Categories />}
        {tab === 'moderation' && <Moderation />}
        {tab === 'locations' && <Locations />}
        {tab === 'import' && <ImportCsv />}
      </div>
    </div>
  );
}

/* ---------- Overview ---------- */
function Overview() {
  const [data, setData] = useState(null);

  const load = () => http.get('/api/admin/analytics').then((d) => setData(d)).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!data) {
    return (
      <div>
        <SkeletonStats count={5} cols="md:grid-cols-5" />
        <div className="card mt-6 space-y-3 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }
  const s = data.stats;

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { l: 'Total reports', v: s.total, icon: FolderIcon, accent: 'bg-ink-100 text-ink-600' },
          { l: 'Open', v: s.open, icon: FlameIcon, accent: 'bg-orange-100 text-orange-600' },
          { l: 'Critical', v: s.critical, icon: AlertIcon, accent: 'bg-red-100 text-red-600' },
          { l: 'Resolved', v: s.resolved, icon: CheckIcon, accent: 'bg-emerald-100 text-emerald-600' },
          { l: 'Avg fix (days)', v: s.avgResolutionDays, icon: ClockIcon, accent: 'bg-brand-50 text-brand-600' },
        ].map((x) => (
          <div key={x.l} className="card flex items-start gap-3 p-4">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${x.accent}`}>
              <x.icon size={18} />
            </span>
            <div>
              <p className="text-2xl font-extrabold leading-none text-ink-900">{x.v}</p>
              <p className="mt-1 text-xs text-ink-500">{x.l}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card mb-4 p-5">
        <h3 className="mb-4 font-semibold text-ink-900">Reports by category</h3>
        <div className="space-y-2">
          {data.categories.map((c) => (
            <div key={c.slug} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-sm text-ink-700 sm:w-44">{c.label}</span>
              <div className="h-2.5 flex-1 rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(c.total / Math.max(1, ...data.categories.map((x) => x.total))) * 100}%`,
                    backgroundColor: c.color,
                  }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs text-ink-500">{c.total} · {c.open} open</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Resolved (fixed) issues + proof upload ---------- */
function Resolved() {
  const [issues, setIssues] = useState([]);
  const [busyId, setBusyId] = useState('');
  const fileInput = useRef(null);
  const targetIssue = useRef(null);
  const toast = useToast();

  const load = () =>
    http
      .get('/api/admin/resolved-issues')
      .then((d) => setIssues(d.issues || []))
      .catch(() => {});
  useEffect(() => { load(); }, []);

  const pick = (issue) => {
    targetIssue.current = issue;
    fileInput.current?.click();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const issue = targetIssue.current;
    if (!file || !issue) return;
    setBusyId(issue.id);
    try {
      const fd = new FormData();
      fd.append('images', file);
      const up = await http.upload('/api/uploads/images', fd);
      const upload = up.uploads?.[0];
      if (!upload) throw new Error('Upload failed — no image returned');
      await http.post(`/api/admin/issues/${issue.id}/resolution-photo`, { imageId: upload.id });
      toast.success(`Photo attached to issue #${issue.public_id}`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId('');
    }
  };

  const last = issues[0];

  return (
    <div className="space-y-6">
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {last && (
        <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <CameraIcon size={20} />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Last reported issue — upload proof</p>
              <h3 className="font-semibold text-ink-900">#{last.public_id} · {last.title}</h3>
              <p className="text-sm text-ink-500">
                {last.area}{last.city ? `, ${last.city}` : ''} · {new Date(last.reported_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {last.after_url && (
              <a href={last.after_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                <CheckIcon size={16} /> has after-photo
              </a>
            )}
            <button onClick={() => pick(last)} disabled={busyId === last.id} className="btn-primary">
              {busyId === last.id ? 'Uploading…' : 'Upload resolution photo'}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="font-semibold text-ink-900">Resolved issues ({issues.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-ink-100 text-left text-xs text-ink-500">
            <tr>
              <th className="px-4 py-3">Issue</th>
              <th className="px-4 py-3">Reported</th>
              <th className="px-4 py-3">After photo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {issues.length === 0 && (
              <tr>
                <td colSpan="4" className="px-4 py-8 text-center text-ink-500">No resolved issues yet.</td>
              </tr>
            )}
            {issues.map((x) => (
              <tr key={x.id} className="border-t border-ink-100">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink-900">#{x.public_id} · {x.title}</p>
                  <p className="text-xs text-ink-500">{x.area}{x.city ? `, ${x.city}` : ''} · {x.status}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-600">{new Date(x.reported_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  {x.after_url ? (
                    <a href={x.after_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-medium text-emerald-600">
                      <img src={x.after_thumb || x.after_url} alt="after" className="h-9 w-9 rounded-lg object-cover" />
                      {x.after_count}
                    </a>
                  ) : (
                    <span className="text-xs text-ink-400">none</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => pick(x)} disabled={busyId === x.id} className="btn-outline">
                    {busyId === x.id ? 'Uploading…' : 'Upload'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Officers ---------- */
function Officers() {
  const [officers, setOfficers] = useState([]);
  const [depts, setDepts] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', department_id: '', is_active: true });
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState('');
  const toast = useToast();

  const load = () =>
    Promise.all([http.get('/api/admin/officers'), http.get('/api/departments')])
      .then(([o, d]) => {
        setOfficers(o.officers || []);
        setDepts(d.departments || []);
      })
      .catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    try {
      await http.post('/api/admin/officers', {
        name: form.name,
        email: form.email,
        password: form.password,
        department_id: form.department_id || null,
        is_active: form.is_active,
      });
      setForm({ name: '', email: '', password: '', department_id: '', is_active: true });
      setMsg({ type: 'ok', text: 'Officer account created' });
      toast.success('Officer account created');
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const toggleActive = async (o) => {
    setBusy(o.id);
    try {
      await http.patch(`/api/admin/officers/${o.id}`, { is_active: !o.is_active });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h3 className="font-semibold text-ink-900">Officers ({officers.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-ink-100 text-left text-xs text-ink-500">
            <tr>
              <th className="px-4 py-3">Officer</th>
              <th className="px-4 py-3">Dept</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {officers.map((o) => (
              <tr key={o.id} className="border-t border-ink-100">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink-900">{o.name} {o.is_demo && <span className="badge bg-brand-100 text-brand-700">demo</span>}</p>
                  <p className="text-xs text-ink-400">{o.email}</p>
                </td>
                <td className="px-4 py-3 text-ink-500">{o.department_name || '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleActive(o)} disabled={busy === o.id} className={`badge ${o.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {o.is_active ? 'Active' : 'Disabled'}
                  </button>
                </td>
              </tr>
            ))}
            {officers.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-ink-400">No officers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h3 className="mb-1 font-semibold text-ink-900">Create officer</h3>
        <p className="mb-4 text-sm text-ink-500">Officer accounts are provisioned here — there is no public officer signup.</p>
        {msg.text && (
          <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {msg.text}
          </div>
        )}
        <form onSubmit={create} className="space-y-3">
          <div>
            <label className="label">Full name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" required minLength={2} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" required />
          </div>
          <div>
            <label className="label">Department</label>
            <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className="input">
              <option value="">No department</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Account status</label>
            <select value={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.value === 'true' })} className="input">
              <option value="true">Active</option>
              <option value="false">Disabled</option>
            </select>
          </div>
          <div>
            <label className="label">Temporary password</label>
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" required minLength={8} placeholder="At least 8 characters" />
          </div>
          <button className="btn-primary w-full">Create officer</button>
        </form>
      </div>
    </div>
  );
}

/* ---------- Users ---------- */
function Users() {
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState('');
  const toast = useToast();

  const load = () => http.get('/api/admin/users').then((d) => setUsers(d.users || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const setRole = async (u, role) => {
    setBusy(u.id);
    try {
      await http.patch(`/api/admin/users/${u.id}`, { role });
      toast.success(`${u.name} updated`);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  const toggleActive = async (u) => {
    setBusy(u.id);
    try {
      await http.patch(`/api/admin/users/${u.id}`, { is_active: !u.is_active });
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-100 text-left text-xs text-ink-500">
          <tr>
            <th className="px-4 py-3">User</th>
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Dept</th>
            <th className="px-4 py-3">Reports</th>
            <th className="px-4 py-3">Joined</th>
            <th className="px-4 py-3">Active</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-ink-100">
              <td className="px-4 py-3">
                <p className="font-medium text-ink-900">{u.name} {u.is_demo && <span className="badge bg-brand-100 text-brand-700">demo</span>}</p>
                <p className="text-xs text-ink-400">{u.email}</p>
              </td>
              <td className="px-4 py-3">
                <select
                  value={u.role}
                  disabled={busy === u.id}
                  onChange={(e) => setRole(u, e.target.value)}
                  className="input w-auto !py-1.5 text-xs"
                >
                  {['citizen', 'moderator', 'officer', 'admin'].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3 text-ink-500">{u.department_name || '—'}</td>
              <td className="px-4 py-3 text-ink-500">{u.reports}</td>
              <td className="px-4 py-3 text-ink-500">{new Date(u.created_at).toLocaleDateString()}</td>
              <td className="px-4 py-3">
                <button onClick={() => toggleActive(u)} disabled={busy === u.id} className={`badge ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {u.is_active ? 'Active' : 'Disabled'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Categories & departments ---------- */
function Categories() {
  const [cats, setCats] = useState([]);
  const [depts, setDepts] = useState([]);
  const [form, setForm] = useState({ name: '', slug: '', description: '', icon: '', color: '#64748b', department_id: '' });
  const [msg, setMsg] = useState('');
  const toast = useToast();

  const load = () =>
    Promise.all([http.get('/api/admin/categories'), http.get('/api/departments')])
      .then(([c, d]) => {
        setCats(c.categories || []);
        setDepts(d.departments || []);
      })
      .catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await http.post('/api/admin/categories', { ...form, department_id: form.department_id || null });
      setForm({ name: '', slug: '', description: '', icon: '', color: '#64748b', department_id: '' });
      setMsg('Category created');
      toast.success('Category created');
      load();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const toggleActive = async (c) => {
    try {
      await http.patch(`/api/admin/categories/${c.id}`, { is_active: !c.is_active });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="mb-4 font-semibold text-ink-900">Categories ({cats.length})</h3>
        {msg && <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{msg}</p>}
        <div className="max-h-[480px] space-y-2 overflow-y-auto">
          {cats.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-xl border border-ink-100 p-3">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                <div>
                  <p className="text-sm font-medium text-ink-900">{c.name}</p>
                  <p className="text-xs text-ink-400">{c.slug} · {c.department_name || 'no dept'}</p>
                </div>
              </div>
              <button onClick={() => toggleActive(c)} className={`badge ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {c.is_active ? 'active' : 'inactive'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-4 font-semibold text-ink-900">Add category</h3>
        <form onSubmit={create} className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} className="input" required />
          </div>
          <div>
            <label className="label">Slug</label>
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="input" required />
          </div>
          <div>
            <label className="label">Department</label>
            <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className="input">
              <option value="">None</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Color</label>
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-11 w-full rounded-xl border border-ink-300" />
            </div>
            <div>
              <label className="label">Icon key</label>
              <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="input" placeholder="circle-dot" />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="input resize-none" />
          </div>
          <button className="btn-primary w-full">Create category</button>
        </form>
      </div>
    </div>
  );
}

/* ---------- Moderation ---------- */
function Moderation() {
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState('');
  const toast = useToast();

  const load = () => http.get('/api/admin/moderation/reports').then((d) => setReports(d.reports || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const resolve = async (r, status) => {
    setBusy(r.id);
    try {
      await http.patch(`/api/admin/moderation/reports/${r.id}`, { status, resolution_note: `Marked ${status} by admin` });
      toast.success(`Report ${status}`);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card overflow-x-auto">
      {reports.length === 0 ? (
        <p className="p-10 text-center text-ink-400">No moderation reports.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-ink-100 text-left text-xs text-ink-500">
            <tr>
              <th className="px-4 py-3">Report</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Reported by</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-t border-ink-100">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink-900">
                    {r.issue_title ? `Issue #${r.public_id}` : 'Comment'}
                  </p>
                  {r.comment_body && <p className="max-w-[220px] truncate text-xs text-ink-400">"{r.comment_body}"</p>}
                </td>
                <td className="max-w-[260px] px-4 py-3 text-ink-500">{r.reason}</td>
                <td className="px-4 py-3 text-ink-500">
                  {r.is_ai ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                      <BotIcon size={12} /> AI
                    </span>
                  ) : (
                    r.reporter_name || '—'
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${r.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {r.status === 'open' && (
                    <div className="flex gap-1">
                      <button disabled={busy === r.id} onClick={() => resolve(r, 'resolved')} className="btn-outline !px-2 !py-1 text-xs">Resolve</button>
                      <button disabled={busy === r.id} onClick={() => resolve(r, 'dismissed')} className="btn-ghost !px-2 !py-1 text-xs text-red-600">Dismiss</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- Locations ---------- */
function Locations() {
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({ name: '', city: '', area: '', lat: '', lng: '', radius_m: 1000 });
  const toast = useToast();

  const load = () => http.get('/api/admin/locations').then((d) => setLocations(d.locations || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await http.post('/api/admin/locations', { ...form, lat: Number(form.lat), lng: Number(form.lng), radius_m: Number(form.radius_m) });
      setForm({ name: '', city: '', area: '', lat: '', lng: '', radius_m: 1000 });
      toast.success('Location saved');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="mb-4 font-semibold text-ink-900">Saved locations</h3>
        <div className="space-y-2">
          {locations.map((l) => (
            <div key={l.id} className="rounded-xl border border-ink-100 p-3">
              <p className="text-sm font-medium text-ink-900">{l.name}</p>
              <p className="text-xs text-ink-400">
                {l.area && `${l.area}, `}{l.city || ''} · {Number(l.lat).toFixed(4)}, {Number(l.lng).toFixed(4)} · r={l.radius_m}m
              </p>
            </div>
          ))}
          {!locations.length && <p className="text-sm text-ink-400">No saved locations.</p>}
        </div>
      </div>
      <div className="card p-5">
        <h3 className="mb-4 font-semibold text-ink-900">Add location</h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Area</label>
              <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">City</label>
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="input" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Lat</label>
              <input type="number" step="any" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="input" required />
            </div>
            <div>
              <label className="label">Lng</label>
              <input type="number" step="any" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className="input" required />
            </div>
            <div>
              <label className="label">Radius (m)</label>
              <input type="number" value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: e.target.value })} className="input" />
            </div>
          </div>
          <button className="btn-primary w-full">Save location</button>
        </form>
      </div>
    </div>
  );
}

/* ---------- Import CSV ---------- */
const CSV_TEMPLATE = [
  'title,description,category,severity,status,lat,lng,address,area,city,landmark,created_at,reporter_email',
  'Street light not working since last week,The pole near the bus stop has been dark for a week.,broken-streetlight,HIGH,VERIFIED,18.5589,73.8126,Baner Road,Baner,Pune,Near the bus stop,2026-01-15,',
  'Large pothole on the main road,Pothole deep enough to damage two-wheelers.,pothole,CRITICAL,REPORTED,18.512,73.854,Kothrud Depot Road,Kothrud,Pune,,2026-02-01,citizen@example.com',
].join('\n');

function ImportCsv() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const toast = useToast();

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'civiceye-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return toast.error('Choose a CSV file first');
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await http.upload('/api/admin/issues/import', fd);
      setResult(r);
      toast.success(`${r.imported} issues imported`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-ink-900">
          <UploadIcon size={16} className="text-brand-600" /> Bulk import issues
        </h3>
        <p className="text-sm text-ink-500">
          Upload a CSV of legacy or external issues. Columns:{' '}
          <code className="rounded bg-ink-100 px-1">title</code>,{' '}
          <code className="rounded bg-ink-100 px-1">description</code>,{' '}
          <code className="rounded bg-ink-100 px-1">category</code> (slug or name),{' '}
          <code className="rounded bg-ink-100 px-1">severity</code>,{' '}
          <code className="rounded bg-ink-100 px-1">status</code>,{' '}
          <code className="rounded bg-ink-100 px-1">lat</code>,{' '}
          <code className="rounded bg-ink-100 px-1">lng</code>, and optional{' '}
          <code className="rounded bg-ink-100 px-1">address / area / city / landmark / created_at / reporter_email</code>.
        </p>
        <button onClick={downloadTemplate} className="btn-outline mt-3 text-sm">Download CSV template</button>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="input"
          />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Spinner className="h-4 w-4" /> Importing…
              </span>
            ) : (
              'Import CSV'
            )}
          </button>
        </form>
      </div>

      {result && (
        <div className="card p-5">
          <h3 className="mb-3 font-semibold text-ink-900">Import result</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-50 p-4 text-center">
              <p className="text-2xl font-extrabold text-emerald-700">{result.imported}</p>
              <p className="text-xs text-emerald-700">imported</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-4 text-center">
              <p className="text-2xl font-extrabold text-amber-700">{result.skipped}</p>
              <p className="text-xs text-amber-700">skipped</p>
            </div>
          </div>
          {result.errors?.length > 0 && (
            <div className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-xl bg-red-50 p-3">
              {result.errors.map((err, i) => (
                <p key={i} className="text-xs text-red-700">
                  Row {err.row}: {err.error}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
