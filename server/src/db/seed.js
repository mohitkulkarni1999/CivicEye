import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { pool, query, withTransaction } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { UPLOAD_DIR } from '../services/storage/index.js';
import { computeDHash, toGray8 } from '../middleware/upload.js';
import { computePriorityScore } from '../services/priority.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEPARTMENTS = [
  { name: 'Roads', slug: 'roads', color: '#334155', description: 'Roads, footpaths and bridges' },
  { name: 'Waste Management', slug: 'waste-management', color: '#65a30d', description: 'Garbage collection and dumping' },
  { name: 'Street Lighting', slug: 'street-lighting', color: '#eab308', description: 'Streetlights and public lighting' },
  { name: 'Water', slug: 'water', color: '#0284c7', description: 'Water supply and leakage' },
  { name: 'Drainage', slug: 'drainage', color: '#0891b2', description: 'Drains, sewers and waterlogging' },
  { name: 'Parks', slug: 'parks', color: '#16a34a', description: 'Parks, trees and public spaces' },
  { name: 'Traffic', slug: 'traffic', color: '#dc2626', description: 'Traffic signals and road safety' },
];

const CATEGORIES = [
  { name: 'Pothole', slug: 'pothole', dept: 'roads', icon: 'circle-dot', color: '#334155' },
  { name: 'Damaged Road', slug: 'damaged-road', dept: 'roads', icon: 'route', color: '#475569' },
  { name: 'Garbage Dumping', slug: 'garbage-dumping', dept: 'waste-management', icon: 'trash', color: '#65a30d' },
  { name: 'Overflowing Garbage Bin', slug: 'overflowing-garbage-bin', dept: 'waste-management', icon: 'recycle', color: '#84cc16' },
  { name: 'Broken Streetlight', slug: 'broken-streetlight', dept: 'street-lighting', icon: 'lamp', color: '#eab308' },
  { name: 'Open Drain', slug: 'open-drain', dept: 'drainage', icon: 'align-center', color: '#0891b2' },
  { name: 'Drainage Problem', slug: 'drainage-problem', dept: 'drainage', icon: 'waves', color: '#06b6d4' },
  { name: 'Water Leakage', slug: 'water-leakage', dept: 'water', icon: 'droplet', color: '#0284c7' },
  { name: 'Broken Footpath', slug: 'broken-footpath', dept: 'roads', icon: 'person-standing', color: '#78716c' },
  { name: 'Damaged Traffic Signal', slug: 'damaged-traffic-signal', dept: 'traffic', icon: 'traffic-cone', color: '#dc2626' },
  { name: 'Fallen Tree', slug: 'fallen-tree', dept: 'parks', icon: 'tree', color: '#16a34a' },
  { name: 'Illegal Dumping', slug: 'illegal-dumping', dept: 'waste-management', icon: 'ban', color: '#ca8a04' },
  { name: 'Waterlogging/Flooding', slug: 'waterlogging-flooding', dept: 'drainage', icon: 'cloud-rain', color: '#38bdf8' },
  { name: 'Public Toilet Problem', slug: 'public-toilet-problem', dept: 'parks', icon: 'toilet', color: '#64748b' },
  { name: 'Other', slug: 'other', dept: 'roads', icon: 'help-circle', color: '#6b7280' },
];

const AREAS = [
  { name: 'Hinjewadi Phase 1', area: 'Hinjewadi Phase 1', city: 'Pune', lat: 18.5915, lng: 73.739 },
  { name: 'Hinjewadi Phase 2', area: 'Hinjewadi Phase 2', city: 'Pune', lat: 18.5815, lng: 73.729 },
  { name: 'Hinjewadi Phase 3', area: 'Hinjewadi Phase 3', city: 'Pune', lat: 18.5735, lng: 73.739 },
  { name: 'Baner', area: 'Baner', city: 'Pune', lat: 18.5588, lng: 73.7837 },
  { name: 'Aundh', area: 'Aundh', city: 'Pune', lat: 18.5582, lng: 73.807 },
  { name: 'Wakad', area: 'Wakad', city: 'Pune', lat: 18.5971, lng: 73.7767 },
  { name: 'Pashan', area: 'Pashan', city: 'Pune', lat: 18.5397, lng: 73.7958 },
  { name: 'Balewadi', area: 'Balewadi', city: 'Pune', lat: 18.5742, lng: 73.7647 },
  { name: 'Bavdhan', area: 'Bavdhan', city: 'Pune', lat: 18.5167, lng: 73.7783 },
  { name: 'Kharadi', area: 'Kharadi', city: 'Pune', lat: 18.5536, lng: 73.9407 },
  { name: 'Viman Nagar', area: 'Viman Nagar', city: 'Pune', lat: 18.5679, lng: 73.9143 },
  { name: 'Kothrud', area: 'Kothrud', city: 'Pune', lat: 18.5074, lng: 73.8077 },
  { name: 'Shivajinagar', area: 'Shivajinagar', city: 'Pune', lat: 18.5308, lng: 73.8474 },
  { name: 'Hadapsar', area: 'Hadapsar', city: 'Pune', lat: 18.5041, lng: 73.9259 },
  { name: 'Koregaon Park', area: 'Koregaon Park', city: 'Pune', lat: 18.5363, lng: 73.8931 },
  { name: 'Karve Nagar', area: 'Karve Nagar', city: 'Pune', lat: 18.4917, lng: 73.8191 },
];

