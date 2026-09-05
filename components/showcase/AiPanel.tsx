'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseAiActions } from '@/lib/showcase/aiActions';
import type { AiAction, AiContext } from '@/lib/showcase/types';
import { CloseButton, Eyebrow, Icons, Panel, tpl, type ShowcaseStrings } from './ui';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string; // teks bersih (tanpa baris aksi)
  actions?: AiAction[];
  error?: boolean;
}

// Hook: percakapan dengan /api/ai (mode chat), streaming teks. Aksi yang
// ditulis model diparse setelah balasan selesai lalu diserahkan ke pemanggil.
export function useAiChat({
  projectId,
  token,
  getContext,
  onActions,
}: {
  projectId: string;
  token: string;
  getContext: () => AiContext;
  onActions: (actions: AiAction[]) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const rawHistory = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setBusy(true);
      rawHistory.current.push({ role: 'user', content: q });
      setMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let full = '';
      try {
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({ projectId, token, mode: 'chat', messages: rawHistory.current, context: getContext() }),
        });
        if (!res.ok) {
          let msg = `${res.status}`;
          try {
            msg = ((await res.json()) as { error?: string }).error ?? msg;
          } catch {
            /* bukan JSON */
          }
          throw new Error(msg);
        }
        const reader = res.body?.getReader();
        const dec = new TextDecoder();
        if (reader) {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            full += dec.decode(value, { stream: true });
            const { clean } = parseAiActions(full);
            setMessages((m) => {
              const next = m.slice();
              next[next.length - 1] = { role: 'assistant', content: clean };
              return next;
            });
          }
        } else {
          full = await res.text();
        }
        const { clean, actions } = parseAiActions(full);
        rawHistory.current.push({ role: 'assistant', content: full });
        setMessages((m) => {
          const next = m.slice();
          next[next.length - 1] = { role: 'assistant', content: clean, actions };
          return next;
        });
        if (actions.length) onActions(actions);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : String(err);
        rawHistory.current.pop(); // pertanyaan gagal, jangan diulang di riwayat
        setMessages((m) => {
          const next = m.slice();
          next[next.length - 1] = { role: 'assistant', content: msg, error: true };
          return next;
        });
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, projectId, token, getContext, onActions]
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    rawHistory.current = [];
    setMessages([]);
    setBusy(false);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, busy, send, clear };
}

// Panel obrolan (kanan). Saran pertanyaan tampil saat kosong.
export default function AiPanel({
  strings: s,
  enabled,
  model,
  messages,
  busy,
  onSend,
  onClear,
  onClose,
  draft,
}: {
  strings: ShowcaseStrings;
  enabled: boolean;
  model: string | null;
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
  draft?: string;
}) {
  const [text, setText] = useState(draft ?? '');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft !== undefined) setText(draft);
  }, [draft]);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function submit() {
    if (!text.trim() || busy) return;
    onSend(text);
    setText('');
  }

  const suggestions = [s.aiSuggest1, s.aiSuggest2, s.aiSuggest3, s.aiSuggest4];

  return (
    <Panel className="sc-side sc-ai">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Eyebrow className="flex items-center gap-1.5">
            <span className="text-[color:var(--sc-accent)]">{Icons.spark}</span>
            {s.aiTitle}
            {model && <span className="sc-mono normal-case tracking-normal text-white/35">{model}</span>}
          </Eyebrow>
          <p className="mt-1 text-[11.5px] leading-snug text-white/55">{s.aiSubtitle}</p>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <div ref={listRef} className="sc-scroll sc-chat mt-3 flex-1">
        {!enabled && <p className="sc-bubble is-error">{s.aiOffline}</p>}
        {enabled && messages.length === 0 && (
          <div className="flex flex-col gap-1.5">
            {suggestions.map((q) => (
              <button key={q} type="button" onClick={() => onSend(q)} className="sc-suggest">
                {Icons.arrowUpRight}
                {q}
              </button>
            ))}
          </div>
        )}
        {messages.map((mm, i) => (
          <div key={i} className={`sc-bubble ${mm.role === 'user' ? 'is-user' : ''} ${mm.error ? 'is-error' : ''}`}>
            {mm.error ? tpl(s.aiError, { msg: mm.content }) : mm.content || (busy && i === messages.length - 1 ? s.aiThinking : '')}
            {mm.actions && mm.actions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {mm.actions.map((a, j) => (
                  <span key={j} className="sc-chip is-on">
                    {tpl(s.aiActionDone, { a: 'query' in a ? `${a.type}: ${a.query}` : 'mode' in a ? `${a.type}: ${a.mode}` : a.type })}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2">
        <div className="sc-input">
          <textarea
            ref={inputRef}
            rows={2}
            value={text}
            disabled={!enabled}
            placeholder={s.aiPlaceholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') onClose();
            }}
          />
          <button type="button" onClick={submit} disabled={!enabled || busy || !text.trim()} className="sc-btn sc-btn-primary sc-send" aria-label={s.aiSend}>
            {Icons.send}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-white/35">{s.aiDisclaimer}</span>
          {messages.length > 0 && (
            <button type="button" onClick={onClear} className="sc-link">
              {s.aiClear}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
