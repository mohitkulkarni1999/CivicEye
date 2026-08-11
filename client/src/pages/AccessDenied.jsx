import { Link } from 'react-router-dom';

export default function AccessDenied() {
  return (
    <div className="container-page flex justify-center py-24">
      <div className="w-full max-w-md text-center">
        <div className="card p-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl">⛔</div>
          <h1 className="mt-4 text-xl font-bold text-ink-900">Access denied</h1>
          <p className="mt-2 text-sm text-ink-500">
            Your account does not have permission to view this portal. Each CivicEye portal is restricted to its own
            account type.
          </p>
          <Link to="/" className="btn-primary mt-6">Go to home</Link>
        </div>
      </div>
    </div>
  );
}
