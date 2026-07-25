using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json;

namespace RevitWebViewer
{
    // Konfigurasi dibaca dari file JSON di samping DLL:
    //   revit-web-viewer.config.json
    // File ini berisi service role key (RAHASIA) -> jangan di-commit / share.
    public class Config
    {
        public string SupabaseUrl { get; set; }
        public string ServiceRoleKey { get; set; }
        public string ProjectId { get; set; }
        public string Bucket { get; set; }
        public string IfcConvertPath { get; set; }
        public string PresentBaseUrl { get; set; } // opsional, buat cetak link

        public const string FileName = "revit-web-viewer.config.json";

        public static Config Load()
        {
            string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string path = Path.Combine(dir, FileName);
            if (!File.Exists(path))
                throw new Exception("Config tidak ditemukan: " + path +
                    "\nSalin revit-web-viewer.config.example.json jadi " + FileName + " lalu isi.");

            Config cfg;
            try { cfg = JsonConvert.DeserializeObject<Config>(File.ReadAllText(path)); }
            catch (Exception ex) { throw new Exception("Config JSON tidak valid: " + ex.Message); }

            if (cfg == null) throw new Exception("Config kosong.");
            if (string.IsNullOrWhiteSpace(cfg.SupabaseUrl)) throw new Exception("SupabaseUrl belum diisi di config.");
            if (string.IsNullOrWhiteSpace(cfg.ServiceRoleKey)) throw new Exception("ServiceRoleKey belum diisi di config.");
            if (string.IsNullOrWhiteSpace(cfg.ProjectId)) throw new Exception("ProjectId belum diisi di config.");
            if (string.IsNullOrWhiteSpace(cfg.IfcConvertPath)) throw new Exception("IfcConvertPath belum diisi di config.");

            cfg.SupabaseUrl = cfg.SupabaseUrl.TrimEnd('/');
            if (string.IsNullOrWhiteSpace(cfg.Bucket)) cfg.Bucket = "models";
            return cfg;
        }
    }
}