// Administrative units with the responsible local official.
// type: metro_ward (Pune Municipal Corporation) | municipal_ward (PCMC) |
//       town (Nagar Panchayat) | village (Gram Panchayat)
const LOCATIONS = [
  // Villages (Mulshi / Maval taluka — Gram Panchayat, Sarpanch)
  { name: 'Hinjewadi Phase 1', area: 'Hinjewadi Phase 1', city: 'Pune', lat: 18.5915, lng: 73.739, radius_m: 900, type: 'village', ward_no: 'GP Hinjewadi', officer: 'Dattatray Shinde', role: 'Sarpanch', party: 'NCP (Ajit Pawar)', phone: '98500 11201' },
  { name: 'Hinjewadi Phase 2', area: 'Hinjewadi Phase 2', city: 'Pune', lat: 18.5815, lng: 73.729, radius_m: 900, type: 'village', ward_no: 'GP Hinjewadi', officer: 'Dattatray Shinde', role: 'Sarpanch', party: 'NCP (Ajit Pawar)', phone: '98500 11201' },
  { name: 'Hinjewadi Phase 3', area: 'Hinjewadi Phase 3', city: 'Pune', lat: 18.5735, lng: 73.739, radius_m: 900, type: 'village', ward_no: 'GP Hinjewadi', officer: 'Dattatray Shinde', role: 'Sarpanch', party: 'NCP (Ajit Pawar)', phone: '98500 11201' },
  // Municipal wards (Pimpri-Chinchwad Municipal Corporation)
  { name: 'Wakad', area: 'Wakad', city: 'Pimpri-Chinchwad', lat: 18.5971, lng: 73.7767, radius_m: 1400, type: 'municipal_ward', ward_no: 'Ward 21', officer: 'Mahesh Chitnis', role: 'Nagar Sevak (Corporator)', party: 'Shiv Sena (Uddhav)', phone: '98500 11202' },
  { name: 'Balewadi', area: 'Balewadi', city: 'Pimpri-Chinchwad', lat: 18.5742, lng: 73.7647, radius_m: 1400, type: 'municipal_ward', ward_no: 'Ward 22', officer: 'Kavita Joshi', role: 'Nagar Sevak (Corporator)', party: 'BJP', phone: '98500 11203' },
  // Metro city wards (Pune Municipal Corporation)
  { name: 'Baner', area: 'Baner', city: 'Pune', lat: 18.5588, lng: 73.7837, radius_m: 1600, type: 'metro_ward', ward_no: 'Ward 9', officer: 'Ramesh Kulkarni', role: 'Nagar Sevak (Corporator)', party: 'BJP', phone: '98500 11204' },
  { name: 'Aundh', area: 'Aundh', city: 'Pune', lat: 18.5582, lng: 73.807, radius_m: 1600, type: 'metro_ward', ward_no: 'Ward 8', officer: 'Sunita Pawar', role: 'Nagar Sevak (Corporator)', party: 'Congress', phone: '98500 11205' },
  { name: 'Pashan', area: 'Pashan', city: 'Pune', lat: 18.5397, lng: 73.7958, radius_m: 1600, type: 'metro_ward', ward_no: 'Ward 6', officer: 'Vijay Deshpande', role: 'Nagar Sevak (Corporator)', party: 'BJP', phone: '98500 11206' },
  { name: 'Bavdhan', area: 'Bavdhan', city: 'Pune', lat: 18.5167, lng: 73.7783, radius_m: 1800, type: 'metro_ward', ward_no: 'Ward 11', officer: 'Anil Bhave', role: 'Nagar Sevak (Corporator)', party: 'Congress', phone: '98500 11207' },
  { name: 'Kothrud', area: 'Kothrud', city: 'Pune', lat: 18.5074, lng: 73.8077, radius_m: 2000, type: 'metro_ward', ward_no: 'Ward 8', officer: 'Sachin Godbole', role: 'Nagar Sevak (Corporator)', party: 'BJP', phone: '98500 11208' },
  { name: 'Karve Nagar', area: 'Karve Nagar', city: 'Pune', lat: 18.4917, lng: 73.8191, radius_m: 1600, type: 'metro_ward', ward_no: 'Ward 10', officer: 'Neeta Gupte', role: 'Nagar Sevak (Corporator)', party: 'NCP (Sharad)', phone: '98500 11209' },
  { name: 'Shivajinagar', area: 'Shivajinagar', city: 'Pune', lat: 18.5308, lng: 73.8474, radius_m: 1600, type: 'metro_ward', ward_no: 'Ward 5', officer: 'Arjun Sathe', role: 'Nagar Sevak (Corporator)', party: 'Congress', phone: '98500 11210' },
  { name: 'Koregaon Park', area: 'Koregaon Park', city: 'Pune', lat: 18.5363, lng: 73.8931, radius_m: 1600, type: 'metro_ward', ward_no: 'Ward 13', officer: 'Pooja Khandekar', role: 'Nagar Sevak (Corporator)', party: 'BJP', phone: '98500 11211' },
  { name: 'Viman Nagar', area: 'Viman Nagar', city: 'Pune', lat: 18.5679, lng: 73.9143, radius_m: 1600, type: 'metro_ward', ward_no: 'Ward 12', officer: 'Deepak Mulay', role: 'Nagar Sevak (Corporator)', party: 'BJP', phone: '98500 11212' },
  { name: 'Kharadi', area: 'Kharadi', city: 'Pune', lat: 18.5536, lng: 73.9407, radius_m: 2000, type: 'metro_ward', ward_no: 'Ward 12', officer: 'Deepak Mulay', role: 'Nagar Sevak (Corporator)', party: 'BJP', phone: '98500 11212' },
  { name: 'Hadapsar', area: 'Hadapsar', city: 'Pune', lat: 18.5041, lng: 73.9259, radius_m: 2000, type: 'metro_ward', ward_no: 'Ward 15', officer: 'Prakash Waghmare', role: 'Nagar Sevak (Corporator)', party: 'NCP (Ajit Pawar)', phone: '98500 11213' },
];

