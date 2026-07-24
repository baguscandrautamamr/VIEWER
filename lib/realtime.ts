import { getSupabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface ModelVersionPayload {
  id: string;
  project_id: string;
  version_number: number;
  glb_storage_path: string;
  changed_global_ids: string[];
  pushed_at: string;
}

// Dipanggil dari ModelViewer.tsx. Setiap ada row baru di model_versions
// untuk project ini, callback jalan dengan data versi terbaru — dipakai
// untuk reload GLB dan highlight element yang berubah.
export function subscribeToProjectUpdates(
  projectId: string,
  onNewVersion: (version: ModelVersionPayload) => void
): RealtimeChannel {
  return getSupabase()
    .channel(`project-${projectId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'model_versions',
        filter: `project_id=eq.${projectId}`,
      },
      (payload) => onNewVersion(payload.new as ModelVersionPayload)
    )
    .subscribe();
}

export function unsubscribe(channel: RealtimeChannel) {
  getSupabase().removeChannel(channel);
}
