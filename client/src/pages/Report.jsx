import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { http } from '../lib/api.js';
import MapView from '../components/MapView.jsx';
import { SEVERITIES } from '../lib/constants.js';
import Spinner from '../components/Spinner.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  CameraIcon,
  BotIcon,
  AlertIcon,
  MapPinIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  SendIcon,
  SparklesIcon,
  CheckIcon,
  XIcon,
  UploadIcon,
  FilmIcon,
  MicIcon,
} from '../components/icons.jsx';

const MAX_IMAGES = 8;
const MAX_MEDIA = 4;
let fileSeq = 0;

function compressImage(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.size < 1024 * 1024) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file);
        },
        'image/jpeg',
        0.82,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function fileEntry(file) {
  const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio';
  return { id: ++fileSeq, file, type, url: URL.createObjectURL(file) };
}

const SEVERITY_META = {
  LOW: { label: 'Low', emoji: '🟢', desc: 'Minor inconvenience', color: 'border-emerald-400 bg-emerald-50 text-emerald-800' },
  MODERATE: { label: 'Moderate', emoji: '🟡', desc: 'Affects daily life', color: 'border-amber-400 bg-amber-50 text-amber-800' },
  HIGH: { label: 'High', emoji: '🟠', desc: 'Significant impact', color: 'border-orange-400 bg-orange-50 text-orange-800' },
  CRITICAL: { label: 'Critical', emoji: '🔴', desc: 'Safety risk / urgent', color: 'border-red-500 bg-red-50 text-red-800' },
};

const STEPS = [
  { n: 1, label: 'Category & Media', icon: '📸' },
  { n: 2, label: 'Details', icon: '📝' },
  { n: 3, label: 'Location & Submit', icon: '📍' },
];

