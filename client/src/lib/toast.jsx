import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckIcon, AlertIcon, InfoIcon, XIcon } from '../components/icons.jsx';

const ToastContext = createContext(null);

const STYLES = {
  success: { border: 'border-emerald-200', icon: 'text-emerald-600', label: 'Success' },
  error: { border: 'border-red-200', icon: 'text-red-600', label: 'Error' },
  info: { border: 'border-brand-200', icon: 'text-brand-600', label: 'Info' },
};

const ICONS = { success: CheckIcon, error: AlertIcon, info: InfoIcon };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (type, message) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t.slice(-3), { id, type, message }]);
      window.setTimeout(() => dismiss(id), 4000);
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[1000] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          const s = STYLES[t.type];
          return (
            <div
              key={t.id}
              className={`toast-enter pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3 pr-2 shadow-lift ${s.border}`}
              role="status"
            >
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.icon}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{s.label}</p>
                <p className="text-sm leading-snug text-ink-800">{t.message}</p>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                aria-label="Dismiss notification"
              >
                <XIcon size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
