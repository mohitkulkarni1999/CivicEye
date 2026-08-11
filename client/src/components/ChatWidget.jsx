import { useState, useRef, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { http } from '../lib/api.js';
import Spinner from './Spinner.jsx';
import { BotIcon, XIcon, SendIcon, SparklesIcon } from './icons.jsx';

const SUGGESTIONS = [
  'How do I report a pothole?',
  'What happens after I submit a report?',
  'How does AI verify my photo?',
  'Can I report anonymously?',
];

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-600 text-white shadow-sm">
          <BotIcon size={14} />
        </span>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'rounded-tr-sm bg-blue-600 text-white'
            : 'rounded-tl-sm bg-white text-ink-800 ring-1 ring-ink-100'
        }`}
      >
        {msg.text}
        {msg.sources && msg.sources.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {msg.sources.map((s, i) => (
              <span key={i} className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'ai',
      text: '👋 Hi! I\'m CivicEye AI. Ask me anything about reporting issues, tracking status, or how the platform works.',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Extract issueId from URL if on an issue detail page
  const location = useLocation();
  const issueMatch = location.pathname.match(/^\/issues\/([^/]+)/);
  const issueId = issueMatch ? issueMatch[1] : null;

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open, messages]);

  const send = async (text) => {
    const q = (text || query).trim();
    if (!q || loading) return;
    setQuery('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const res = await http.post('/api/ai/chat', { query: q, issueId });
      setMessages((prev) => [
        ...prev,
        { role: 'ai', text: res.reply, sources: res.sources },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'ai', text: '⚠️ Sorry, I couldn\'t answer that right now. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl shadow-2xl ring-1 ring-ink-200"
          style={{ height: '480px', background: 'linear-gradient(180deg,#f8faff 0%,#f0f4ff 100%)' }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 text-white"
            style={{ background: 'linear-gradient(135deg,#1e3a5f 0%,#1a56db 100%)' }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20">
              <BotIcon size={16} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold leading-none">CivicEye AI</p>
              <p className="mt-0.5 text-[11px] text-blue-200">
                {issueId ? `Context: issue #${issueId}` : 'General assistant'}
              </p>
            </div>
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]" />
            <button onClick={() => setOpen(false)} className="ml-1 rounded-lg p-1 hover:bg-white/20">
              <XIcon size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            {loading && (
              <div className="flex gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-600 text-white">
                  <BotIcon size={14} />
                </span>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 shadow-sm ring-1 ring-ink-100">
                  <Spinner className="h-3.5 w-3.5 text-blue-600" />
                  <span className="text-xs text-ink-400">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions (only on first open) */}
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-700 transition hover:bg-blue-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-ink-100 bg-white p-3">
            <div className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-ink-50 px-3 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Ask anything…"
                className="flex-1 bg-transparent text-sm text-ink-900 placeholder-ink-400 focus:outline-none"
              />
              <button
                onClick={() => send()}
                disabled={!query.trim() || loading}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow transition hover:bg-blue-700 disabled:opacity-40"
              >
                <SendIcon size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open AI chat assistant"
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition hover:scale-110 active:scale-95"
        style={{ background: 'linear-gradient(135deg,#1a56db 0%,#7c3aed 100%)' }}
      >
        {open ? (
          <XIcon size={22} className="text-white" />
        ) : (
          <SparklesIcon size={22} className="text-white" />
        )}
        {!open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 text-[9px] font-black text-white shadow">
            AI
          </span>
        )}
      </button>
    </>
  );
}
