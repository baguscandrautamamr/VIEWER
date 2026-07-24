import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Client-side (browser): pakai anon key, aman diekspos (dibatasi RLS).
//
// Lazy singleton — sengaja TIDAK dibuat di top-level. Kalau eager, import file
// ini dari server route (yang cuma butuh createServiceClient) atau saat
// `next build` tanpa env akan langsung throw "supabaseUrl is required".
// Dengan lazy, client anon baru dibuat pertama kali dipakai (di browser,
// tempat NEXT_PUBLIC_* pasti ada).
let browserClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return browserClient;
}

// Server-side only (dipakai di app/api/* & server component): pakai service
// role key, JANGAN pernah panggil ini dari komponen client.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
