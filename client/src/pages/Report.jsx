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
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(
            blob
              ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
              : file,
          );
        },
        'image/jpeg',
        0.82,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function fileEntry(file) {
  const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio';
  return { id: ++fileSeq, file, type, url: URL.createObjectURL(file) };
}

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
    http.get('/api/categories').then((d) => {
      setCategories(d.categories || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!picked) {
      setOfficial(null);
      return;
    }
    let cancelled = false;
    setOfficialLoading(true);
    setOfficial(null);
    http
      .get('/api/locations/lookup', { lat: picked[0], lng: picked[1] })
      .then((d) => {
        if (cancelled) return;
        if (d.match?.id) {
          return http.get(`/api/locations/${d.match.id}/official`).then((o) => {
            if (!cancelled) setOfficial(o);
          });
        }
        if (!cancelled) setOfficial(null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setOfficialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [picked && picked[0], picked && picked[1]]);

  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    setLocError('');
    http
      .get('/api/locations/reverse', { lat: picked[0], lng: picked[1] })
      .then((d) => {
        if (cancelled) return;
        if (d.address) setAddress((prev) => prev || d.address);
        if (d.area) setArea((prev) => prev || d.area);
        if (d.landmark) setLandmark((prev) => prev || d.landmark);
        if (d.city) setCity((prev) => prev || d.city);
        setAreaApprox(!!d.locality?.approximate);
      })
      .catch(() => {
        if (!cancelled) {
          setLocError('Could not auto-fill the location details. Please type them below.');
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picked && picked[0], picked && picked[1]]);

  // Pre-submit duplicate warning once we know category + location
  useEffect(() => {
    if (step !== 3 || !picked || !categoryId) {
      setDups(null);
      return;
    }
    let cancelled = false;
    setDupLoading(true);
    setDups(null);
    const timer = setTimeout(() => {
      http
        .post('/api/ai/check-duplicate', { lat: picked[0], lng: picked[1], categoryId })
        .then((d) => {
          if (!cancelled) setDups((d.matches || []).slice(0, 3));
        })
        .catch(() => {
          if (!cancelled) setDups([]);
        })
        .finally(() => {
          if (!cancelled) setDupLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, picked && picked[0], picked && picked[1], categoryId]);

  const locateMe = () => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported in this browser');
      return;
    }
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => setPicked([pos.coords.latitude, pos.coords.longitude]),
      () => setError('Could not get your location — tap the map to drop a pin instead'),
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

  const onPhotos = async (e) => {
    const arr = Array.from(e.target.files || []).slice(0, MAX_IMAGES);
    await addFiles(arr);
    e.target.value = '';
  };

  const onMedia = async (e) => {
    const arr = Array.from(e.target.files || []).slice(0, MAX_MEDIA);
    await addFiles(arr);
    e.target.value = '';
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    await addFiles(Array.from(e.dataTransfer?.files || []));
  };

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (files.length === 1) {
      setAi(null);
      setAiError('');
      setAiApplied(false);
    }
  };

  const analyzePhoto = async (file) => {
    setAiLoading(true);
    setAiError('');
    setAi(null);
    try {
      const fd = new FormData();
      fd.append('images', file);
      const res = await http.upload('/api/ai/analyze-image', fd);
      setAi({ analysis: res.analysis, analysisId: res.analysisId });
    } catch (err) {
      setAiError(err.message || 'AI analysis failed — you can still continue manually.');
    } finally {
      setAiLoading(false);
    }
  };

  const applyAi = () => {
    if (!ai) return;
    const a = ai.analysis;
    const match = categories.find((c) => c.slug === a.category);
    if (match) setCategoryId(match.id);
    if (a.severity) setSeverity(a.severity);
    if (!title.trim() && a.description) {
      setTitle(a.description.charAt(0).toUpperCase() + a.description.slice(1));
    }
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
    if (!picked) return setError('Please drop a pin on the map for the exact location');
    if (!title.trim()) return setError('Please give your report a short title');
    if (!files.length) return setError('Please attach at least one photo, video or voice note');

    setSubmitting(true);
    try {
      const uploadIds = await uploadFiles();
      const body = {
        categoryId,
        title: title.trim(),
        description: description.trim(),
        severity,
        lat: picked[0],
        lng: picked[1],
        address: address.trim(),
        area: area.trim(),
        city: city.trim(),
        landmark: landmark.trim(),
        isAnonymous: isAnonymous || !user,
        imageIds: uploadIds,
        aiAnalysisId: ai?.analysisId,
      };
      const res = await http.post('/api/issues', body);
      const issue = res.issue;
      navigate(`/issues/${issue.public_id ?? issue.id}`);
    } catch (err) {
      setError(err.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
      setUploading('');
    }
  };

  const imageCount = files.filter((f) => f.type === 'image').length;
  const mediaCount = files.filter((f) => f.type !== 'image').length;

  return (
    <div className="container-page max-w-4xl py-8">
      <h1 className="text-2xl font-bold text-ink-900">Report an issue</h1>
      {user ? (
        <p className="mt-1 text-sm text-ink-500">
          Signed in as <span className="font-medium text-ink-700">{user.name}</span>. A photo and a location pin help
          verification and faster action.
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-500">
          Reporting as a <span className="font-medium text-ink-700">guest</span> — your report will be anonymous.{' '}
          <Link to="/citizen/login" className="font-medium text-brand-600 hover:underline">Sign in</Link> to track your reports.
        </p>
      )}

      {/* Stepper */}
      <div className="mt-6 overflow-x-auto">
        <div className="flex w-max min-w-full items-center gap-2">
          {['Category & media', 'Details', 'Location & submit'].map((label, i) => {
            const n = i + 1;
            const done = step > n;
            const active = step === n;
            return (
              <div key={label} className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => n < step && setStep(n)}
                  aria-current={active ? 'step' : undefined}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition ${
                    active ? 'bg-brand-600 text-white ring-4 ring-brand-100' : done ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500'
                  } ${n < step ? 'hover:opacity-80' : 'cursor-default'}`}
                >
                  {done ? <CheckIcon size={16} /> : n}
                </button>
                <span className={`hidden text-xs font-medium sm:inline ${active ? 'text-ink-900' : done ? 'text-ink-700' : 'text-ink-400'}`}>{label}</span>
                {n < 3 && <span className={`mx-1 h-1 w-6 rounded-full ${step > n ? 'bg-brand-600' : 'bg-ink-200'}`} />}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* STEP 1 */}
      {step === 1 && (
        <div className="card mt-6 p-6">
          <label className="label">Category</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={`rounded-xl border-2 p-3 text-center text-sm transition ${
                  categoryId === c.id
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300'
                }`}
              >
                <span className="block text-lg" style={{ color: c.color || '#64748b' }}>◉</span>
                <span className="mt-1 block break-words text-[13px] font-medium leading-tight">{c.name}</span>
              </button>
            ))}
          </div>

          <label className="label mt-6">Photos · video · voice notes</label>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={onPhotos}
          />
          <input
            ref={mediaRef}
            type="file"
            accept="video/*,audio/*"
            multiple
            hidden
            onChange={onMedia}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-2xl border-2 border-dashed p-4 transition ${
              dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-300 bg-ink-50/50'
            }`}
          >
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {files.map((f) => (
                <div key={f.id} className="group relative aspect-square overflow-hidden rounded-xl bg-ink-100">
                  {f.type === 'image' ? (
                    <img src={f.url} alt="upload preview" className="h-full w-full object-cover" />
                  ) : f.type === 'video' ? (
                    <video src={f.url} muted className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-brand-50 text-brand-600">
                      <MicIcon size={26} />
                      <span className="mt-1 max-w-full truncate px-1 text-[10px] font-medium text-brand-800">
                        {f.file.name}
                      </span>
                    </div>
                  )}
                  {f.type !== 'image' && (
                    <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-ink-900/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {f.type === 'video' ? <FilmIcon size={11} /> : <MicIcon size={11} />}
                      {f.type === 'video' ? 'video' : 'voice'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    aria-label="Remove file"
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink-900/70 text-white transition hover:bg-red-600"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              ))}
              {imageCount < MAX_IMAGES && (
                <button
                  onClick={() => photoRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-300 bg-white text-ink-400 transition hover:border-brand-400 hover:text-brand-600"
                >
                  <CameraIcon size={22} />
                  <span className="text-xs font-medium">Photo</span>
                </button>
              )}
              {mediaCount < MAX_MEDIA && (
                <button
                  onClick={() => mediaRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-300 bg-white text-ink-400 transition hover:border-brand-400 hover:text-brand-600"
                >
                  <UploadIcon size={22} />
                  <span className="text-xs font-medium">Video/voice</span>
                </button>
              )}
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-400">
              <UploadIcon size={13} /> Drop files here or tap the tiles — max {MAX_IMAGES} photos, {MAX_MEDIA} video/voice clips
            </p>
            {processing && (
              <p className="mt-1 flex items-center justify-center gap-2 text-xs text-brand-600">
                <Spinner className="h-3.5 w-3.5" /> Processing photos…
              </p>
            )}
          </div>

          {files.length > 0 && (
            <button onClick={() => { setFiles([]); setAi(null); setAiError(''); setAiApplied(false); }} className="mt-2 text-xs font-semibold text-red-600 hover:underline">
              Clear all files
            </button>
          )}

          {(aiLoading || ai) && (
            <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
              {aiLoading ? (
                <div className="flex items-center gap-2 text-sm text-brand-700">
                  <Spinner /> AI is reviewing your photo…
                </div>
              ) : ai && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-brand-800">
                      <BotIcon size={16} /> AI photo analysis
                    </p>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                      {Math.round((ai.analysis.confidence || 0) * 100)}% confident
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-brand-900">
                    Looks like <span className="font-semibold">{ai.analysis.categoryLabel}</span>
                    {ai.analysis.severity && <> · severity <span className="font-semibold">{ai.analysis.severity}</span></>}
                    {ai.analysis.description ? ` — ${ai.analysis.description}` : ''}
                  </p>
                  {ai.analysis.relevant === false && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
                      <AlertIcon size={14} /> AI thinks this photo may not be a relevant civic issue. Please check your image.
                    </p>
                  )}
                  {ai.analysis.tamperSuspected && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
                      <AlertIcon size={14} /> AI suspects the photo may have been edited or re-used.
                    </p>
                  )}
                  {ai.analysis.safetyRisk === 'high' && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800">
                      <AlertIcon size={14} /> High safety risk — please report this quickly.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={applyAi} className="btn-primary text-sm">
                      {aiApplied ? 'Re-apply AI suggestion' : 'Use AI suggestion'}
                    </button>
                    <button onClick={() => setAi(null)} className="btn-ghost text-sm">Dismiss</button>
                  </div>
                </>
              )}
            </div>
          )}
          {aiError && !ai && !aiLoading && (
            <p className="mt-2 text-xs text-red-600">{aiError}</p>
          )}

          <div className="mt-8 flex justify-end">
            <button onClick={() => setStep(2)} disabled={!categoryId} className="btn-primary">
              Continue <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="card mt-6 p-6">
          <label className="label">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Large pothole near Hinjewadi Phase 1 chowk"
            className="input"
          />

          <label className="label mt-5">Describe the problem</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="How long has it been there? Is it getting worse? Who is affected?"
            className="input resize-none"
          />

          <div className="mt-5">
            <label className="label">Severity</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${
                    severity === s
                      ? 'border-brand-600 bg-brand-50 text-brand-800'
                      : 'border-ink-200 text-ink-700 hover:border-ink-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {user && (
            <div className="mt-5 flex items-center justify-between rounded-xl bg-ink-100 p-4">
              <div>
                <p className="text-sm font-semibold text-ink-800">Report anonymously</p>
                <p className="text-xs text-ink-500">Your name won't be shown on the public issue.</p>
              </div>
              <button
                onClick={() => setIsAnonymous((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition ${isAnonymous ? 'bg-brand-600' : 'bg-ink-300'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${isAnonymous ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
          )}

          <div className="mt-8 flex justify-between">
            <button onClick={() => setStep(1)} className="btn-outline"><ArrowLeftIcon size={16} /> Back</button>
            <button onClick={() => setStep(3)} className="btn-primary">Continue <ArrowRightIcon size={16} /></button>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="card mt-6 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-ink-900">Pin the exact location</h3>
              <p className="text-xs text-ink-500">Tap the map to drop a pin, or use your current location.</p>
            </div>
            <button onClick={locateMe} className="btn-outline"><MapPinIcon size={16} /> Use my location</button>
          </div>
          <MapView
            onPick={setPicked}
            pickActive
            picked={picked}
            className="h-[340px] rounded-2xl border border-ink-200"
          />
          {picked && (
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-ink-600">
              <MapPinIcon size={13} className="text-brand-600" /> Selected: {picked[0].toFixed(5)}, {picked[1].toFixed(5)}
            </p>
          )}

          {dupLoading && (
            <p className="mt-3 flex items-center gap-2 text-xs text-ink-500">
              <Spinner className="h-3.5 w-3.5 text-brand-600" /> Checking for similar reports nearby…
            </p>
          )}

          {!dupLoading && dups && dups.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertIcon size={15} /> Similar reports already exist nearby
              </p>
              <div className="mt-2 space-y-2">
                {dups.map((d) => (
                  <Link
                    key={d.issueId}
                    to={`/issues/${d.publicId}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm transition hover:bg-amber-100/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-800">#{d.publicId} · {d.title}</p>
                      <p className="text-xs text-ink-500">{d.category} · {d.distance} m away · {d.confirmations} confirmed</p>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-amber-700">{d.similarity.total}% similar</span>
                  </Link>
                ))}
              </div>
              <p className="mt-2 text-xs text-amber-700">
                You can open an existing report and confirm it instead — this helps keep the map uncluttered.
              </p>
            </div>
          )}

          {picked && (
            <div className="mt-4 rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Who leads this area</p>
                  {officialLoading ? (
                    <div className="mt-1 flex items-center gap-2 text-sm text-ink-500">
                      <Spinner /> Looking up the responsible official…
                    </div>
                  ) : official?.official?.officerName ? (
                    <div className="mt-1">
                      <p className="text-base font-bold text-ink-900">{official.official.officerName}</p>
                      <p className="text-sm font-medium text-brand-700">{official.official.officerRole}</p>
                      <p className="mt-0.5 text-xs text-ink-600">
                        {official.locality.name} · {official.official.authority}
                        {official.official.ward ? ` · ${official.official.ward}` : ''}
                      </p>
                      {official.official.officerParty && (
                        <p className="mt-1 inline-block rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-800">
                          {official.official.officerParty}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-ink-500">
                      No known representative mapped for this exact spot — the pin may sit just outside a mapped ward
                      boundary. Try dropping the pin inside a nearby locality, or contact your municipal office.
                    </p>
                  )}
                </div>
                {official?.ai && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                    <SparklesIcon size={12} /> AI identified
                  </span>
                )}
              </div>
            </div>
          )}

          <label className="label mt-5">Street / address (optional)</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Nearest address or description" className="input" />
          {locError && (
            <p className="mt-1 text-xs text-red-600">{locError}</p>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Area / locality</label>
              <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Baner" className="input" />
              {areaApprox && (
                <p className="mt-1 text-[11px] text-ink-400">Nearest locality — adjust if needed.</p>
              )}
            </div>
            <div>
              <label className="label">Landmark (optional)</label>
              <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="e.g. near the bus stop" className="input" />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
            <button onClick={() => setStep(2)} className="btn-outline"><ArrowLeftIcon size={16} /> Back</button>
            <button onClick={submit} disabled={submitting || uploading || processing} className="btn-primary min-w-[220px]">
              {submitting || uploading ? (
                <>
                  <Spinner /> {uploading === 'media' ? 'Transcoding video/voice…' : uploading === 'images' ? 'Uploading photos…' : 'Submitting…'}
                </>
              ) : (
                <><SendIcon size={16} /> Submit report</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
