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
  -- PDF sheet bisa di Supabase (pdf_storage_path, cara lama) atau Google Drive
  -- (pdf_drive_file_id, disajikan via /api/sheet-file/[id]).
  pdf_storage_path text,
  pdf_drive_file_id text,
  -- Preset kamera 3D untuk "klik sheet -> pindah sudut": top/bottom/front/back/
  -- left/right/iso. Dihitung add-in dari orientasi view di sheet.
  camera_preset text,
  sort_order int default 0,
  -- Kontrol tampil/sembunyi sheet ke client (dicentang admin di halaman Kelola).
  -- Default true supaya sheet baru langsung tampil.
  is_visible boolean default true
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

-- Pustaka file GLB per project (Fase 1 alur manual): user convert IFC->GLB
-- sendiri lalu upload lewat website. Tiap file jadi 1 baris di sini; viewer
-- menampilkannya sebagai dropdown "pilih model".
create table model_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  drive_file_id text not null,
  label text,
  created_at timestamptz default now()
);

-- Row Level Security.
alter table projects enable row level security;
alter table model_versions enable row level security;
alter table sheets enable row level security;
alter table elements enable row level security;
alter table model_files enable row level security;

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

create policy "anon read model_files"
  on model_files for select to anon using (true);

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

-- Tabel pustaka model manual (Fase 1). Aman dijalankan berulang.
create table if not exists model_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  drive_file_id text not null,
  label text,
  created_at timestamptz default now()
);
alter table model_files enable row level security;
do $$ begin
  create policy "anon read model_files" on model_files for select to anon using (true);
exception when duplicate_object then null; end $$;

-- Kolom baru untuk sheets (Fase 2 & 3a). Aman dijalankan berulang.
alter table sheets alter column pdf_storage_path drop not null;
alter table sheets add column if not exists pdf_drive_file_id text;
alter table sheets add column if not exists camera_preset text;
alter table sheets add column if not exists sort_order int default 0;
-- Kontrol tampil/sembunyi sheet ke client (halaman Kelola). Aman berulang.
alter table sheets add column if not exists is_visible boolean default true;

-- ---------------------------------------------------------------------------
-- Tur terpandu tersimpan (mode presentasi). Satu baris = satu pemberhentian.
-- Kalau tabel kosong untuk sebuah project, viewer memakai tur otomatis.
-- Ditulis lewat /api/tour (admin, service role); dibaca viewer lewat route yang
-- sama dengan token client. Aman dijalankan berulang.
-- ---------------------------------------------------------------------------
create table if not exists tour_stops (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  sort_order int default 0,
  title text not null,
  description text default '',
  mode text default 'orbit',          -- 'orbit' | 'walk' | 'plan'
  pose jsonb not null,                -- {position:[x,y,z], target:[x,y,z]}
  highlight jsonb default '{}',       -- {gids:[...]} dan/atau {categories:[...]}
  created_at timestamptz default now()
);
alter table tour_stops enable row level security;
do $$ begin
  create policy "anon read tour_stops" on tour_stops for select to anon using (true);
exception when duplicate_object then null; end $$;
