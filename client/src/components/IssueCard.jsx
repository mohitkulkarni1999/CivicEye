import { Link } from 'react-router-dom';
import { StatusBadge, SeverityBadge, CategoryBadge } from './Badges.jsx';
import { timeAgo, daysOpenLabel } from '../lib/format.js';
import { EyeIcon, ThumbsUpIcon, CommentIcon, FlameIcon, MapPinIcon, ClockIcon } from './icons.jsx';

export default function IssueCard({ issue }) {
  const {
    id,
    public_id,
    title,
    status,
    severity,
    category_name,
    category_color,
    category_slug,
    area,
    confirmations,
    upvotes,
    comments,
    cover_url,
    cover_thumb,
    created_at,
    reported_at,
    priority_score,
  } = issue;

  const beforeImg = cover_thumb || cover_url;
  const afterImg = issue.after_thumb || issue.after_url;
  const isResolved = ['RESOLVED', 'VERIFIED_RESOLVED'].includes(status);

  return (
    <Link
      to={`/issues/${public_id ?? id}`}
      className="card group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-ink-100">
        {isResolved && (beforeImg || afterImg) ? (
          <div className="grid h-full w-full grid-cols-2 gap-0.5 bg-ink-900">
            <div className="relative h-full w-full overflow-hidden">
              {beforeImg ? (
                <img
                  src={beforeImg}
                  alt={`${title} - Before`}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-ink-200 text-xs text-ink-500">No Before</div>
              )}
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                BEFORE
              </span>
            </div>

            <div className="relative h-full w-full overflow-hidden">
              {afterImg ? (
                <img
                  src={afterImg}
                  alt={`${title} - After`}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center bg-emerald-950/80 p-2 text-center text-emerald-300">
                  <span className="text-base">✓</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider">FIXED</span>
                </div>
              )}
              <span className="absolute bottom-1.5 right-1.5 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                AFTER (FIXED)
              </span>
            </div>
          </div>
        ) : beforeImg ? (
          <img
            src={beforeImg}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-ink-100 to-ink-200/60 text-ink-300">
            <MapPinIcon size={48} className="opacity-50" />
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <StatusBadge status={status} />
          {severity && <SeverityBadge severity={severity} />}
        </div>
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ backgroundColor: category_color || '#cbd5e1' }} />
      </div>
      <div className="p-4">
        <div className="mb-1 flex items-center gap-2">
          {category_name && <CategoryBadge name={category_name} color={category_color} />}
          <span className="text-xs text-ink-400">#{public_id}</span>
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink-900 group-hover:text-brand-700">
          {title}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
          {area && (
            <span className="inline-flex items-center gap-1">
              <MapPinIcon size={13} className="text-ink-400" /> {area}
            </span>
          )}
          <span>{timeAgo(reported_at || created_at)}</span>
          {priority_score != null && (
            <span className="inline-flex items-center gap-1">
              <FlameIcon size={13} className="text-orange-500" /> {Math.round(priority_score)}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1">
            <EyeIcon size={14} className="text-ink-400" /> {confirmations ?? 0} confirmed
          </span>
          <span className="inline-flex items-center gap-1">
            <ThumbsUpIcon size={14} className="text-ink-400" /> {upvotes ?? 0}
          </span>
          {comments != null && (
            <span className="inline-flex items-center gap-1">
              <CommentIcon size={14} className="text-ink-400" /> {comments}
            </span>
          )}
          {status && !['RESOLVED', 'VERIFIED_RESOLVED'].includes(status) && reported_at && (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-ink-700">
              <ClockIcon size={13} className="text-ink-400" />
              {daysOpenLabel((Date.now() - new Date(reported_at).getTime()) / 86400000)} open
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
