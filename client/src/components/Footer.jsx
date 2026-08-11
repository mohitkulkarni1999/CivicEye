import { Link } from 'react-router-dom';
import { BrandMark } from './Navbar.jsx';
import { MapPinIcon } from './icons.jsx';

const LINKS = [
  {
    heading: 'Explore',
    links: [
      { to: '/map', label: '🗺️ Live map' },
      { to: '/explore', label: '📋 All issues' },
      { to: '/dashboard', label: '📊 City dashboard' },
      { to: '/report', label: '📸 Report an issue' },
    ],
  },
  {
    heading: 'For Citizens',
    links: [
      { to: '/my-reports', label: '📁 My reports' },
      { to: '/notifications', label: '🔔 Notifications' },
      { to: '/citizen/register', label: '✅ Create account' },
      { to: '/citizen/login', label: '🔑 Sign in' },
    ],
  },
  {
    heading: 'City Operations',
    links: [
      { to: '/officer/login', label: '🏛️ Officer console' },
      { to: '/admin/login', label: '⚙️ Admin console' },
    ],
  },
];

export default function Footer() {
  return (
    <footer style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0f2040 100%)' }}>
      {/* Top section */}
      <div className="container-page grid gap-10 py-14 md:grid-cols-4 lg:gap-16">
        {/* Brand col */}
        <div className="md:col-span-1">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9 drop-shadow" />
            <span className="text-xl font-black text-white tracking-tight">CivicEye</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-blue-200/80">
            AI-powered civic issue reporting and community resolution for smarter cities.
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs text-blue-200 backdrop-blur w-fit">
            <MapPinIcon size={13} className="text-emerald-400" />
            <span className="font-medium">Live in Pune, India</span>
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]" />
          </div>
        </div>

        {/* Nav link columns */}
        {LINKS.map((col) => (
          <div key={col.heading}>
            <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-blue-300">{col.heading}</h4>
            <ul className="space-y-2.5">
              {col.links.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className="text-sm text-blue-100/70 transition hover:text-white hover:translate-x-0.5 inline-flex"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Divider + bottom bar */}
      <div className="border-t border-white/10">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-5 text-xs text-blue-300/60">
          <p>© {new Date().getFullYear()} CivicEye · Built for Pune — demo data for presentation purposes.</p>
          <div className="flex items-center gap-4">
            <span>Built with ❤️ for citizens</span>
            <span className="flex items-center gap-1.5">
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_1px_rgba(52,211,153,0.6)]" />
              All systems operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
