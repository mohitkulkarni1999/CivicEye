import { Link } from 'react-router-dom';
import { BrandMark } from './Navbar.jsx';

export default function Footer() {
  return (
    <footer className="border-t border-ink-800 bg-ink-900 text-ink-300">
      <div className="container-page grid gap-8 py-12 md:grid-cols-4">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-bold text-white">CivicEye</span>
          </div>
          <p className="mt-3 text-sm text-ink-400">
            AI-powered civic issue reporting and accountability for smarter cities.
          </p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold text-white">Explore</h4>
          <ul className="space-y-2 text-sm">
            <li><Link to="/map" className="hover:text-white">Live map</Link></li>
            <li><Link to="/explore" className="hover:text-white">All issues</Link></li>
            <li><Link to="/dashboard" className="hover:text-white">City dashboard</Link></li>
            <li><Link to="/report" className="hover:text-white">Report an issue</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold text-white">For citizens</h4>
          <ul className="space-y-2 text-sm">
            <li><Link to="/my-reports" className="hover:text-white">My reports</Link></li>
            <li><Link to="/notifications" className="hover:text-white">Notifications</Link></li>
            <li><Link to="/citizen/register" className="hover:text-white">Create account</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold text-white">City operations</h4>
          <ul className="space-y-2 text-sm">
            <li><Link to="/officer/login" className="hover:text-white">Officer console</Link></li>
            <li><Link to="/admin/login" className="hover:text-white">Admin console</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-800 py-5">
        <p className="container-page text-center text-xs text-ink-500">
          © {new Date().getFullYear()} CivicEye · Built for Pune — demo data provided by the CivicEye team.
        </p>
      </div>
    </footer>
  );
}
