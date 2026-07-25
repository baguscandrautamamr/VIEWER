-- Revit Web Viewer — schema Supabase
-- Jalankan di SQL Editor Supabase, urutan sesuai dependency foreign key.

create extension if not exists "pgcrypto";

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_access_token text unique not null,
  created_at timestamptz default now()
);

create table model_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  version_number int not null,
  -- Model GLB bisa disimpan di salah satu:
  --   glb_drive_file_id  -> Google Drive (disajikan viewer lewat /api/model/[id])
  --   glb_storage_path   -> URL publik Supabase Storage (cara lama)
  -- Salah satu wajib ada; keduanya nullable supaya fleksibel.
  glb_storage_path text,
  glb_drive_file_id text,
  rvt_drive_file_id text,
  changed_global_ids text[] default '{}',
  pushed_at timestamptz default now(),
  pushed_by text
);

create table sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  version_id uuid references model_versions(id) on delete cascade,
  sheet_number text not null,
  sheet_name text,
  pdf_storage_path text not null
);

create table elements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  global_id text not null,
  category text,
  name text,
  parameters jsonb default '{}',
  last_updated_version_id uuid references model_versions(id),
  unique (project_id, global_id)
);

-- Row Level Security.
alter table projects enable row level security;
alter table model_versions enable row level security;
alter table sheets enable row level security;
alter table elements enable row level security;

-- Kebijakan Fase 1 (token via query string, lihat bagian 11 spec):
--
-- * `projects` sengaja TIDAK punya policy untuk anon — tabel ini hanya diakses
--   dari server (service role, bypass RLS) saat validasi token di
--   app/present/[projectId]/page.tsx. Jadi client tidak pernah bisa list
--   semua project / menebak token lewat anon key.
-- * `model_versions`, `sheets`, `elements` boleh dibaca anon, TAPI cuma bila
--   client sudah tahu project_id (UUID acak, tidak bisa ditebak). Ini yang
--   dipakai oleh Supabase Realtime (lib/realtime.ts) dan fetch parameter
--   elemen saat isolate-on-click — keduanya jalan pakai anon key di browser.
--
-- Catatan: ini guard tingkat "unguessable UUID", cukup untuk Fase 1 demo.
-- Kalau butuh lebih ketat (token ikut dicek di level row), ganti policy
-- di bawah setelah mekanisme token difinalkan.
create policy "anon read model_versions"
  on model_versions for select to anon using (true);

create policy "anon read sheets"
  on sheets for select to anon using (true);

create policy "anon read elements"
  on elements for select to anon using (true);

-- Supabase Realtime hanya mem-broadcast perubahan tabel yang masuk ke
-- publication `supabase_realtime`. Tanpa baris ini, INSERT ke model_versions
-- TIDAK akan sampai ke client yang subscribe di lib/realtime.ts.
alter publication supabase_realtime add table model_versions;

-- ---------------------------------------------------------------------------
-- MIGRASI untuk database yang SUDAH dibuat sebelum kolom glb_drive_file_id ada.
-- Aman dijalankan berulang (idempotent). Jalankan di SQL Editor sekali.
-- ---------------------------------------------------------------------------
alter table model_versions add column if not exists glb_drive_file_id text;
alter table model_versions alter column glb_storage_path drop not null;