export default function Report() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [step, setStep] = useState(1);

  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('MODERATE');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');
  const [landmark, setLandmark] = useState('');
  const [picked, setPicked] = useState(null);
  const [areaApprox, setAreaApprox] = useState(false);
  const [locError, setLocError] = useState('');

  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const photoRef = useRef(null);
  const mediaRef = useRef(null);

  const [dups, setDups] = useState(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [ai, setAi] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiApplied, setAiApplied] = useState(false);
  const [official, setOfficial] = useState(null);
  const [officialLoading, setOfficialLoading] = useState(false);

  useEffect(() => {
    http.get('/api/categories').then((d) => setCategories(d.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!picked) { setOfficial(null); return; }
    let cancelled = false;
    setOfficialLoading(true);
    setOfficial(null);
    http.get('/api/locations/lookup', { lat: picked[0], lng: picked[1] })
      .then((d) => {
        if (cancelled) return;
        if (d.match?.id) return http.get(`/api/locations/${d.match.id}/official`).then((o) => { if (!cancelled) setOfficial(o); });
        if (!cancelled) setOfficial(null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setOfficialLoading(false); });
    return () => { cancelled = true; };
  }, [picked && picked[0], picked && picked[1]]);

  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    const timer = setTimeout(() => {}, 12000);
    setLocError('');
    http.get('/api/locations/reverse', { lat: picked[0], lng: picked[1] })
      .then((d) => {
        if (cancelled) return;
        if (d.address) setAddress((prev) => prev || d.address);
        if (d.area) setArea((prev) => prev || d.area);
        if (d.landmark) setLandmark((prev) => prev || d.landmark);
        if (d.city) setCity((prev) => prev || d.city);
        setAreaApprox(!!d.locality?.approximate);
      })
      .catch(() => { if (!cancelled) setLocError('Could not auto-fill location. Please type below.'); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [picked && picked[0], picked && picked[1]]);

  useEffect(() => {
    if (step !== 3 || !picked || !categoryId) { setDups(null); return; }
    let cancelled = false;
    setDupLoading(true);
    setDups(null);
    const timer = setTimeout(() => {
      http.post('/api/ai/check-duplicate', { lat: picked[0], lng: picked[1], categoryId })
        .then((d) => { if (!cancelled) setDups((d.matches || []).slice(0, 3)); })
        .catch(() => { if (!cancelled) setDups([]); })
        .finally(() => { if (!cancelled) setDupLoading(false); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [step, picked && picked[0], picked && picked[1], categoryId]);

  const locateMe = () => {
    if (!navigator.geolocation) { setError('Geolocation not supported'); return; }
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => setPicked([pos.coords.latitude, pos.coords.longitude]),
      () => setError('Could not get location — tap the map to drop a pin'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const addFiles = async (incoming) => {
    if (!incoming.length) return;
    setProcessing(true);
    setError('');
    setAiApplied(false);
    const newFiles = [];
    for (const f of incoming) {
      if (f.type.startsWith('image/')) {
        if (files.length + newFiles.filter((x) => x.type === 'image').length >= MAX_IMAGES) break;
        newFiles.push(fileEntry(await compressImage(f)));
      } else if (f.type.startsWith('video/') || f.type.startsWith('audio/')) {
        if (files.length + newFiles.filter((x) => x.type !== 'image').length >= MAX_MEDIA) break;
        newFiles.push(fileEntry(f));
      }
    }
    setFiles((prev) => [...prev, ...newFiles]);
    setProcessing(false);
    const firstImage = newFiles.find((x) => x.type === 'image');
    if (firstImage && !ai && !aiLoading) analyzePhoto(firstImage.file);
  };

  const onPhotos = async (e) => { await addFiles(Array.from(e.target.files || []).slice(0, MAX_IMAGES)); e.target.value = ''; };
  const onMedia = async (e) => { await addFiles(Array.from(e.target.files || []).slice(0, MAX_MEDIA)); e.target.value = ''; };
  const onDrop = async (e) => { e.preventDefault(); setDragging(false); await addFiles(Array.from(e.dataTransfer?.files || [])); };

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (files.length === 1) { setAi(null); setAiError(''); setAiApplied(false); }
  };

  const analyzePhoto = async (file) => {
    setAiLoading(true); setAiError(''); setAi(null);
    try {
      const fd = new FormData();
      fd.append('images', file);
      const res = await http.upload('/api/ai/analyze-image', fd);
      setAi({ analysis: res.analysis, analysisId: res.analysisId });
    } catch (err) {
      setAiError(err.message || 'AI analysis failed — you can still continue manually.');
    } finally { setAiLoading(false); }
  };

  const applyAi = () => {
    if (!ai) return;
    const a = ai.analysis;
    const match = categories.find((c) => c.slug === a.category);
    if (match) setCategoryId(match.id);
    if (a.severity) setSeverity(a.severity);
    if (!title.trim() && a.description) setTitle(a.description.charAt(0).toUpperCase() + a.description.slice(1));
    setDescription((prev) => prev || a.description || '');
    setAiApplied(true);
  };

  const uploadFiles = async () => {
    const imageFiles = files.filter((f) => f.type === 'image');
    const mediaFiles = files.filter((f) => f.type !== 'image');
    const ids = [];
    if (imageFiles.length) {
      setUploading('images');
      const fd = new FormData();
      imageFiles.forEach((f) => fd.append('images', f.file));
      const res = await http.upload('/api/uploads/images', fd);
      ids.push(...(res.uploads || []).map((u) => u.id));
    }
    if (mediaFiles.length) {
      setUploading('media');
      const fd = new FormData();
      mediaFiles.forEach((f) => fd.append('media', f.file));
      const res = await http.upload('/api/uploads/media', fd);
      ids.push(...(res.uploads || []).map((u) => u.id));
    }
    return ids;
  };

  const submit = async () => {
    setError('');
    if (!categoryId) return setError('Please choose a category');
    if (!picked) return setError('Please drop a pin on the map');
    if (!title.trim()) return setError('Please give your report a title');
    if (!files.length) return setError('Please attach at least one photo');
    setSubmitting(true);
    try {
      const uploadIds = await uploadFiles();
      const res = await http.post('/api/issues', {
        categoryId, title: title.trim(), description: description.trim(), severity,
        lat: picked[0], lng: picked[1], address: address.trim(), area: area.trim(),
        city: city.trim(), landmark: landmark.trim(),
        isAnonymous: isAnonymous || !user, imageIds: uploadIds, aiAnalysisId: ai?.analysisId,
      });
      const issue = res.issue;
      navigate(`/issues/${issue.public_id ?? issue.id}`);
    } catch (err) {
      setError(err.message || 'Failed to submit report');
    } finally { setSubmitting(false); setUploading(''); }
  };

  const imageCount = files.filter((f) => f.type === 'image').length;
  const mediaCount = files.filter((f) => f.type !== 'image').length;
  const selectedCategory = categories.find((c) => c.id === categoryId);

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg, #f0f7ff 0%, #f8fafc 60%, #f0fdf4 100%)' }}>
      {/* Page header */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a56db 100%)' }} className="py-8 text-white">
        <div className="container-page max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 text-xl backdrop-blur">📸</span>
            <div>
              <h1 className="text-2xl font-black tracking-tight">Report an issue</h1>
              {user ? (
                <p className="mt-0.5 text-sm text-blue-200">
                  Signed in as <span className="font-semibold text-white">{user.name}</span> · A photo + pin = faster action by city departments.
                </p>
              ) : (
                <p className="mt-0.5 text-sm text-blue-200">
                  Reporting as a <span className="font-semibold text-white">guest</span> (anonymous).{' '}
                  <Link to="/citizen/login" className="font-semibold text-white underline hover:no-underline">Sign in</Link> to track your reports.
                </p>
              )}
            </div>
          </div>

          {/* Progress stepper */}
          <div className="mt-6 flex items-center gap-0">
            {STEPS.map((s, i) => {
              const done = step > s.n;
              const active = step === s.n;
              return (
                <div key={s.n} className="flex flex-1 items-center">
                  <button
                    onClick={() => s.n < step && setStep(s.n)}
                    aria-current={active ? 'step' : undefined}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black transition ${
                      active ? 'bg-white text-blue-700 shadow-lg ring-4 ring-white/30'
                      : done ? 'bg-emerald-400 text-white shadow'
                      : 'bg-white/20 text-white/60'
                    } ${s.n < step ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
                  >
                    {done ? <CheckIcon size={16} /> : s.n}
                  </button>
                  <div className="ml-2 hidden sm:block">
                    <p className={`text-xs font-bold ${active ? 'text-white' : done ? 'text-emerald-300' : 'text-white/50'}`}>{s.icon} {s.label}</p>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`mx-3 h-0.5 flex-1 rounded-full transition-all ${done ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="container-page max-w-3xl py-8">
        {/* Error banner */}
        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            <AlertIcon size={18} className="mt-0.5 shrink-0 text-red-500" />
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto shrink-0 text-red-400 hover:text-red-600"><XIcon size={16} /></button>
          </div>
        )}

        {/* ─── STEP 1: Category & Media ─── */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Category card */}
            <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
              <div className="mb-4 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-sm">🗂️</span>
                <h2 className="font-bold text-ink-900">Pick a category</h2>
                <span className="ml-auto rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold text-ink-500">STEP 1 OF 3</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {categories.map((c) => {
                  const selected = categoryId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCategoryId(c.id)}
                      className={`group relative rounded-2xl border-2 p-3 text-center transition-all hover:-translate-y-0.5 hover:shadow-md ${
                        selected ? 'border-brand-500 bg-brand-50 shadow-md' : 'border-ink-200 bg-white hover:border-brand-300'
                      }`}
                    >
                      {selected && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white shadow">
                          <CheckIcon size={11} />
                        </span>
                      )}
                      <span
                        className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white shadow-sm"
                        style={{ backgroundColor: c.color || '#64748b' }}
                      >
                        {c.icon || '•'}
                      </span>
                      <span className={`mt-2 block break-words text-[12px] font-bold leading-tight ${selected ? 'text-brand-800' : 'text-ink-800'}`}>
                        {c.name}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-ink-400">{c.department_name || 'City dept'}</span>
                    </button>
                  );
                })}
              </div>
              {selectedCategory && (
                <p className="mt-3 flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-700">
                  <CheckIcon size={13} className="text-brand-500" />
                  Will be routed to <span className="font-bold">{selectedCategory.department_name || 'City department'}</span>
                </p>
              )}
            </div>

            {/* Media upload card */}
            <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
              <div className="mb-4 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-sm">📷</span>
                <h2 className="font-bold text-ink-900">Add photos / video / voice</h2>
                <span className="ml-auto text-xs text-ink-400">Max {MAX_IMAGES} photos · {MAX_MEDIA} clips</span>
              </div>

              <input ref={photoRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={onPhotos} />
              <input ref={mediaRef} type="file" accept="video/*,audio/*" multiple hidden onChange={onMedia} />

              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`rounded-2xl border-2 border-dashed p-4 transition-all ${
                  dragging ? 'border-brand-500 bg-brand-50 scale-[1.01]' : 'border-ink-200 bg-ink-50/50 hover:border-brand-300'
                }`}
              >
                {files.length === 0 && (
                  <div className="py-6 text-center">
                    <span className="text-4xl">📁</span>
                    <p className="mt-2 text-sm font-semibold text-ink-700">Drop files here or tap a button below</p>
                    <p className="text-xs text-ink-400">Photos, videos, or voice notes — max 8 photos & 4 clips</p>
                    <div className="mt-4 flex justify-center gap-3">
                      <button
                        onClick={() => photoRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-700 transition"
                      >
                        <CameraIcon size={16} /> Add Photos
                      </button>
                      <button
                        onClick={() => mediaRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-xl border border-ink-300 bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition"
                      >
                        <FilmIcon size={16} /> Add Video/Voice
                      </button>
                    </div>
                  </div>
                )}

                {files.length > 0 && (
                  <>
                    <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5 md:grid-cols-6">
                      {files.map((f) => (
                        <div key={f.id} className="group relative aspect-square overflow-hidden rounded-xl bg-ink-100 shadow-sm">
                          {f.type === 'image' ? (
                            <img src={f.url} alt="upload preview" className="h-full w-full object-cover" />
                          ) : f.type === 'video' ? (
                            <video src={f.url} muted className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center bg-violet-50 text-violet-600">
                              <MicIcon size={24} />
                              <span className="mt-1 max-w-full truncate px-1 text-[9px] font-medium text-violet-700">{f.file.name}</span>
                            </div>
                          )}
                          {f.type !== 'image' && (
                            <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-ink-900/75 px-1.5 py-0.5 text-[9px] font-bold text-white">
                              {f.type === 'video' ? <FilmIcon size={9} /> : <MicIcon size={9} />}
                              {f.type === 'video' ? 'VID' : 'VOICE'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeFile(f.id)}
                            aria-label="Remove file"
                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-600"
                          >
                            <XIcon size={11} />
                          </button>
                        </div>
                      ))}
                      {imageCount < MAX_IMAGES && (
                        <button
                          onClick={() => photoRef.current?.click()}
                          className="flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-300 bg-white text-ink-400 transition hover:border-brand-400 hover:text-brand-600"
                        >
                          <CameraIcon size={20} />
                          <span className="text-[10px] font-semibold mt-1">Photo</span>
                        </button>
                      )}
                      {mediaCount < MAX_MEDIA && (
                        <button
                          onClick={() => mediaRef.current?.click()}
                          className="flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-300 bg-white text-ink-400 transition hover:border-brand-400 hover:text-brand-600"
                        >
                          <UploadIcon size={20} />
                          <span className="text-[10px] font-semibold mt-1">Video</span>
                        </button>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs text-ink-400">{files.length} file{files.length !== 1 ? 's' : ''} added</p>
                      <button onClick={() => { setFiles([]); setAi(null); setAiError(''); setAiApplied(false); }} className="text-xs font-semibold text-red-500 hover:text-red-700 hover:underline">
                        Clear all
                      </button>
                    </div>
                  </>
                )}

                {processing && (
                  <p className="mt-2 flex items-center justify-center gap-2 text-xs text-brand-600">
                    <Spinner className="h-3.5 w-3.5" /> Compressing photos…
                  </p>
                )}
              </div>

              {/* AI Analysis result */}
              {(aiLoading || ai) && (
                <div className={`mt-4 overflow-hidden rounded-2xl border ${ai && !aiLoading ? 'border-violet-200 bg-gradient-to-br from-violet-50 to-blue-50' : 'border-brand-200 bg-brand-50'} p-4`}>
                  {aiLoading ? (
                    <div className="flex items-center gap-3 text-sm text-brand-700">
                      <Spinner className="h-5 w-5" />
                      <div>
                        <p className="font-bold">AI is reviewing your photo…</p>
                        <p className="text-xs text-brand-500">Detecting category, severity and description</p>
                      </div>
                    </div>
                  ) : ai && (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                            <BotIcon size={16} />
                          </span>
                          <div>
                            <p className="text-sm font-bold text-violet-900">AI Photo Analysis</p>
                            <p className="text-[11px] text-violet-500">Gemini Vision · {Math.round((ai.analysis.confidence || 0) * 100)}% confidence</p>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
                          (ai.analysis.confidence || 0) > 0.7 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {Math.round((ai.analysis.confidence || 0) * 100)}% confident
                        </span>
                      </div>
                      <div className="mt-3 rounded-xl bg-white/70 p-3 text-sm text-ink-800">
                        Looks like <span className="font-bold text-violet-800">{ai.analysis.categoryLabel}</span>
                        {ai.analysis.severity && <> · severity <span className="font-bold">{ai.analysis.severity}</span></>}
                        {ai.analysis.description ? ` — ${ai.analysis.description}` : ''}
                      </div>
                      {ai.analysis.relevant === false && (
                        <p className="mt-2 flex items-center gap-2 rounded-xl bg-red-100 px-3 py-2 text-xs text-red-700">
                          <AlertIcon size={14} /> AI thinks this photo may not be a civic issue. Please check your image.
                        </p>
                      )}
                      {ai.analysis.tamperSuspected && (
                        <p className="mt-2 flex items-center gap-2 rounded-xl bg-red-100 px-3 py-2 text-xs text-red-700">
                          <AlertIcon size={14} /> AI suspects the photo may have been edited or re-used.
                        </p>
                      )}
                      {ai.analysis.safetyRisk === 'high' && (
                        <p className="mt-2 flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-xs text-amber-800">
                          <AlertIcon size={14} /> ⚠️ High safety risk — please report quickly.
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={applyAi}
                          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-violet-700 transition"
                        >
                          <SparklesIcon size={14} />
                          {aiApplied ? 'Re-apply AI suggestion' : 'Use AI suggestion'}
                        </button>
                        <button onClick={() => setAi(null)} className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-ink-50 transition">
                          Dismiss
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {aiError && !ai && !aiLoading && (
                <p className="mt-2 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
                  <AlertIcon size={13} /> {aiError}
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                disabled={!categoryId}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-8 py-3 text-base font-bold text-white shadow-lg transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue <ArrowRightIcon size={18} />
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 2: Details ─── */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
              <div className="mb-5 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-sm">📝</span>
                <h2 className="font-bold text-ink-900">Describe the problem</h2>
                <span className="ml-auto rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold text-ink-500">STEP 2 OF 3</span>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="label flex items-center gap-1.5">
                    <span className="text-red-500">*</span> Short title
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Large pothole near Hinjewadi Phase 1 chowk"
                    className="input"
                  />
                  <p className="mt-1 text-right text-[11px] text-ink-400">{title.length}/200</p>
                </div>

                <div>
                  <label className="label">Description <span className="ml-1 text-xs font-normal text-ink-400">(optional but helps)</span></label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={5000}
                    placeholder="How long has it been there? Is it getting worse? Who is affected?"
                    className="input resize-none"
                  />
                </div>

                {/* Severity */}
                <div>
                  <label className="label">Severity</label>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {SEVERITIES.map((s) => {
                      const m = SEVERITY_META[s] || {};
                      const selected = severity === s;
                      return (
                        <button
                          key={s}
                          onClick={() => setSeverity(s)}
                          className={`relative rounded-2xl border-2 p-3 text-center transition-all hover:-translate-y-0.5 ${
                            selected ? m.color + ' shadow-md' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300'
                          }`}
                        >
                          {selected && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-white">
                              <CheckIcon size={10} />
                            </span>
                          )}
                          <span className="text-xl">{m.emoji || '⚪'}</span>
                          <p className="mt-1 text-sm font-bold">{m.label || s}</p>
                          <p className="text-[10px] text-ink-500">{m.desc || ''}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Anonymous toggle */}
                {user && (
                  <div className="flex items-center justify-between rounded-2xl bg-ink-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-ink-800">Report anonymously</p>
                      <p className="text-xs text-ink-500">Your name won't be shown on the public issue page.</p>
                    </div>
                    <button
                      onClick={() => setIsAnonymous((v) => !v)}
                      className={`relative h-7 w-12 rounded-full transition-all ${isAnonymous ? 'bg-brand-600' : 'bg-ink-300'}`}
                      aria-pressed={isAnonymous}
                    >
                      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${isAnonymous ? 'left-[26px]' : 'left-1'}`} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="inline-flex items-center gap-2 rounded-2xl border border-ink-300 bg-white px-6 py-3 font-semibold text-ink-700 hover:bg-ink-50 transition">
                <ArrowLeftIcon size={16} /> Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!title.trim()}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-8 py-3 text-base font-bold text-white shadow-lg transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue <ArrowRightIcon size={18} />
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 3: Location & Submit ─── */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-sm">📍</span>
                  <div>
                    <h2 className="font-bold text-ink-900">Pin the exact location</h2>
                    <p className="text-xs text-ink-500">Tap the map or use GPS to mark the spot.</p>
                  </div>
                </div>
                <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold text-ink-500">STEP 3 OF 3</span>
              </div>

              <div className="mb-3 flex justify-end">
                <button
                  onClick={locateMe}
                  className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-100 transition"
                >
                  <MapPinIcon size={15} /> Use my GPS location
                </button>
              </div>

              <MapView onPick={setPicked} pickActive picked={picked} className="h-[340px] rounded-2xl border border-ink-200" />

              {picked ? (
                <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                  <MapPinIcon size={13} className="text-emerald-600" />
                  Pin set · {picked[0].toFixed(5)}, {picked[1].toFixed(5)}
                </p>
              ) : (
                <p className="mt-2 text-center text-xs text-ink-400">Tap the map above to drop a pin 👆</p>
              )}
            </div>

            {/* Duplicate check */}
            {dupLoading && (
              <div className="flex items-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-500 shadow-sm">
                <Spinner className="h-4 w-4 text-brand-600" />
                Checking for similar reports nearby…
              </div>
            )}
            {!dupLoading && dups && dups.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
                  <AlertIcon size={15} /> 🔍 Similar reports already exist nearby
                </p>
                <div className="mt-3 space-y-2">
                  {dups.map((d) => (
                    <Link
                      key={d.issueId}
                      to={`/issues/${d.publicId}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm transition hover:bg-amber-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-800">#{d.publicId} · {d.title}</p>
                        <p className="text-xs text-ink-500">{d.category} · {d.distance}m away · {d.confirmations} confirmed</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-black text-amber-800">{d.similarity.total}% match</span>
                    </Link>
                  ))}
                </div>
                <p className="mt-2 text-xs text-amber-700">💡 You can open an existing report and confirm it instead — helps keep the map clean.</p>
              </div>
            )}

            {/* Official lookup */}
            {picked && (
              <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-ink-400">Who leads this area</p>
                {officialLoading ? (
                  <div className="flex items-center gap-2 text-sm text-ink-500"><Spinner /> Looking up responsible ward official…</div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-black text-ink-900">
                        {official?.official?.officerName || `${area || 'Local Ward'} Representative`}
                      </p>
                      <p className="text-sm font-semibold text-brand-700">
                        {official?.official?.officerRole || 'Nagar Sevak (Corporator)'}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {area || official?.locality?.name || 'Local Area'} · {official?.official?.authority || `${city || 'Pune'} Municipal Area`}
                        {official?.official?.ward ? ` · ${official.official.ward}` : ''}
                      </p>
                      <span className="mt-1.5 inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">
                        {official?.official?.officerParty || 'Elected Ward Member'}
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-bold uppercase text-violet-700">
                      <SparklesIcon size={11} /> AI mapped
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Address fields */}
            <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-bold text-ink-800">📋 Location details <span className="text-xs font-normal text-ink-400">(auto-filled from pin)</span></p>
              <div className="space-y-4">
                <div>
                  <label className="label">Street / address</label>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Nearest address or description" className="input" />
                  {locError && <p className="mt-1 text-xs text-red-600">{locError}</p>}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Area / locality</label>
                    <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Baner" className="input" />
                    {areaApprox && <p className="mt-1 text-[11px] text-ink-400">Nearest locality — adjust if needed.</p>}
                  </div>
                  <div>
                    <label className="label">Landmark <span className="text-xs font-normal text-ink-400">(optional)</span></label>
                    <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="e.g. near the bus stop" className="input" />
                  </div>
                </div>
              </div>
            </div>

            {/* Summary preview */}
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-600">📋 Report summary</p>
              <div className="grid gap-1.5 text-sm text-ink-700">
                <p><span className="font-semibold">Category:</span> {selectedCategory?.name || '—'}</p>
                <p><span className="font-semibold">Title:</span> {title || '—'}</p>
                <p><span className="font-semibold">Severity:</span> {SEVERITY_META[severity]?.emoji} {severity}</p>
                <p><span className="font-semibold">Media:</span> {files.length} file{files.length !== 1 ? 's' : ''}</p>
                <p><span className="font-semibold">Location:</span> {picked ? `${picked[0].toFixed(4)}, ${picked[1].toFixed(4)}` : 'Not set'}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button onClick={() => setStep(2)} className="inline-flex items-center gap-2 rounded-2xl border border-ink-300 bg-white px-6 py-3 font-semibold text-ink-700 hover:bg-ink-50 transition">
                <ArrowLeftIcon size={16} /> Back
              </button>
              <button
                onClick={submit}
                disabled={submitting || !!uploading || processing}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-10 py-3 text-base font-black text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting || uploading ? (
                  <>
                    <Spinner />
                    {uploading === 'media' ? 'Transcoding video…' : uploading === 'images' ? 'Uploading photos…' : 'Submitting…'}
                  </>
                ) : (
                  <><SendIcon size={18} /> Submit Report</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
