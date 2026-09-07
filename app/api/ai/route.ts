import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase';
import { systemPrompt, type AiMode } from '@/lib/showcase/aiPrompt';
import type { AiContext } from '@/lib/showcase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Asisten AI untuk viewer presentasi (components/showcase/*).
//
// Kunci API TIDAK pernah sampai ke browser: browser memanggil route ini, route
// ini yang memanggil Messages API. Konfigurasi lewat env:
//   ANTHROPIC_API_KEY  wajib
//   ANTHROPIC_BASE_URL opsional — proxy yang kompatibel Messages API
//                      (mis. https://api.vikey.ai)
//   AI_MODEL           opsional — bawaan claude-opus-5; lewat proxy bisa
//                      diisi model lain, mis. openai/gpt-5.6-luna
//
// Akses dijaga dengan token client (query `t` di halaman presentasi) yang
// dicek ke projects.client_access_token — tanpa ini siapa pun bisa memakai
// kuota AI lewat endpoint terbuka. Ditambah pembatas laju sederhana per IP.

const DEFAULT_MODEL = 'claude-opus-5';
const MAX_TOKENS: Record<AiMode, number> = { chat: 1500, explain: 700, tour: 3000 };
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 60;
const rate = new Map<string, { n: number; t: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = rate.get(ip);
  if (!cur || now - cur.t > RATE_WINDOW_MS) {
    rate.set(ip, { n: 1, t: now });
    return false;
  }
  cur.n++;
  return cur.n > RATE_MAX;
}

function configured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function modelId() {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

// Browser memakai ini untuk tahu apakah fitur AI perlu ditampilkan.
export async function GET() {
  return NextResponse.json({ configured: configured(), model: configured() ? modelId() : null });
}

interface Body {
  projectId?: string;
  token?: string;
  mode?: AiMode;
  messages?: { role: 'user' | 'assistant'; content: string }[];
  context?: AiContext;
  tour?: { id: string; title: string; description: string }[];
}

export async function POST(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json(
      { error: 'AI belum dikonfigurasi. Set ANTHROPIC_API_KEY (dan ANTHROPIC_BASE_URL bila memakai proxy).' },
      { status: 503 }
    );
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Terlalu banyak permintaan, coba lagi beberapa menit.' }, { status: 429 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }
  const mode: AiMode = body.mode === 'explain' || body.mode === 'tour' ? body.mode : 'chat';
  if (!body.projectId || !body.token || !body.context) {
    return NextResponse.json({ error: 'projectId, token, dan context wajib' }, { status: 400 });
  }

  // Gate akses — sama seperti halaman presentasi.
  const supabase = createServiceClient();
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', body.projectId)
    .eq('client_access_token', body.token)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = new Anthropic({ maxRetries: 1, timeout: 90_000 });
  const system = systemPrompt(mode, body.context);

  // Riwayat percakapan: batasi 12 pesan terakhir supaya konteks tidak membengkak.
  const history: Anthropic.MessageParam[] = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  let messages: Anthropic.MessageParam[] = history;
  if (mode === 'explain') {
    messages = [{ role: 'user', content: body.context.locale === 'en' ? 'Explain the selected element.' : 'Jelaskan elemen yang sedang dipilih.' }];
  } else if (mode === 'tour') {
    const stops = (body.tour ?? []).map((s) => ({ id: s.id, title: s.title, description: s.description }));
    if (stops.length === 0) return NextResponse.json({ error: 'tour kosong' }, { status: 400 });
    messages = [{ role: 'user', content: `Pemberhentian:\n${JSON.stringify(stops, null, 1)}` }];
  }
  if (messages.length === 0 || messages[0].role !== 'user') {
    return NextResponse.json({ error: 'Pesan pertama harus dari user' }, { status: 400 });
  }

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelId(),
    max_tokens: MAX_TOKENS[mode],
    system,
    messages,
  };

  try {
    if (mode === 'tour') {
      const res = await client.messages.create(params);
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const parsed = extractJson(text);
      if (!parsed || !Array.isArray(parsed.stops)) {
        return NextResponse.json({ error: 'AI tidak mengembalikan JSON tur yang valid' }, { status: 502 });
      }
      return NextResponse.json({ stops: parsed.stops });
    }

    // chat & explain: stream teks apa adanya (text/plain). Kalau proxy/model
    // tidak mendukung streaming, jatuh ke non-streaming — hasil sama, cuma
    // tampil sekaligus.
    const encoder = new TextEncoder();
    let stream: ReadableStream<Uint8Array>;
    try {
      const s = client.messages.stream(params);
      stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const event of s) {
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                controller.enqueue(encoder.encode(event.delta.text));
              }
            }
            const final = await s.finalMessage();
            if (final.stop_reason === 'refusal') {
              controller.enqueue(encoder.encode('\n\n[AI menolak menjawab permintaan ini.]'));
            }
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`\n\n[${errorMessage(err)}]`));
            controller.close();
          }
        },
      });
    } catch {
      const res = await client.messages.create(params);
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(text));
          controller.close();
        },
      });
    }
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        'X-AI-Model': modelId(),
      },
    });
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status ?? 502 : 502;
    return NextResponse.json({ error: errorMessage(err) }, { status: status >= 400 ? status : 502 });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'API key AI ditolak oleh server AI.';
  if (err instanceof Anthropic.RateLimitError) return 'Kuota AI sedang penuh, coba lagi sebentar.';
  if (err instanceof Anthropic.APIConnectionError) return 'Tidak bisa terhubung ke server AI.';
  if (err instanceof Anthropic.APIError) return `Server AI menolak permintaan (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : 'Kesalahan tidak dikenal';
}

// Model kadang membungkus JSON dengan teks/markdown; ambil objek pertama.
function extractJson(text: string): { stops?: unknown } | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
