import { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { StatusBadge, SeverityBadge } from './Badges.jsx';
import { MAP_CENTER, MAP_ZOOM, STATUS_COLORS } from '../lib/constants.js';
import { timeAgo } from '../lib/format.js';
import { EyeIcon, ArrowRightIcon } from './icons.jsx';

function statusColor(status) {
  const map = {
    RESOLVED: '#059669',
    VERIFIED_RESOLVED: '#059669',
    IN_PROGRESS: '#2563eb',
    ASSIGNED: '#7c3aed',
    REOPENED: '#dc2626',
    REJECTED: '#6b7280',
    VERIFIED: '#0284c7',
    AI_REVIEW: '#6366f1',
    REPORTED: '#64748b',
  };
  return map[status] || '#2c4ee3';
}

function IssueMarker({ issue, selected }) {
  const icon = L.divIcon({
    className: 'issue-marker',
    html: `<div class="marker-pin" style="
      width:${selected ? 22 : 16}px;height:${selected ? 22 : 16}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${statusColor(issue.status)};border:2px solid white;box-shadow:0 2px 6px rgba(15,23,42,.45);">
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 16],
    popupAnchor: [0, -16],
  });
  return (
    <Marker
      position={[issue.lat, issue.lng]}
      icon={icon}
      eventHandlers={{ click: () => {} }}
    >
      <Popup>
        <div className="w-56">
          <div className="mb-1 flex gap-1">
            <StatusBadge status={issue.status} />
            {issue.severity && <SeverityBadge severity={issue.severity} />}
          </div>
          <p className="text-sm font-semibold text-ink-900">{issue.title}</p>
          {issue.category_name && (
            <p className="text-xs text-ink-500">{issue.category_name} · {issue.area || '—'}</p>
          )}
          <p className="flex items-center gap-1 text-xs text-ink-400">
            <EyeIcon size={13} /> {issue.confirmations ?? 0} · {timeAgo(issue.reported_at)}
          </p>
          <Link
            to={`/issues/${issue.public_id ?? issue.id}`}
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          >
            View details <ArrowRightIcon size={13} />
          </Link>
        </div>
      </Popup>
    </Marker>
  );
}

function HeatCircles({ points }) {
  return points.map((p, i) => {
    const r = Math.min(30, 8 + Math.sqrt(p.count || 1) * 2.5 + (p.weight || 0) * 1.2);
    return (
      <CircleMarker
        key={i}
        center={[p.lat, p.lng]}
        radius={r}
        pathOptions={{ color: 'transparent', fillColor: '#ef4444', fillOpacity: 0.35 + Math.min(0.5, (p.count || 1) / 40), weight: 0 }}
      />
    );
  });
}

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [center, map]);
  return null;
}

function ClickToPin({ onPick, active }) {
  useMapEvents({
    click(e) {
      if (active && onPick) onPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

export default function MapView({
  issues = [],
  heatPoints = null,
  center = null,
  onPick,
  pickActive = false,
  picked,
  className = 'h-[70vh]',
}) {
  const shown = issues && issues.length ? issues : null;

  return (
    <MapContainer
      center={center || MAP_CENTER}
      zoom={MAP_ZOOM}
      scrollWheelZoom
      className={`z-0 w-full ${className}`}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {center && <Recenter center={center} />}
      {picked && <Recenter center={picked} />}
      <ClickToPin onPick={onPick} active={pickActive} />

      {picked && (
        <Marker position={picked} icon={L.divIcon({ className: 'pick-marker', html: `<div style="width:16px;height:16px;border-radius:50%;background:#dc2626;border:3px solid white;box-shadow:0 0 0 4px rgba(220,38,38,.25);"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] })}>
          <Popup><span className="text-sm font-medium">Selected location</span></Popup>
        </Marker>
      )}

      {heatPoints && <HeatCircles points={heatPoints} />}
      {shown && shown.map((issue) => <IssueMarker key={issue.id} issue={issue} />)}
    </MapContainer>
  );
}
