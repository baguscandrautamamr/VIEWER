using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitWebViewer
{
    // Tombol "Export & Push". Alur meniru scripts/push-model.mjs:
    // export IFC (view aktif) -> IfcConvert -> upload GLB -> kategori -> versi baru.
    //
    // Manual (bukan ReadOnly): export IFC Revit membuka transaction sendiri secara
    // internal. Mode ReadOnly memblokir semua transaction -> error "Modifying is
    // forbidden because the document has no open transaction." Manual membiarkan
    // exporter mengelola transaction-nya sendiri; kita sendiri tidak mengubah model.
    [Transaction(TransactionMode.Manual)]
    public class ExportPushCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null) { TaskDialog.Show("Revit Web Viewer", "Buka project dulu."); return Result.Cancelled; }
            Document doc = uidoc.Document;

            Config cfg = LoadConfigOrPrompt();
            if (cfg == null) return Result.Cancelled; // user batal isi config

            // Wajib 3D view (yang sudah di-isolate ke electrical).
            View view = doc.ActiveView;
            if (!(view is View3D))
            {
                TaskDialog.Show("Revit Web Viewer",
                    "Buka 3D view yang sudah di-isolate ke electrical dulu, baru klik Export & Push.");
                return Result.Cancelled;
            }

            string workDir = Path.Combine(Path.GetTempPath(), "rwv-" + DateTime.Now.Ticks);
            Directory.CreateDirectory(workDir);
            string ifcPath = Path.Combine(workDir, "model.ifc");
            string glbPath = Path.Combine(workDir, "model.glb");
            string pushedBy = SafeUser(commandData);

            try
            {
                // 1) Export IFC dari view aktif (Revit API -> harus di main thread).
                var opt = new IFCExportOptions();
                opt.FileVersion = IFCVersion.IFC2x3CV2;
                opt.FilterViewId = view.Id;

                // PENTING: export IFC menulis balik IfcGUID ke elemen model, jadi
                // WAJIB di dalam Transaction (beda dari export DWG/NWC yang read-only).
                // Tanpa ini -> ModificationOutsideTransactionException
                // ("Modifying is forbidden because the document has no open transaction").
                bool ok;
                using (var tx = new Transaction(doc, "Revit Web Viewer — Export IFC"))
                {
                    tx.Start();
                    ok = doc.Export(workDir, "model", opt);
                    tx.Commit();
                }
                if (!ok || !File.Exists(ifcPath))
                    throw new Exception("Export IFC gagal dari view aktif.");

                // 2..6) IfcConvert + upload + DB. Jalankan di Task.Run supaya
                // panggilan HTTP async tidak deadlock dengan context UI Revit.
                string resultMsg = Task.Run(() => DoPushAsync(cfg, ifcPath, glbPath, pushedBy))
                    .GetAwaiter().GetResult();

                TaskDialog.Show("Revit Web Viewer — Sukses (build " + AppInfo.BuildTag + ")", resultMsg);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                string detail = FormatError(ex);
                WriteLog(detail);
                ErrorDialog.Display("Revit Web Viewer — Gagal (build " + AppInfo.BuildTag + ")", detail);
                message = ex.Message;
                return Result.Failed;
            }
            finally
            {
                try { Directory.Delete(workDir, true); } catch { /* biarin */ }
            }
        }

        // Detail teknis lengkap buat diagnosa: type + message + stack trace,
        // termasuk inner exception. Ini yang menunjukkan API mana yang gagal.
        private static string FormatError(Exception ex)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Build: " + AppInfo.BuildTag);
            var e = ex;
            int depth = 0;
            while (e != null)
            {
                sb.AppendLine();
                sb.AppendLine("[" + depth + "] " + e.GetType().FullName);
                sb.AppendLine("Message: " + e.Message);
                sb.AppendLine("Stack trace:");
                sb.AppendLine(e.StackTrace ?? "(tidak ada)");
                e = e.InnerException;
                depth++;
            }
            return sb.ToString();
        }

        private static void WriteLog(string detail)
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitWebViewer");
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, "last-error.txt"), detail);
            }
            catch { /* log gagal, tidak fatal */ }
        }

        // Ambil config. Kalau belum ada / tidak valid, tawarkan buka form
        // Pengaturan langsung (biar tidak dead-end seperti error lama). Return
        // null artinya user membatalkan -> command berhenti tanpa error.
        private static Config LoadConfigOrPrompt()
        {
            try { return Config.Load(); }
            catch (Exception ex)
            {
                var td = new TaskDialog("Revit Web Viewer — Konfigurasi")
                {
                    MainInstruction = "Konfigurasi belum lengkap.",
                    MainContent = ex.Message,
                    AllowCancellation = true,
                    CommonButtons = TaskDialogCommonButtons.Cancel
                };
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Buka Pengaturan sekarang");

                if (td.Show() != TaskDialogResult.CommandLink1)
                    return null;

                if (!SettingsForm.Edit(Config.ReadRaw()))
                    return null; // user batal di form

                try { return Config.Load(); }
                catch (Exception ex2)
                {
                    TaskDialog.Show("Revit Web Viewer — Konfigurasi", ex2.Message);
                    return null;
                }
            }
        }

        private static async Task<string> DoPushAsync(Config cfg, string ifcPath, string glbPath, string pushedBy)
        {
            // 2) IFC -> GLB via IfcConvert (subprocess).
            RunIfcConvert(cfg.IfcConvertPath, ifcPath, glbPath);
            if (!File.Exists(glbPath))
                throw new Exception("GLB tidak terbentuk — cek IfcConvertPath di config.");

            // 3) Parse kategori dari IFC.
            var rows = IfcElementParser.Parse(File.ReadAllText(ifcPath));

            using (var sb = new SupabaseClient(cfg))
            {
                int version = await sb.GetNextVersionAsync();
                string storagePath = cfg.ProjectId + "/v" + version + "-" +
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ".glb";

                // 4) Upload GLB.
                string publicUrl = await sb.UploadGlbAsync(storagePath, File.ReadAllBytes(glbPath));

                // 5) Baris model_versions baru (memicu Realtime -> viewer auto-reload).
                string versionId = await sb.InsertModelVersionAsync(version, publicUrl, pushedBy);

                // 6) Upsert kategori tiap objek.
                await sb.UpsertElementsAsync(versionId, rows);

                string token = await sb.GetTokenAsync();
                string link = BuildPresentLink(cfg, token);

                return "Versi v" + version + " ke-push.\n" +
                       rows.Count + " objek, kategori terdeteksi.\n\n" +
                       "Viewer yang sedang terbuka akan auto-update.\n" +
                       (link != null ? "Link: " + link : "");
            }
        }

        private static void RunIfcConvert(string exe, string ifcPath, string glbPath)
        {
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = "-y --use-element-guids \"" + ifcPath + "\" \"" + glbPath + "\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
                RedirectStandardOutput = true
            };
            try
            {
                using (var p = Process.Start(psi))
                {
                    // Warning material '<Unnamed>' di stderr itu wajar (non-fatal).
                    p.StandardError.ReadToEnd();
                    p.StandardOutput.ReadToEnd();
                    p.WaitForExit();
                }
            }
            catch (Exception ex)
            {
                throw new Exception("Gagal menjalankan IfcConvert (" + exe + "): " + ex.Message);
            }
        }

        private static string BuildPresentLink(Config cfg, string token)
        {
            if (string.IsNullOrWhiteSpace(cfg.PresentBaseUrl) || token == null) return null;
            return cfg.PresentBaseUrl.TrimEnd('/') + "/present/" + cfg.ProjectId + "?t=" + token;
        }

        private static string SafeUser(ExternalCommandData cmd)
        {
            try { return "revit-" + cmd.Application.Application.Username; }
            catch { return "revit-addin"; }
        }
    }
}
