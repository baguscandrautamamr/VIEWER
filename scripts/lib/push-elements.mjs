// Upsert daftar elemen (GlobalId -> kategori + nama) ke tabel `elements`
// Supabase. Dipakai bareng oleh push-model.mjs (alur otomatis) dan
// ifc-to-web.mjs (alur manual), supaya nama & kategori elemen selalu ada
// berapa pun alur yang dipakai.
//
// Tanpa isi tabel ini, viewer cuma punya GlobalId dari GLB (IfcConvert
// dijalankan dengan --use-element-guids), sehingga semua elemen tampil
// sebagai kode acak dan masuk kategori "Default".

const CHUNK = 500;

// Kirim `rows` ([{ guid, category, name }]) ke Supabase.
// `versionId` opsional — diisi push-model.mjs untuk menandai versi terakhir.
export async function upsertElements({ supabaseUrl, serviceKey, projectId, rows, versionId = null }) {
  const base = supabaseUrl.replace(/\/$/, '');
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };

  for (let i = 0; i < rows.length; i += CHUNK) {
    const body = rows.slice(i, i + CHUNK).map((r) => ({
      project_id: projectId,
      global_id: r.guid,
      category: r.category,
      name: r.name,
      ...(versionId ? { last_updated_version_id: versionId } : {}),
    }));
    const res = await fetch(`${base}/rest/v1/elements?on_conflict=project_id,global_id`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Upsert elements gagal (${res.status}): ${await res.text()}`);
    }
  }
  return rows.length;
}
