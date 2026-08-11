import { statusLabel, statusLabel as sl, STATUS_COLORS, SEVERITY_COLORS } from '../lib/constants.js';

export function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.REPORTED;
  return <span className={`badge ${c.bg} ${c.text}`}>{sl(status)}</span>;
}

export function SeverityBadge({ severity }) {
  const c = SEVERITY_COLORS[severity] || SEVERITY_COLORS.MODERATE;
  return (
    <span className={`badge ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {severity}
    </span>
  );
}

export function CategoryBadge({ name, color }) {
  return (
    <span
      className="badge text-white"
      style={{ backgroundColor: color || '#64748b' }}
    >
      {name || statusLabel(name)}
    </span>
  );
}
