import { useEffect, useState } from 'react';
import { http } from '../lib/api.js';
import MapView from '../components/MapView.jsx';
import { PUNE_BOUNDS } from '../lib/constants.js';
import { FlameIcon, MapPinIcon } from '../components/icons.jsx';

const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

export default function MapPage() {
  const [issues, setIssues] = useState([]);
  const [heat, setHeat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [heatMode, setHeatMode] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = { ...PUNE_BOUNDS, status, severity, category };
    try {
      const [mapRes, heatRes] = await Promise.all([
        http.get('/api/map/issues', params),
        heatMode
          ? http.get('/api/map/heatmap', params)
          : Promise.resolve(null),
      ]);
      setIssues(mapRes.issues || []);
      setHeat(heatMode && heatRes ? heatRes.points || [] : null);
    } catch {
      setIssues([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, severity, category, heatMode]);

  useEffect(() => {
    http.get('/api/categories').then((d) => setCategories(d.categories || [])).catch(() => {});
  }, []);

  const selectClass =
    'input w-auto min-w-[140px] bg-white';

  return (
    <div>
      <div className="border-b border-ink-200 bg-white">
        <div className="container-page flex flex-wrap items-center gap-3 py-4">
          <h1 className="mr-auto text-lg font-bold text-ink-900">Live issues map</h1>

          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            <option value="open">Open issues</option>
            <option value="REPORTED">Reported</option>
            <option value="VERIFIED">Verified</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="VERIFIED_RESOLVED">Verified resolved</option>
            <option value="REOPENED">Reopened</option>
            <option value="">All statuses</option>
          </select>

          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={selectClass}>
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>{c.name}</option>
            ))}
          </select>

          <button
            onClick={() => setHeatMode((v) => !v)}
            className={`btn ${heatMode ? 'btn-primary' : 'btn-outline'}`}
          >
            <FlameIcon size={16} /> Heatmap
          </button>
        </div>
      </div>

      <div className="relative">
        <MapView
          issues={issues}
          heatPoints={heatMode ? heat : null}
          className="h-[60vh] min-h-[420px] sm:h-[calc(100vh-16rem)] sm:min-h-[480px]"
        />
        <div className="absolute bottom-5 left-1/2 z-[500] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 truncate rounded-full bg-white/95 px-4 py-2 text-xs font-medium shadow-lift sm:text-sm">
          {loading ? 'Loading…' : (
            <>
              <span className="font-bold text-ink-900">{issues.length}</span> issues shown
              <span className="mx-2 hidden text-ink-300 sm:inline">|</span>
              <span className="hidden items-center gap-1 sm:inline-flex">
                <MapPinIcon size={14} className="text-ink-500" /> Pune region
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