async function seedLocations() {
  for (const l of LOCATIONS) {
    await query(
      `INSERT INTO locations
        (name, slug, city, area, lat, lng, radius_m, type, ward_no, officer_name, officer_role, officer_party, officer_phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, city = EXCLUDED.city, area = EXCLUDED.area,
         lat = EXCLUDED.lat, lng = EXCLUDED.lng, radius_m = EXCLUDED.radius_m,
         type = EXCLUDED.type, ward_no = EXCLUDED.ward_no,
         officer_name = EXCLUDED.officer_name, officer_role = EXCLUDED.officer_role,
         officer_party = EXCLUDED.officer_party,
         officer_phone = EXCLUDED.officer_phone, is_active = true`,
      [
        l.name,
        l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        l.city,
        l.area,
        l.lat,
        l.lng,
        l.radius_m,
        l.type,
        l.ward_no,
        l.officer,
        l.role,
        l.party,
        l.phone,
      ],
    );
  }
  logger.info(`Seeded ${LOCATIONS.length} localities.`);
}

const DEV_PASSWORD = 'CivicEye@2026';

const DEV_ACCOUNTS = [
  { email: 'officer@civiceye.test', name: 'Officer Dev', role: 'officer', department_slug: 'roads' },
  { email: 'admin@civiceye.test', name: 'CivicEye Admin', role: 'admin', department_id: null },
];

export async function ensureDevAccounts() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
  for (const a of DEV_ACCOUNTS) {
    let departmentId = a.department_id;
    if (a.department_slug) {
      const { rows } = await query('SELECT id FROM departments WHERE slug = $1 LIMIT 1', [a.department_slug]);
      departmentId = rows[0]?.id || null;
    }
    await query(
      `INSERT INTO users (email, name, password_hash, role, department_id, is_demo, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, false, now())
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         department_id = EXCLUDED.department_id`,
      [a.email, a.name, passwordHash, a.role, departmentId],
    );
  }
  logger.info('Development test accounts ensured (civiceye.test).');
}

const TITLES = {
  pothole: [
    'Large pothole on the main road',
    'Deep pothole causing near-accidents',
    'Pothole cluster near the bus stop',
    'Widening pothole on the service lane',
    'Pothole filled with water after rains',
  ],
  'damaged-road': [
    'Damaged road surface with exposed gravel',
    'Road crumbling near the junction',
    'Sunken road surface blocks traffic',
    'Patchwork asphalt cracking badly',
  ],
  'garbage-dumping': [
    'Garbage dumped on the roadside',
    'Illegal garbage pile behind the shops',
    'Construction waste dumped on the footpath',
    'Garbage spread across the open plot',
  ],
  'overflowing-garbage-bin': [
    'Overflowing garbage bin near the market',
    'Garbage bin full and spilling over',
    'Bins overflowing for days',
  ],
  'broken-streetlight': [
    'Streetlight not working for weeks',
    'Broken streetlight pole leaning',
    'Streetlight flickering at night',
    'Dark stretch — streetlight damaged',
  ],
  'open-drain': [
    'Open drain uncovered near the school',
    'Drain cover missing — safety hazard',
    'Open drain overflowing onto the road',
  ],
  'drainage-problem': [
    'Drainage blocked with sewage backing up',
    'Clogged drain causing stink',
    'Storm drain blocked with debris',
  ],
  'water-leakage': [
    'Water leaking from the main pipe',
    'Continuous water leak flooding the road',
    'Burst pipe leaking for days',
  ],
  'broken-footpath': [
    'Broken footpath tiles dangerous to walk',
    'Footpath collapsed near the bus stop',
    'Cracked and uneven footpath',
  ],
  'damaged-traffic-signal': [
    'Traffic signal not working',
    'Damaged signal causing confusion',
    'Signal stuck on red for a long time',
  ],
  'fallen-tree': [
    'Tree fallen across the road',
    'Uprooted tree blocking the footpath',
    'Hanging branch about to fall',
  ],
  'illegal-dumping': [
    'Debris dumped illegally at night',
    'Household waste dumped in the open',
    'Large rubbish pile on the plot',
  ],
  'waterlogging-flooding': [
    'Waterlogged street after light rain',
    'Flooded stretch near the underpass',
    'Standing water blocking the entrance',
  ],
  'public-toilet-problem': [
    'Public toilet locked for months',
    'Public toilet unusable — no water',
    'Public toilet broken and unhygienic',
  ],
  other: [
    'General civic issue needs attention',
    'Public facility in poor condition',
  ],
};

