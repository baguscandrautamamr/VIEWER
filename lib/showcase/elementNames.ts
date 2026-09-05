import { getSupabase } from '@/lib/supabase';

// Ambil nama & kategori elemen dari tabel `elements` — versi yang bisa dipakai
// ulang oleh viewer presentasi. Logikanya sama dengan ModelViewer.tsx:
// WAJIB paginasi (Supabase membatasi 1000 baris/permintaan tanpa error), maju
// sebanyak baris yang benar-benar diterima, berhenti saat halaman kosong.
// Indeks cadangan `byElementId` dipakai untuk objek GLB yang dinamai angka
// (ElementId Revit), dijodohkan lewat ekor nama IFC `Family:Type:1073322`.

export interface ElementNames {
  categoryByGid: Map<string, string>;
  nameByGid: Map<string, string>;
  byElementId: Map<string, { category: string | null; name: string | null }>;
}

export async function fetchElementNames(
  projectId: string,
  isActive: () => boolean = () => true
): Promise<ElementNames | null> {
  const PAGE = 1000;
  const MAX_PAGES = 500;
  const categoryByGid = new Map<string, string>();
  const nameByGid = new Map<string, string>();
  const byElementId = new Map<string, { category: string | null; name: string | null }>();
  let from = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await getSupabase()
      .from('elements')
      .select('global_id, category, name')
      .eq('project_id', projectId)
      .order('global_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (!isActive()) return null;
    if (error) {
      console.error('Gagal memuat nama elemen:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const gid = row.global_id as string;
      const cat = (row.category as string) || null;
      const nm = (row.name as string) || null;
      if (cat) categoryByGid.set(gid, cat);
      if (nm) nameByGid.set(gid, nm);
      const alt = nm ? /:(\d{3,})\s*$/.exec(nm)?.[1] : null;
      if (alt) byElementId.set(alt, { category: cat, name: nm });
    }
    from += data.length;
  }
  return { categoryByGid, nameByGid, byElementId };
}
