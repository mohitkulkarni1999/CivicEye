import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { http } from '../lib/api.js';
import { BotIcon, XIcon, SendIcon } from './icons.jsx';

const QUICK_ACTIONS = [
  'How do I report a problem?',
  'Who leads my area?',
  'Status of my report',
];

const STORAGE_KEY = 'civiceye_chat';

export default function ChatWidget() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  const issueId = location.pathname.match(/^\/issues\/([^/]+)/)?.[1] || null;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore quota errors */
    }
  }, [messages]);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, busy]);

  const send = async (text) => {
    const q = String(text || input).trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const res = await http.post('/api/ai/chat', { query: q, issueId });
      setMessages((m) => [...m, { role: 'ai', text: res.reply, sources: res.sources }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'ai', text: `Sorry, I could not answer that: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[440px] w-[320px] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl sm:w-[360px]">
          <div className="flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
            <p className="flex items-center gap-2 text-sm font-bold">
              <BotIcon size={18} /> CivicEye AI assistant
            </p>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/80 transition hover:bg-white/10 hover:text-white" aria-label="Close chat">
              <XIcon size={18} />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="rounded-xl rounded-tl-sm bg-ink-100 p-3 text-sm text-ink-700">
                  Hi! Ask me anything about CivicEye — how to report, issue status, or who leads your area.
                </p>
                {QUICK_ACTIONS.map((a) => (
                  <button
                    key={a}
                    onClick={() => send(a)}
                    className="block w-full rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-left text-xs font-medium text-brand-700 transition hover:bg-brand-100"
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-ink-100 text-ink-800'}`}>
                  {m.text}
                  {m.sources?.length > 0 && (
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-400">Sources: {m.sources.join(', ')}</p>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-ink-100 px-4 py-3.5">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 border-t border-ink-100 p-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" className="input text-sm" />
            <button disabled={busy} className="btn-primary shrink-0 text-sm" aria-label="Send message">
              <SendIcon size={16} />
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-xl transition hover:scale-105"
        title="Ask CivicEye AI"
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
      >
        {open ? <XIcon size={22} /> : <BotIcon size={26} />}
      </button>
    </>
  );
}
