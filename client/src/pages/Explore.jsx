import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { http } from '../lib/api.js';
import IssueCard from '../components/IssueCard.jsx';
import { EmptyState } from '../components/Spinner.jsx';
import { SkeletonGrid } from '../components/Skeleton.jsx';
import { useToast } from '../lib/toast.jsx';
import { MapIcon, SparklesIcon, ArrowLeftIcon, ArrowRightIcon, SearchIcon, XIcon } from '../components/icons.jsx';

const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [issues, setIssues] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [sort, setSort] = useState('newest');

  const [fStatus, setFStatus] = useState(params.get('status') || 'open');
  const [fCategory, setFCategory] = useState(params.get('category') || '');
  const [fSeverity, setFSeverity] = useState('');
  const [fSearch, setFSearch] = useState(params.get('q') || '');
  const [aiSearching, setAiSearching] = useState(false);
  const [aiError, setAiError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    http.get('/api/categories').then((d) => setCategories(d.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const p = {
      status: fStatus,
      category: fCategory,
      severity: fSeverity,
      sort,
      page,
      limit: 12,
    };
    if (fSearch.trim()) p.q = fSearch.trim();
    http
      .get('/api/issues', p)
      .then((d) => {
        setIssues(d.issues || []);
        setTotal(d.total || 0);
      })
      .catch(() => setIssues([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fStatus, fCategory, fSeverity, sort, page]);

  const reset = () => {
    setFStatus('');
    setFCategory('');
    setFSeverity('');
    setSort('newest');
    setPage(1);
  };

  const aiSearch = async () => {
    if (!fSearch.trim()) return;
    setAiSearching(true);
    setAiError('');
    try {
      const res = await http.post('/api/ai/parse-query', { q: fSearch.trim() });
      setPage(1);
      if (res.category) setFCategory(res.category);
      if (res.severity) setFSeverity(res.severity);
      if (res.status === 'open') setFStatus('open');
      else if (res.status === 'resolved') setFStatus('RESOLVED');
      else if (res.status === 'assigned') setFStatus('ASSIGNED');
      toast.info('AI search applied your filters');
    } catch (e) {
      setAiError(e.message);
      toast.error(e.message);
    } finally {
      setAiSearching(false);
    }
  };

  const searchForm = (e) => {
    e.preventDefault();
    setPage(1);
    setFCategory('');
    setFStatus('');
    setParams({ q: fSearch });
  };

  const selectClass = 'input w-auto';
  const select = (set) => (e) => (set(e.target.value), setPage(1));

  return (
    <div className="container-page py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Explore issues</h1>
          <p className="mt-1 text-sm text-ink-500">
            {loading ? 'Loading…' : <><span className="font-semibold text-ink-800">{total}</span> reports found</>}
            {q && <> for “<span className="font-semibold">{q}</span>”</>}
          </p>
        </div>
        <Link to="/map" className="btn-outline">
          <MapIcon size={16} /> Map view
        </Link>
      </div>

      {/* Search + toggle */}
      <form onSubmit={searchForm} className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={fSearch}
            onChange={(e) => setFSearch(e.target.value)}
            placeholder="Search title, description, area, #report no…"
            className="input pl-9"
          />
        </div>
        <button type="submit" className="btn-primary shrink-0">Search</button>
        <button
          type="button"
          onClick={aiSearch}
          disabled={aiSearching || !fSearch.trim()}
          className="btn-outline shrink-0 text-xs"
          title="Let AI understand your search"
        >
          <SparklesIcon size={14} />
          {aiSearching ? 'Parsing…' : 'AI search'}
        </button>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="btn-outline shrink-0 md:hidden"
          aria-expanded={filtersOpen}
        >
          {filtersOpen ? <XIcon size={16} /> : 'Filters'}
        </button>
      </form>

      {aiError && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {aiError}
        </p>
      )}

      {/* Filters */}
      <div className={`card mb-6 gap-3 p-4 ${filtersOpen ? 'flex flex-col md:flex md:flex-row md:flex-wrap md:items-center' : 'hidden md:flex md:flex-wrap md:items-center'}`}>
        <select value={fStatus} onChange={select(setFStatus)} className={selectClass} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="VERIFIED">Verified</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="REOPENED">Reopened</option>
        </select>
        <select value={fCategory} onChange={select(setFCategory)} className={selectClass} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <select value={fSeverity} onChange={select(setFSeverity)} className={selectClass} aria-label="Filter by severity">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={sort} onChange={select(setSort)} className={selectClass} aria-label="Sort issues">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="priority">Priority</option>
          <option value="confirmations">Most confirmed</option>
        </select>
        <button onClick={reset} className="btn-ghost text-xs md:ml-auto">Reset</button>
      </div>

      {loading ? (
        <SkeletonGrid count={6} />
      ) : issues.length === 0 ? (
        <EmptyState
          title="No issues match"
          body="Try clearing some filters, or report this issue yourself."
          action={
            <Link to="/report" className="btn-primary mt-2">+ Report an issue</Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {issues.map((i) => (
              <IssueCard key={i.id} issue={i} />
            ))}
          </div>
          <div className="mt-8 flex items-center justify-center gap-3">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-outline" aria-label="Previous page">
              <ArrowLeftIcon size={16} />
            </button>
            <span className="text-sm text-ink-500">Page {page}</span>
            <button disabled={page * 12 >= total} onClick={() => setPage((p) => p + 1)} className="btn-outline" aria-label="Next page">
              <ArrowRightIcon size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