const DESCRIPTIONS = {
  pothole: [
    'A deep pothole around 2 feet wide on the main carriageway. Vehicles swerve suddenly to avoid it, and two-wheelers are at particular risk after dark.',
    'This pothole has been growing for over a month. It fills with water during rain and is nearly invisible to riders.',
    'Multiple potholes clustered across a 50-metre stretch of road near the bus stop. The road surface is breaking apart.',
  ],
  'garbage-dumping': [
    'Garbage is being dumped on the roadside regularly. Stray animals scatter it and the smell is unbearable for residents.',
    'A large pile of mixed waste has accumulated over several days at this spot, blocking part of the footpath.',
  ],
  default: [
    'Residents have reported this repeatedly and would like the concerned department to take action. Photographs and location were submitted with the report.',
    'This issue affects daily commuters and residents in the area. Community confirmations are visible on the issue page.',
  ],
};

const STATUS_WEIGHTS = [
  ['RESOLVED', 0.30],
  ['VERIFIED_RESOLVED', 0.10],
  ['IN_PROGRESS', 0.20],
  ['ASSIGNED', 0.10],
  ['VERIFIED', 0.15],
  ['AI_REVIEW', 0.05],
  ['REPORTED', 0.05],
  ['REOPENED', 0.03],
  ['REJECTED', 0.02],
];

// Deterministic PRNG so demo data is stable across seeds
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const randInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;

