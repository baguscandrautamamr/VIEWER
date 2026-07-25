using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json;

namespace RevitWebViewer
{
    // Konfigurasi add-in. Berisi service role key (RAHASIA) -> jangan di-commit
    // / share. Bisa diisi lewat form Pengaturan di ribbon (disarankan) atau,
    // untuk kompatibilitas, file JSON manual di samping DLL.
    //
    // Lokasi simpan/baca:
    //   1. %AppData%\RevitWebViewer\revit-web-viewer.config.json  (utama, dipakai
    //      form Pengaturan; 1 config dipakai semua versi Revit, tidak butuh izin
    //      tulis ke folder DLL).
    //   2. <folder DLL>\revit-web-viewer.config.json              (legacy, tetap
    //      dibaca kalau ada supaya setup lama tidak rusak).
    public class Config
    {
        public string SupabaseUrl { get; set; }
        public string ServiceRoleKey { get; set; }
        public string ProjectId { get; set; }
        public string Bucket { get; set; }
        public string IfcConvertPath { get; set; }
        public string PresentBaseUrl { get; set; } // opsional, buat cetak link

        public const string FileName = "revit-web-viewer.config.json";

        // Lokasi utama (ditulis oleh form Pengaturan).
        public static string UserConfigPath
        {
            get
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitWebViewer");
                return Path.Combine(dir, FileName);
            }
        }

        // Lokasi legacy (di samping DLL).
        public static string LegacyConfigPath
        {
            get
            {
                string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                return Path.Combine(dir, FileName);
            }
        }

        // File config yang benar-benar ada di disk (prioritas: user -> legacy).
        // null kalau belum pernah diisi.
        public static string ResolveExistingPath()
        {
            if (File.Exists(UserConfigPath)) return UserConfigPath;
            if (File.Exists(LegacyConfigPath)) return LegacyConfigPath;
            return null;
        }

        // Baca config apa adanya (tanpa validasi), buat prefill form Pengaturan.
        // Return null kalau belum ada file / JSON rusak (form mulai kosong).
        public static Config ReadRaw()
        {
            string path = ResolveExistingPath();
            if (path == null) return null;
            try { return JsonConvert.DeserializeObject<Config>(File.ReadAllText(path)); }
            catch { return null; }
        }

        // Baca + validasi. Dipakai sebelum Export & Push.
        public static Config Load()
        {
            string path = ResolveExistingPath();
            if (path == null)
                throw new Exception(
                    "Konfigurasi belum diisi.\n" +
                    "Klik tombol \"Pengaturan\" di tab Revit Web Viewer untuk mengisinya.");

            Config cfg;
            try { cfg = JsonConvert.DeserializeObject<Config>(File.ReadAllText(path)); }
            catch (Exception ex) { throw new Exception("Config JSON tidak valid: " + ex.Message); }

            if (cfg == null) throw new Exception("Config kosong.");
            cfg.Validate();
            cfg.Normalize();
            return cfg;
        }

        // Lempar Exception dengan pesan jelas kalau ada field wajib yang kosong.
        public void Validate()
        {
            if (string.IsNullOrWhiteSpace(SupabaseUrl)) throw new Exception("Supabase URL belum diisi.");
            if (string.IsNullOrWhiteSpace(ServiceRoleKey)) throw new Exception("Service Role Key belum diisi.");
            if (string.IsNullOrWhiteSpace(ProjectId)) throw new Exception("Project ID belum diisi.");
            if (string.IsNullOrWhiteSpace(IfcConvertPath)) throw new Exception("Path IfcConvert.exe belum diisi.");
        }

        public void Normalize()
        {
            SupabaseUrl = (SupabaseUrl ?? "").TrimEnd('/');
            if (string.IsNullOrWhiteSpace(Bucket)) Bucket = "models";
        }

        // Simpan ke lokasi utama (%AppData%). Dipanggil form Pengaturan.
        public void Save()
        {
            Normalize();
            string path = UserConfigPath;
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, JsonConvert.SerializeObject(this, Formatting.Indented));
        }
    }
}
