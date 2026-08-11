export const STATUSES = [
  'REPORTED',
  'AI_REVIEW',
  'VERIFIED',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'VERIFIED_RESOLVED',
  'REOPENED',
  'REJECTED',
];

export const STATUS_FLOW = {
  REPORTED: ['AI_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REJECTED'],
  AI_REVIEW: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REJECTED'],
  VERIFIED: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  ASSIGNED: ['IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  IN_PROGRESS: ['RESOLVED', 'REOPENED', 'REJECTED'],
  RESOLVED: ['VERIFIED_RESOLVED', 'REOPENED', 'IN_PROGRESS'],
  VERIFIED_RESOLVED: ['REOPENED'],
  REOPENED: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'],
  REJECTED: ['REOPENED'],
};

export const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

export const ROLES = {
  CITIZEN: 'citizen',
  MODERATOR: 'moderator',
  OFFICER: 'officer',
  ADMIN: 'admin',
};

export const statusLabel = (s) =>
  (s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const SEVERITY_COLORS = {
  LOW: { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' },
  MODERATE: { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' },
  HIGH: { bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
  CRITICAL: { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-600' },
};

export const STATUS_COLORS = {
  REPORTED: { bg: 'bg-slate-100', text: 'text-slate-700' },
  AI_REVIEW: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  VERIFIED: { bg: 'bg-sky-100', text: 'text-sky-700' },
  ASSIGNED: { bg: 'bg-violet-100', text: 'text-violet-700' },
  IN_PROGRESS: { bg: 'bg-blue-100', text: 'text-blue-700' },
  RESOLVED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  VERIFIED_RESOLVED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  REOPENED: { bg: 'bg-red-100', text: 'text-red-700' },
  REJECTED: { bg: 'bg-gray-200', text: 'text-gray-600' },
};

export const PUNE_BOUNDS = {
  minLat: 18.4,
  maxLat: 18.7,
  minLng: 73.6,
  maxLng: 74.0,
};

export const MAP_CENTER = [18.56, 73.79];
export const MAP_ZOOM = 12;

export const CATEGORY_ICONS = {
  'circle-dot': '⬤',
  route: '⛭',
  trash: '♻',
  recycle: '♺',
  lamp: '◐',
  'align-center': '≡',
  waves: '≈',
  droplet: '◍',
  'person-standing': '◉',
  'traffic-cone': '▲',
  tree: '♣',
  ban: '⊘',
  'cloud-rain': '☂',
  toilet: '▣',
  'help-circle': '?',
};
