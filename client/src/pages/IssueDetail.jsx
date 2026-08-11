import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { http } from '../lib/api.js';
import { StatusBadge, SeverityBadge, CategoryBadge } from '../components/Badges.jsx';
import MapView from '../components/MapView.jsx';
import Spinner from '../components/Spinner.jsx';
import Skeleton from '../components/Skeleton.jsx';
import { formatDateTime, timeAgo, daysOpenLabel } from '../lib/format.js';
import { statusLabel } from '../lib/constants.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import {
  EyeIcon,
  ThumbsUpIcon,
  BellIcon,
  UndoIcon,
  SearchIcon,
  CameraIcon,
  BotIcon,
  MapPinIcon,
  MicIcon,
} from '../components/icons.jsx';

export default function IssueDetail() {
  const { id } = useParams();
  const { isAuthed } = useAuth();
  const navigate = useNavigate();

  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [photo, setPhoto] = useState(null);
  const [similar, setSimilar] = useState(null);
  const [coverId, setCoverId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const toast = useToast();

  const load = () => {
    setLoading(true);
    http
      .get(`/api/issues/${id}`)
      .then((d) => {
        setIssue(d.issue);
        http
          .get(`/api/issues/${id}/similar`)
          .then((s) => setSimilar(s.issues || []))
          .catch(() => setSimilar([]));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  if (loading) {
    return (
      <div className="container-page max-w-6xl py-8">
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Skeleton className="aspect-[16/9] w-full" />
            <div className="card mt-4 space-y-3 p-5">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            </div>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-[260px] w-full" />
            <div className="card space-y-3 p-5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (error)
    return (
      <div className="container-page py-16 text-center">
        <p className="text-lg font-semibold text-red-600">{error}</p>
        <Link to="/explore" className="btn-outline mt-4">Back to explore</Link>
      </div>
    );
  if (!issue) return null;

  const images = issue.images || [];
  const cover = images.find((im) => im.id === coverId) || images.find((im) => im.is_primary) || images[0];
  const statusHist = issue.statusHistory || [];
  const comments = issue.comments || [];

  const isVideo = (m) => m.kind === 'video' || (m.mime || '').startsWith('video/');
  const isAudio = (m) => m.kind === 'audio' || (m.mime || '').startsWith('audio/');

  const isPhoto = (m) => !isVideo(m) && !isAudio(m);
  const beforePhoto =
    images.find((im) => im.kind === 'before' && isPhoto(im)) ||
    images.find((im) => im.is_primary && isPhoto(im)) ||
    images.find(isPhoto);
  const afterPhotos = images.filter((im) => im.kind === 'after' && isPhoto(im));
  const afterPhoto = afterPhotos[afterPhotos.length - 1];
  const mediaLabel = (im) => {
    if (isAudio(im)) return 'audio';
    if (isVideo(im)) return 'video';
    if (im.kind === 'after') return 'after';
    if (im.kind === 'before' || im.is_primary) return 'before';
    if (im.kind) return im.kind;
    return 'evidence';
  };

  const renderMedia = (m) => {
    if (isVideo(m)) {
      return (
        <video
          controls
          poster={m.thumb_url || undefined}
          src={m.original_url || m.url}
          className="max-h-[420px] w-full bg-black"
        />
      );
    }
    if (isAudio(m)) {
      return (
        <div className="flex h-64 flex-col items-center justify-center gap-3 bg-ink-100 p-6">
          <MicIcon size={40} className="text-brand-600" />
          <audio controls src={m.original_url || m.url} className="w-full max-w-md" />
        </div>
      );
    }
    return <img src={m.url} alt={issue.title} className="max-h-[420px] w-full object-cover" />;
  };

  const act = async (kind) => {
    if (!isAuthed) return navigate('/citizen/login');
    setBusy(kind);
    try {
      if (kind === 'confirm') await http.post(`/api/issues/${id}/confirm`);
      else if (kind === 'upvote') await http.post(`/api/issues/${id}/upvote`);
      else if (kind === 'unupvote') await http.post(`/api/issues/${id}/unupvote`);
      else if (kind === 'follow') await http.post(`/api/issues/${id}/follow`);
      else if (kind === 'unfollow') await http.post(`/api/issues/${id}/unfollow`);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (!isAuthed) return navigate('/citizen/login');
    if (!comment.trim()) return;
    setBusy('comment');
    try {
      await http.post(`/api/issues/${id}/comments`, { body: comment.trim() });
      setComment('');
      toast.success('Comment posted');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const uploadEvidence = async (e) => {
    if (!isAuthed) return navigate('/citizen/login');
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('evidence');
    try {
      const fd = new FormData();
      fd.append('images', file);
      await http.upload(`/api/issues/${id}/evidence`, fd);
      setPhoto(null);
      toast.success('Evidence photo added');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const reopen = async () => {
    setBusy('reopen');
    try {
      await http.post(`/api/issues/${id}/reopen`, { note: 'Reopened from the web app' });
      setConfirmOpen(false);
      toast.success('Issue reopened');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const submitReportIncorrect = async (e) => {
    e.preventDefault();
    if (!reportReason.trim() || reportReason.trim().length < 3) return;
    setBusy('report');
    try {
      await http.post(`/api/issues/${id}/report-incorrect`, { reason: reportReason.trim() });
      setReportOpen(false);
      setReportReason('');
      toast.success('Reported. A moderator will review it.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const resolved = ['RESOLVED', 'VERIFIED_RESOLVED'].includes(issue.status);

  return (
    <div className="container-page max-w-6xl py-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-ink-500">
        <Link to="/explore" className="hover:text-brand-600">Explore</Link>
        <span>/</span>
        <span className="text-ink-900">#{issue.public_id}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* LEFT: images + actions */}
        <div className="lg:col-span-3">
          <div className="card overflow-hidden">
            {cover ? (
              renderMedia(cover)
            ) : (
              <div className="flex h-64 items-center justify-center bg-ink-100 text-ink-300">No photo</div>
            )}
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto p-3">
                {images.map((im) => (
                  <button key={im.id} type="button" onClick={() => setCoverId(im.id)} aria-label="Show this media">
                    {isAudio(im) ? (
                      <span
                        className={`flex h-20 w-28 shrink-0 flex-col items-center justify-center rounded-lg border-2 bg-brand-50 text-brand-600 transition ${
                          im.id === cover?.id ? 'border-brand-600' : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                      >
                        <MicIcon size={22} />
                        <span className="mt-1 text-[10px] capitalize text-ink-400">{mediaLabel(im)}</span>
                      </span>
                    ) : (
                      <span className="relative block shrink-0">
                        <img
                          src={im.thumb_url || im.url}
                          alt=""
                          className={`h-20 w-28 cursor-pointer rounded-lg object-cover border-2 transition ${
                            im.id === cover?.id ? 'border-brand-600' : 'border-transparent opacity-70 hover:opacity-100'
                          }`}
                        />
                        <span className="absolute bottom-1 right-1 rounded bg-ink-900/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                          {mediaLabel(im)}
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {beforePhoto && afterPhoto && (
            <div className="card mt-4 overflow-hidden">
              <div className="border-b border-ink-100 px-5 py-3">
                <h3 className="font-semibold text-ink-900">Before / After</h3>
                <p className="text-xs text-ink-500">Officer-uploaded resolution photos — visible to everyone</p>
              </div>
              <div className="grid grid-cols-2 gap-3 p-4">
                <figure>
                  <img
                    src={beforePhoto.thumb_url || beforePhoto.url}
                    alt="Before the fix"
                    className="h-40 w-full rounded-lg border border-ink-100 object-cover"
                  />
                  <figcaption className="mt-1 text-center text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Before
                  </figcaption>
                </figure>
                <figure>
                  <img
                    src={afterPhoto.thumb_url || afterPhoto.url}
                    alt="After the fix"
                    className="h-40 w-full rounded-lg border border-brand-300 object-cover"
                  />
                  <figcaption className="mt-1 text-center text-xs font-semibold uppercase tracking-wide text-brand-600">
                    After
                  </figcaption>
                </figure>
              </div>
            </div>
          )}

          {/* Meta bar */}
          <div className="card mt-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              {issue.category && <CategoryBadge name={issue.category.name} color={issue.category.color} />}
              <StatusBadge status={issue.status} />
              <SeverityBadge severity={issue.severity} />
              <span className="ml-auto text-xs text-ink-400">
                Report #{issue.public_id} · {issue.is_demo && 'demo'}
              </span>
            </div>
            <h1 className="mt-3 text-xl font-bold text-ink-900 md:text-2xl">{issue.title}</h1>
            {issue.department && (
              <p className="mt-1 text-sm text-ink-500">
                Department: <span className="font-medium text-ink-700">{issue.department.name}</span>
              </p>
            )}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{issue.description}</p>

            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-ink-100 p-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-ink-400">Reported</p>
                <p className="font-medium text-ink-800">{timeAgo(issue.reported_at)}</p>
              </div>
              <div>
                <p className="text-ink-400">Location</p>
                <p className="font-medium text-ink-800">{issue.area || issue.city || '—'}</p>
              </div>
              <div>
                <p className="text-ink-400">Confirmed by</p>
                <p className="font-medium text-ink-800">{issue.confirmations ?? 0} citizens</p>
              </div>
              <div>
                <p className="text-ink-400">Open for</p>
                <p className="font-medium text-ink-800">
                  {resolved ? `${Math.round(issue.daysOpen)} days` : daysOpenLabel(issue.daysOpen)}
                </p>
              </div>
            </div>
            {issue.address && (
              <p className="mt-3 flex items-start gap-1 text-sm text-ink-500">
                <MapPinIcon size={14} className="mt-0.5 shrink-0 text-ink-400" /> {issue.address}
              </p>
            )}

            {issue.officer_name && (
              <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  Who leads this area
                </p>
                <p className="mt-1 text-base font-bold text-ink-900">{issue.officer_name}</p>
                <p className="text-sm font-medium text-brand-700">{issue.officer_role}</p>
                <p className="mt-0.5 text-xs text-ink-600">
                  {[issue.ward_no, issue.area, issue.city].filter(Boolean).join(' · ') || '—'}
                </p>
                {issue.officer_party && (
                  <p className="mt-1 inline-block rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-800">
                    {issue.officer_party}
                  </p>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button onClick={() => act('confirm')} disabled={busy === 'confirm'} className={issue.confirmedByMe ? 'btn-primary' : 'btn-outline'}>
                <EyeIcon size={16} /> Confirm {issue.confirmedByMe && '(you)'}
              </button>
              <button onClick={() => act(issue.upvotedByMe ? 'unupvote' : 'upvote')} disabled={busy === 'upvote' || busy === 'unupvote'} className={issue.upvotedByMe ? 'btn-primary' : 'btn-outline'}>
                <ThumbsUpIcon size={16} /> {issue.votes?.up ?? 0}
              </button>
              <button onClick={() => act(issue.followingByMe ? 'unfollow' : 'follow')} disabled={busy === 'follow' || busy === 'unfollow'} className="btn-outline">
                <BellIcon size={16} /> {issue.followingByMe ? 'Following' : 'Follow'}
              </button>
              {resolved && (
                <button onClick={() => setConfirmOpen(true)} disabled={busy === 'reopen'} className="btn-outline text-red-600">
                  <UndoIcon size={16} /> Reopen
                </button>
              )}
              <button onClick={() => setReportOpen(true)} disabled={busy === 'report'} className="btn-ghost text-xs text-ink-400">
                Report incorrect
              </button>
            </div>

            {confirmOpen && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-ink-900">Reopen this issue?</p>
                <p className="mt-1 text-sm text-ink-600">You are confirming the problem is still present and should be investigated again.</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={reopen} disabled={busy === 'reopen'} className="btn-danger text-sm">Yes, reopen</button>
                  <button onClick={() => setConfirmOpen(false)} className="btn-outline text-sm">Cancel</button>
                </div>
              </div>
            )}

            {reportOpen && (
              <form onSubmit={submitReportIncorrect} className="mt-4 rounded-xl border border-ink-200 bg-ink-50 p-4">
                <p className="text-sm font-semibold text-ink-900">Report this issue as incorrect</p>
                <textarea
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  rows={2}
                  placeholder="Why is this report incorrect? (min 3 characters)"
                  className="input mt-2 resize-none"
                  autoFocus
                />
                <div className="mt-3 flex gap-2">
                  <button type="submit" disabled={busy === 'report'} className="btn-danger text-sm">Submit report</button>
                  <button type="button" onClick={() => setReportOpen(false)} className="btn-outline text-sm">Cancel</button>
                </div>
              </form>
            )}
          </div>

          {/* Comments */}
          <div className="card mt-4 p-5">
            <h3 className="mb-4 font-semibold text-ink-900">
              Discussion <span className="text-ink-400">({comments.length})</span>
            </h3>
            <form onSubmit={postComment} className="mb-5 flex gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment…"
                className="input"
              />
              <button disabled={busy === 'comment'} className="btn-primary shrink-0">Post</button>
            </form>
            <div className="space-y-4">
              {comments.map((c) => (
                <div key={c.id} className="rounded-xl border border-ink-100 p-3">
                  <div className="flex items-center gap-2 text-xs text-ink-400">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${c.is_official ? 'bg-brand-600' : 'bg-ink-300'}`}>
                      {(c.user_name || 'A').charAt(0).toUpperCase()}
                    </span>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-ink-700">{c.user_name || 'Anonymous'}</span>
                      {c.is_official && <span className="badge bg-brand-600 text-white">Official</span>}
                      <span>{c.user_role}</span>
                      <span>· {timeAgo(c.created_at)}</span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-ink-700">{c.body}</p>
                </div>
              ))}
              {!comments.length && <p className="text-sm text-ink-400">No comments yet — start the conversation.</p>}
            </div>
          </div>

          {/* Add evidence */}
          {!resolved && (
            <div className="card mt-4 p-5">
              <h3 className="flex items-center gap-2 font-semibold text-ink-900">
                <CameraIcon size={16} className="text-ink-400" /> Add evidence
              </h3>
              <p className="mt-1 text-xs text-ink-500">Upload a fresh photo showing the issue is still there.</p>
              <input type="file" accept="image/*" className="mt-3 input" onChange={uploadEvidence} />
              {busy === 'evidence' && (
                <p className="mt-2 flex items-center gap-2 text-sm text-ink-500">
                  <Spinner className="h-4 w-4 text-brand-600" /> Uploading…
                </p>
              )}
            </div>
          )}

          {/* Similar issues */}
          {similar && similar.length > 0 && (
            <div className="card mt-4 p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-900">
                <SearchIcon size={16} className="text-ink-400" /> Similar issues nearby
              </h3>
              <div className="space-y-2">
                {similar.map((s) => (
                  <Link
                    key={s.issueId}
                    to={`/issues/${s.publicId}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 p-3 text-sm hover:bg-ink-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-800">#{s.publicId} · {s.title}</p>
                      <p className="text-xs text-ink-400">{s.category} · {s.distance} m away · {s.confirmations} confirmed</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-brand-600">{s.similarity.total}% similar</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: map + timeline */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <MapView
              issues={[{ id: issue.id, lat: issue.lat, lng: issue.lng, status: issue.status, severity: issue.severity, title: issue.title, category_name: issue.category?.name, area: issue.area, confirmations: issue.confirmations, reported_at: issue.reported_at, public_id: issue.public_id }]}
              center={[issue.lat, issue.lng]}
              className="h-[260px]"
            />
          </div>

          <div className="card mt-4 p-5">
            <h3 className="mb-4 font-semibold text-ink-900">Timeline</h3>
            <ol className="relative space-y-5 border-l-2 border-ink-100 pl-5">
              {statusHist.map((h, i) => (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${
                      i === statusHist.length - 1 ? 'bg-brand-600' : 'bg-ink-300'
                    }`}
                  />
                  <p className="text-sm font-semibold text-ink-800">{statusLabel(h.to_status)}</p>
                  <p className="text-xs text-ink-500">{h.note || 'Status updated'}</p>
                  <p className="mt-0.5 text-xs text-ink-400">{formatDateTime(h.created_at)}</p>
                </li>
              ))}
            </ol>
          </div>

          {issue.aiAnalyses?.length > 0 && (
            <div className="card mt-4 p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-900">
                <BotIcon size={16} className="text-brand-600" /> AI analysis
              </h3>
              {issue.aiAnalyses.map((a) => {
                let result = null;
                try {
                  const parsed = typeof a.result === 'string' ? JSON.parse(a.result) : a.result;
                  if (parsed && typeof parsed === 'object') result = parsed;
                } catch {}
                return (
                  <div key={a.id} className="mb-3 rounded-xl bg-ink-100 p-3 text-sm">
                    <p className="font-medium text-ink-800">
                      {a.kind.replace(/_/g, ' ')} · {a.provider}
                    </p>
                    {result?.summary && <p className="mt-1 text-ink-600">{result.summary}</p>}
                    {result?.confidence != null && (
                      <p className="mt-1 text-xs text-ink-500">Confidence: {Math.round(result.confidence * 100)}%</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {issue.evidence?.length > 0 && (
            <div className="card mt-4 p-5">
              <h3 className="mb-3 font-semibold text-ink-900">Evidence</h3>
              {issue.evidence.map((ev) => (
                <div key={ev.id} className="mb-3 flex items-start gap-3">
                  {ev.thumb_url && <img src={ev.thumb_url} alt="" className="h-16 w-20 rounded-lg object-cover" />}
                  <div className="text-sm">
                    <p className="font-medium capitalize text-ink-800">{ev.evidence_type}</p>
                    <p className="text-xs text-ink-500">{ev.note || '—'} · {timeAgo(ev.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