function svgFor(category, color, variant) {
  const w = 800;
  const h = 600;
  const label = CATEGORIES.find((c) => c.slug === category)?.name || 'Civic Issue';
  let art = '';
  switch (category) {
    case 'pothole':
    case 'damaged-road':
      art = `
        <rect width="800" height="600" fill="#3f4348"/>
        <ellipse cx="${260 + variant * 90}" cy="${240 + variant * 40}" rx="130" ry="70" fill="#191b1e"/>
        <ellipse cx="${260 + variant * 90}" cy="${240 + variant * 40}" rx="110" ry="55" fill="#0c0d0f"/>
        <rect x="120" y="420" width="560" height="30" fill="#52565c"/>
        <path d="M80 520 h640 M80 560 h640" stroke="#6a6f76" stroke-width="8" stroke-dasharray="40 30"/>`;
      break;
    case 'garbage-dumping':
    case 'illegal-dumping':
    case 'overflowing-garbage-bin':
      art = `
        <rect width="800" height="600" fill="#d9d4c8"/>
        <rect x="140" y="330" width="520" height="200" fill="#8f8a7a" rx="12"/>
        <rect x="180" y="360" width="90" height="70" fill="#7f1d1d" rx="8"/>
        <rect x="290" y="350" width="110" height="80" fill="#166534" rx="8"/>
        <rect x="420" y="370" width="80" height="60" fill="#1e3a8a" rx="8"/>
        <rect x="520" y="360" width="100" height="70" fill="#a16207" rx="8"/>
        <path d="M100 430 q30 -40 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0" fill="#8f8a7a"/>`;
      break;
    case 'broken-streetlight':
      art = `
        <rect width="800" height="600" fill="#151821"/>
        <rect x="90" y="180" width="16" height="360" fill="#333945"/>
        <rect x="60" y="150" width="160" height="46" fill="#2a2f3a"/>
        <circle cx="90" cy="173" r="26" fill="#fde68a" opacity="0.9"/>
        <rect x="360" y="280" width="14" height="260" fill="#262b34"/>`;
      break;
    case 'open-drain':
    case 'drainage-problem':
      art = `
        <rect width="800" height="600" fill="#9aa3ab"/>
        <rect x="150" y="300" width="500" height="120" fill="#24282c"/>
        <rect x="150" y="300" width="500" height="24" fill="#4b5158"/>
        <path d="M150 330 h500 M150 360 h500 M150 390 h500" stroke="#3a3f45" stroke-width="6"/>
        <ellipse cx="400" cy="360" rx="140" ry="34" fill="#0b3d52" opacity="0.85"/>`;
      break;
    case 'water-leakage':
    case 'waterlogging-flooding':
      art = `
        <rect width="800" height="600" fill="#bcd7e6"/>
        <rect x="140" y="260" width="520" height="150" fill="#94c2e0"/>
        <path d="M140 260 q65 40 130 0 t130 0 t130 0 t130 0" fill="#7fb6da"/>
        <path d="M200 420 q40 -50 80 0 t80 0 t80 0" stroke="#5a9cc4" stroke-width="14" fill="none"/>
        <ellipse cx="420" cy="300" rx="160" ry="40" fill="#5aa0cd" opacity="0.8"/>`;
      break;
    case 'fallen-tree':
      art = `
        <rect width="800" height="600" fill="#cfe0cf"/>
        <rect x="0" y="430" width="800" height="170" fill="#6e7d5f"/>
        <rect x="120" y="320" width="220" height="34" fill="#7c5a34" rx="10" transform="rotate(-12 230 337)"/>
        <circle cx="210" cy="270" r="70" fill="#2f6f34"/>
        <circle cx="290" cy="250" r="58" fill="#3a8a40"/>
        <circle cx="150" cy="250" r="48" fill="#2f6f34"/>
        <rect x="60" y="430" width="20" height="170" fill="#5c4527"/>`;
      break;
    case 'broken-footpath':
      art = `
        <rect width="800" height="600" fill="#a8a29e"/>
        <rect x="60" y="180" width="680" height="220" fill="#c9c4bf"/>
        <rect x="80" y="190" width="100" height="60" fill="#d6d2cd"/>
        <rect x="200" y="190" width="100" height="60" fill="#b8b2ac"/>
        <rect x="320" y="190" width="60" height="60" fill="#8c857d"/>
        <rect x="520" y="300" width="120" height="70" fill="#918a82"/>
        <path d="M120 460 h500" stroke="#7d7b78" stroke-width="20"/>`;
      break;
    case 'damaged-traffic-signal':
      art = `
        <rect width="800" height="600" fill="#6b7c90"/>
        <rect x="360" y="180" width="26" height="300" fill="#2f3640"/>
        <rect x="320" y="80" width="106" height="200" fill="#111827" rx="12"/>
        <circle cx="373" cy="132" r="34" fill="#b91c1c"/>
        <circle cx="373" cy="182" r="34" fill="#713f12"/>
        <circle cx="373" cy="232" r="34" fill="#14532d"/>
        <path d="M120 330 h560 M140 400 h520" stroke="#fef3c7" stroke-width="14" stroke-dasharray="50 40"/>`;
      break;
    default:
      art = `
        <rect width="800" height="600" fill="#dfe3e8"/>
        <circle cx="400" cy="280" r="140" fill="#94a3b8"/>
        <circle cx="400" cy="280" r="80" fill="#64748b"/>
        <rect x="240" y="440" width="320" height="40" fill="#94a3b8" rx="8"/>`;
  }

  return `
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="600" fill="#f8fafc" opacity="0.04"/>
    ${art}
    <text x="30" y="40" font-family="Arial, sans-serif" font-size="28" fill="#ffffff" opacity="0.85">DEMO PHOTO — ${label}</text>
  </svg>`;
}

async function makeDemoImages() {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const generated = [];
  for (const cat of CATEGORIES) {
    for (let v = 0; v < 2; v++) {
      const svg = svgFor(cat.slug, cat.color, v);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
      const thumb = await sharp(Buffer.from(svg)).resize(300).jpeg({ quality: 70 }).toBuffer();
      const fname = `demo-${cat.slug}-${v}`;
      writeFileSync(join(UPLOAD_DIR, `${fname}.jpg`), buffer);
      writeFileSync(join(UPLOAD_DIR, `${fname}_thumb.jpg`), thumb);
      const gray = await sharp(buffer).grayscale().raw().toBuffer({ resolveWithObject: true });
      const hash = computeDHash(
        toGray8({ data: gray.data, width: gray.info.width, height: gray.info.height }),
        gray.info.width,
        gray.info.height,
      );
      generated.push({
        url: `/uploads/${fname}.jpg`,
        thumb_url: `/uploads/${fname}_thumb.jpg`,
        mime: 'image/jpeg',
        size_bytes: buffer.length,
        width: 800,
        height: 600,
        hash: hash.toString(16),
        slug: cat.slug,
      });
    }
  }
  return generated;
}

const COMMENT_POOL = [
  'This is getting worse every day. Please fix it soon.',
  'I drive past this every morning. It needs urgent attention.',
  'Confirmed — I saw this yesterday evening.',
  'The department was informed about this months ago.',
  'Same problem was fixed last year but it has returned.',
  'This stretch is really unsafe, especially after dark.',
  'Hoping the concerned team acts quickly this time.',
  'Kids walk past here to school. Very dangerous.',
  'Thank you for reporting this. Community support matters.',
  'This has been reported multiple times. It is time to act.',
];

