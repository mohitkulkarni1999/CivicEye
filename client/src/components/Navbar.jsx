import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { PlusIcon } from './icons.jsx';

const links = [
  { to: '/', label: 'Home' },
  { to: '/explore', label: 'Explore' },
  { to: '/map', label: 'Map' },
  { to: '/dashboard', label: 'City Dashboard' },
];

export function BrandMark({ className = 'h-9 w-9' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#2c4ee3" />
      <circle cx="16" cy="16" r="7" fill="#ffffff" />
      <circle cx="16" cy="16" r="3.5" fill="#2c4ee3" />
    </svg>
  );
}

export default function Navbar() {
  const { user, isAuthed, logout, isOfficer, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    setOpen(false);
  }, [location.pathname]);

  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '';
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : '?';

  const onLogout = () => {
    const p = location.pathname;
    logout();
    setMenuOpen(false);
    if (p.startsWith('/officer')) navigate('/officer/login');
    else if (p.startsWith('/admin')) navigate('/admin/login');
    else if (p.startsWith('/citizen')) navigate('/citizen/login');
    else navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/90 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <BrandMark />
          <span className="text-lg font-bold tracking-tight text-ink-900">
            Civic<span className="text-brand-600">Eye</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link to="/report" className="btn-primary">
            <PlusIcon size={16} /> Report Issue
          </Link>
          {!isAuthed ? (
            <>
              <Link to="/citizen/login" className="btn-outline">
                Log in
              </Link>
            </>
          ) : (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-ink-200 bg-white py-1 pl-1 pr-3 hover:bg-ink-100"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {initial}
                </span>
                <span className="text-sm font-medium text-ink-700">
                  {user.name.split(' ')[0]}
                  <span className="ml-1 text-xs text-ink-400">{roleLabel}</span>
                </span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl border border-ink-200 bg-white py-1 shadow-lift">
                  <div className="border-b border-ink-100 px-4 py-2">
                    <p className="truncate text-sm font-medium text-ink-900">{user.name}</p>
                    <p className="truncate text-xs text-ink-500">{user.email}</p>
                  </div>
                  <Link to="/my-reports" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    My reports
                  </Link>
                  <Link to="/notifications" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    Notifications
                  </Link>
                  {isOfficer && (
                    <Link to="/officer/dashboard" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
                      Officer console
                    </Link>
                  )}
                  {isAdmin && (
                    <Link to="/admin/dashboard" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
                      Admin console
                    </Link>
                  )}
                  <button
                    onClick={onLogout}
                    className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-ink-200 bg-white px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
            <Link to="/report" className="btn-primary mt-2">
              <PlusIcon size={16} /> Report Issue
            </Link>
            {!isAuthed ? (
              <Link to="/citizen/login" className="btn-outline mt-2">
                Log in / Sign up
              </Link>
            ) : (
              <button onClick={onLogout} className="btn-outline mt-2 text-red-600">
                Log out
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