const OFFICER_NOTES = [
  'Department has been assigned and a site visit is scheduled.',
  'A work order has been raised for this location.',
  'Crew dispatched; repair work is underway.',
  'Materials are on site and the repair is expected this week.',
  'Temporary safety measures have been placed around the hazard.',
  'Issue verified on site and added to the repair schedule.',
];

function makeTimeline(rng, status, reportedAt) {
  const events = [{ to: 'REPORTED', days: 0 }];
  const add = (to, minDays, maxDays) => {
    const last = events[events.length - 1];
    const d = last.days + randInt(rng, minDays, maxDays);
    events.push({ to, days: d });
    return d;
  };
  if (status !== 'REPORTED' && status !== 'REJECTED') add('AI_REVIEW', 0, 1);
  if (['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED_RESOLVED', 'REOPENED'].includes(status)) {
    add('VERIFIED', 1, 4);
  }
  if (['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED_RESOLVED', 'REOPENED'].includes(status)) {
    add('ASSIGNED', 2, 8);
  }
  if (['IN_PROGRESS', 'RESOLVED', 'VERIFIED_RESOLVED', 'REOPENED'].includes(status)) {
    add('IN_PROGRESS', 3, 12);
  }
  if (['RESOLVED', 'VERIFIED_RESOLVED', 'REOPENED'].includes(status)) {
    add('RESOLVED', 4, 25);
  }
  if (status === 'VERIFIED_RESOLVED') add('VERIFIED_RESOLVED', 2, 8);
  if (status === 'REOPENED') add('REOPENED', 1, 6);
  if (status === 'REJECTED') add('REJECTED', 1, 5);
  return events;
}

function pickStatus(rng) {
  const r = rng();
  let acc = 0;
  for (const [status, w] of STATUS_WEIGHTS) {
    acc += w;
    if (r <= acc) return status;
  }
  return 'VERIFIED';
}

export async function seedDatabase(options = {}) {
  const { force = false } = options;

  await seedLocations();

  if (!env.demoMode) {
    return { seeded: false, issues: 0, note: 'Demo seeding is disabled (DEMO_MODE=false)' };
  }

  const existing = await query('SELECT COUNT(*)::int AS n FROM issues');
  if (existing.rows[0].n >= 100 && !force) {
    if (env.demoMode) await ensureDevAccounts();
    return { seeded: false, issues: existing.rows[0].n, note: 'Demo data already present (use force to reseed)' };
  }

  logger.info('Seeding demo database...');

  const result = await withTransaction(async (client) => {
    // 1. Departments
    const deptRows = {};
    for (const d of DEPARTMENTS) {
      const { rows } = await client.query(
        `INSERT INTO departments (name, slug, color, description) VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color
         RETURNING id, slug`,
        [d.name, d.slug, d.color, d.description],
      );
      deptRows[d.slug] = rows[0].id;
    }

    // 2. Categories
    const catRows = {};
    for (const c of CATEGORIES) {
      const { rows } = await client.query(
        `INSERT INTO categories (name, slug, icon, color, department_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, department_id = EXCLUDED.department_id
         RETURNING id, slug`,
        [c.name, c.slug, c.icon, c.color, deptRows[c.dept]],
      );
      catRows[c.slug] = rows[0].id;
    }

    // 3. Demo users
    const passwordHash = await bcrypt.hash('demo1234', 10);
    const users = {};
    const demoUsers = [
      { email: 'citizen@civiceye.demo', name: 'Demo Citizen', role: 'citizen', dept: null },
      { email: 'officer@civiceye.demo', name: 'Amit Deshmukh', role: 'officer', dept: 'roads' },
      { email: 'moderator@civiceye.demo', name: 'Priya Iyer', role: 'moderator', dept: null },
      { email: 'admin@civiceye.demo', name: 'CivicEye Admin', role: 'admin', dept: null },
    ];
    for (const u of demoUsers) {
      const { rows } = await client.query(
        `INSERT INTO users (email, name, password_hash, role, department_id, is_demo, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, true, now())
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
           department_id = EXCLUDED.department_id
         RETURNING id, email`,
        [u.email, u.name, passwordHash, u.role, u.dept ? deptRows[u.dept] : null],
      );
      users[u.email] = rows[0].id;
    }

    return { deptRows, catRows, users };
  });

  const { catRows, deptRows, users } = result;

  if (env.demoMode) await ensureDevAccounts();

  // 4. Demo images (generated SVG photos, stored locally)
  const demoImages = await makeDemoImages();
  const imgBySlug = {};
  for (const img of demoImages) {
    const { rows } = await query(
      `INSERT INTO uploads (user_id, url, thumb_url, mime, size_bytes, width, height, perceptual_hash)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, $7) RETURNING id, url, thumb_url, perceptual_hash`,
      [img.url, img.thumb_url, img.mime, img.size_bytes, img.width, img.height, img.hash],
    );
    if (!imgBySlug[img.slug]) imgBySlug[img.slug] = [];
    imgBySlug[img.slug].push(rows[0]);
  }

  // 5. Issues
  const rng = mulberry32(20260115);
  const citizen = users['citizen@civiceye.demo'];
  const officer = users['officer@civiceye.demo'];
  const moderator = users['moderator@civiceye.demo'];

  const slugPool = Object.keys(catRows);
  const weights = { pothole: 5, 'damaged-road': 3, 'garbage-dumping': 3, 'broken-streetlight': 2, 'open-drain': 2, 'waterlogging-flooding': 2, 'water-leakage': 2, 'broken-footpath': 2, 'damaged-traffic-signal': 1, 'fallen-tree': 1, 'illegal-dumping': 2, 'overflowing-garbage-bin': 2, 'drainage-problem': 2, 'public-toilet-problem': 1, other: 1 };
  const weightedSlugs = Object.entries(weights).flatMap(([s, w]) => Array(w).fill(s));

  const totalIssues = 130;
  const issueIds = [];

  for (let idx = 0; idx < totalIssues; idx++) {
    const slug = pick(rng, weightedSlugs);
    const area = pick(rng, AREAS);
    const lat = area.lat + (rng() - 0.5) * 0.02;
    const lng = area.lng + (rng() - 0.5) * 0.02;

    const title = pick(rng, TITLES[slug] || TITLES.other);
    const descPool = DESCRIPTIONS[slug] || DESCRIPTIONS.default;
    const description = pick(rng, descPool);
    const address = `${area.area}, ${area.city} — near ${pick(rng, ['the main junction', 'the bus stop', 'the chowk', 'the market', 'the apartment gate'])}`;
    const status = pickStatus(rng);
    const severityRoll = rng();
    const severity = severityRoll > 0.94 ? 'CRITICAL' : severityRoll > 0.75 ? 'HIGH' : severityRoll > 0.35 ? 'MODERATE' : 'LOW';
    const ageDays = randInt(rng, 0, 90);
    const reportedAt = new Date(Date.now() - ageDays * 86400000);

    const reporter = rng() > 0.15 ? citizen : null;
    const isAnonymous = !reporter;

    const img = pick(rng, imgBySlug[slug] || imgBySlug.other);
    const confidence = slug === 'other' ? 0.4 : Math.round((0.55 + rng() * 0.4) * 100) / 100;

    const { rows } = await query(
      `INSERT INTO issues
        (reporter_id, is_anonymous, category_id, department_id, title, description, status, severity,
         lat, lng, address, area, city, landmark, confidence, is_demo, reported_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, $16, $16)
       RETURNING id, public_id`,
      [
        reporter,
        isAnonymous,
        catRows[slug],
        deptRows[CATEGORIES.find((c) => c.slug === slug).dept],
        title,
        description,
        status,
        severity,
        lat,
        lng,
        address,
        area.area,
        area.city,
        `${pick(rng, ['near chowk', 'opposite gate', 'by the bus stop', ''])}`,
        confidence,
        reportedAt,
      ],
    );
    const issue = rows[0];
    issueIds.push(issue.id);

    // Primary image
    await query(
      `INSERT INTO issue_images (issue_id, uploader_id, url, thumb_url, kind, is_primary, mime, width, height, size_bytes, perceptual_hash)
       VALUES ($1, $2, $3, $4, 'before', true, 'image/jpeg', $5, $6, $7, $8)`,
      [issue.id, reporter, img.url, img.thumb_url, 800, 600, 30000, img.perceptual_hash],
    );

    // Additional evidence images sometimes
    if (rng() > 0.6) {
      const extra = pick(rng, imgBySlug[slug] || imgBySlug.other);
      await query(
        `INSERT INTO issue_images (issue_id, uploader_id, url, thumb_url, kind, is_primary, mime, width, height, size_bytes, perceptual_hash)
         VALUES ($1, $2, $3, $4, 'evidence', false, 'image/jpeg', 800, 600, 30000, $5)`,
        [issue.id, reporter, extra.url, extra.thumb_url, extra.perceptual_hash],
      );
    }

    // Timeline history
    const timeline = makeTimeline(rng, status, reportedAt);
    const notes = { REPORTED: 'Reported by citizen', AI_REVIEW: 'AI analysis reviewed', VERIFIED: 'Verified with community confirmations', ASSIGNED: 'Assigned to department', IN_PROGRESS: 'Work in progress', RESOLVED: 'Repair completed', VERIFIED_RESOLVED: 'Confirmed fixed by citizens', REOPENED: 'Reopened — problem recurred', REJECTED: 'Rejected as duplicate or invalid' };
    for (let i = 0; i < timeline.length; i++) {
      const ev = timeline[i];
      const at = new Date(reportedAt.getTime() + ev.days * 86400000);
      if (at > new Date()) continue;
      const changedBy = ev.to === 'REOPENED' ? citizen : ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED'].includes(ev.to) ? officer : i === 0 ? reporter || null : moderator;
      await query(
        `INSERT INTO issue_status_history (issue_id, from_status, to_status, changed_by, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [issue.id, timeline[i - 1]?.to || null, ev.to, changedBy, notes[ev.to] || '', at],
      );
      if (ev.to === 'RESOLVED') {
        await query('UPDATE issues SET resolved_at = $1 WHERE id = $2', [at, issue.id]);
      }
      if (ev.to === 'REOPENED') {
        await query('UPDATE issues SET reopened_at = $1 WHERE id = $2', [at, issue.id]);
      }
    }

    // Confirmations
    const nConf = status === 'REOPENED' ? randInt(rng, 6, 24) : status === 'RESOLVED' || status === 'VERIFIED_RESOLVED' ? randInt(rng, 8, 31) : randInt(rng, 1, 30);
    for (let c = 0; c < nConf; c++) {
      await query(
        `INSERT INTO issue_confirmations (issue_id, user_id, is_demo, created_at)
         VALUES ($1, $2, true, $3)`,
        [issue.id, c === 0 ? citizen : null, new Date(reportedAt.getTime() + randInt(rng, 0, Math.max(1, ageDays)) * 86400000)],
      );
    }

    // Upvotes
    const nVotes = randInt(rng, 0, 40);
    for (let v = 0; v < nVotes; v++) {
      await query(
        `INSERT INTO issue_votes (issue_id, user_id, direction, created_at)
         VALUES ($1, $2, 'up', $3)`,
        [issue.id, v === 0 ? citizen : null, new Date(reportedAt.getTime() + randInt(rng, 0, Math.max(1, ageDays)) * 86400000)],
      );
    }

    // Comments
    const nComments = randInt(rng, 0, 5);
    for (let c = 0; c < nComments; c++) {
      const isOfficial = ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED_RESOLVED'].includes(status) && c === 0 && rng() > 0.5;
      await query(
        `INSERT INTO issue_comments (issue_id, user_id, is_official, body, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [issue.id, isOfficial ? officer : c === 0 ? citizen : null, isOfficial, isOfficial ? pick(rng, OFFICER_NOTES) : pick(rng, COMMENT_POOL), new Date(reportedAt.getTime() + randInt(rng, 1, Math.max(2, ageDays)) * 86400000)],
      );
    }

    // Followers (demo citizen follows most issues)
    if (rng() > 0.3) {
      await query(
        `INSERT INTO issue_followers (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [issue.id, citizen],
      );
    }

    // Official after-photo for resolved issues
    if (['RESOLVED', 'VERIFIED_RESOLVED'].includes(status)) {
      const afterImg = imgBySlug[slug] ? imgBySlug[slug][1] : imgBySlug.other[1];
      const beforeRes = await query('SELECT id, url FROM issue_images WHERE issue_id = $1 AND is_primary = true', [issue.id]);
      const before = beforeRes.rows[0];
      const aiRes = {
        repairLikelyCompleted: true,
        confidence: 0.85,
        remainingProblem: 'Minor surface wear may remain.',
        summary: 'The repaired surface looks smoother than the original damage.',
        provider: 'heuristic',
        mode: 'local',
      };
      const { rows: imgRow } = await query(
        `INSERT INTO issue_images (issue_id, uploader_id, url, thumb_url, kind, is_primary, mime, width, height, size_bytes, perceptual_hash)
         VALUES ($1, $2, $3, $4, 'after', false, 'image/jpeg', 800, 600, 30000, $5) RETURNING id`,
        [issue.id, officer, afterImg.url, afterImg.thumb_url, afterImg.perceptual_hash],
      );
      await query(
        `INSERT INTO issue_evidence (issue_id, evidence_type, image_id, submitted_by, note, ai_analysis, status)
         VALUES ($1, 'official', $2, $3, 'Repair work completed', $4, 'accepted')`,
        [issue.id, imgRow[0].id, officer, JSON.stringify(aiRes)],
      );
      await query(
        `INSERT INTO ai_analysis (issue_id, user_id, kind, input_image_ids, provider, model, result, confidence)
         VALUES ($1, $2, 'repair_verification', $3, 'heuristic', NULL, $4, $5)`,
        [issue.id, officer, JSON.stringify([before?.id || null, imgRow[0].id]), JSON.stringify(aiRes), 0.85],
      );
    }
  }

  // 6. Priority scores
  for (const id of issueIds) {
    await computePriorityScore(id);
  }

  const counts = await query('SELECT COUNT(*)::int AS n FROM issues');
  logger.info(`Seeded ${counts.rows[0].n} demo issues.`);
  return { seeded: true, issues: counts.rows[0].n };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDatabase({ force: process.argv.includes('--force') })
    .then((r) => {
      logger.info(JSON.stringify(r));
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Seed failed', err?.stack || err);
      process.exit(1);
    });
}
