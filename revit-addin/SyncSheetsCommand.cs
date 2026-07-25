using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitWebViewer
{
    // Tombol "Sync Sheets". Export tiap ViewSheet jadi PDF -> upload ke Google
    // Drive -> catat ke tabel sheets (dengan preset kamera untuk klik-di-web).
    // Model TIDAK ikut (ringan). Fase 2 + 3a.
    [Transaction(TransactionMode.Manual)]
    public class SyncSheetsCommand : IExternalCommand
    {
        private class SheetExport
        {
            public string Number;
            public string Name;
            public string PdfPath;
            public string Preset;
            public int Sort;
        }

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null) { TaskDialog.Show("Revit Web Viewer", "Buka project dulu."); return Result.Cancelled; }
            Document doc = uidoc.Document;

            Config cfg;
            try { cfg = Config.Load(); }
            catch (Exception ex)
            {
                TaskDialog.Show("Revit Web Viewer — Konfigurasi",
                    ex.Message + "\n\nKlik tombol Pengaturan untuk mengisi.");
                return Result.Failed;
            }

            var sheets = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSheet))
                .Cast<ViewSheet>()
                .Where(s => !s.IsPlaceholder)
                .OrderBy(s => s.SheetNumber)
                .ToList();

            if (sheets.Count == 0)
            {
                TaskDialog.Show("Revit Web Viewer", "Tidak ada sheet di project ini.");
                return Result.Cancelled;
            }

            string workDir = Path.Combine(Path.GetTempPath(), "rwv-sheets-" + DateTime.Now.Ticks);
            Directory.CreateDirectory(workDir);
            string pushedBy = SafeUser(commandData);

            try
            {
                // 1) Export tiap sheet -> PDF (Revit API, UI thread).
                var items = new List<SheetExport>();
                for (int i = 0; i < sheets.Count; i++)
                {
                    var s = sheets[i];
                    var opts = new PDFExportOptions { Combine = true, FileName = "sheet_" + i };
                    doc.Export(workDir, new List<ElementId> { s.Id }, opts);
                    string pdf = Path.Combine(workDir, "sheet_" + i + ".pdf");
                    if (!File.Exists(pdf)) continue;
                    items.Add(new SheetExport
                    {
                        Number = s.SheetNumber,
                        Name = s.Name,
                        PdfPath = pdf,
                        Preset = PresetForSheet(doc, s),
                        Sort = i
                    });
                }
                if (items.Count == 0) throw new Exception("Tidak ada PDF sheet yang terbentuk.");

                // 2) Upload + DB di background (Revit tetap responsif).
                using (var progress = new ProgressDialog(
                    "Upload " + items.Count + " sheet ke server…\nJangan tutup Revit.",
                    () => DoSyncAsync(cfg, items, pushedBy)))
                {
                    progress.ShowDialog();
                    if (progress.Error != null) throw progress.Error;

                    TaskDialog.Show("Revit Web Viewer — Sukses (build " + AppInfo.BuildTag + ")",
                        progress.Result);
                    return Result.Succeeded;
                }
            }
            catch (Exception ex)
            {
                ErrorDialog.Display("Revit Web Viewer — Sync Sheets Gagal (build " + AppInfo.BuildTag + ")",
                    "Build: " + AppInfo.BuildTag + "\n\n" + ex);
                message = ex.Message;
                return Result.Failed;
            }
            finally
            {
                try { Directory.Delete(workDir, true); } catch { /* biarin */ }
            }
        }

        private static async Task<string> DoSyncAsync(Config cfg, List<SheetExport> items, string pushedBy)
        {
            using (var sb = new SupabaseClient(cfg))
            {
                await sb.DeleteSheetsAsync(); // ganti total (bukan tambah)
                int n = 0;
                foreach (var it in items)
                {
                    string fileName = cfg.ProjectId + "-sheet" + it.Sort + "-" +
                        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ".pdf";
                    string driveId = await DriveUploader.UploadAsync(
                        cfg.PresentBaseUrl, cfg.ServiceRoleKey, fileName,
                        File.ReadAllBytes(it.PdfPath), "application/pdf");
                    await sb.InsertSheetAsync(it.Number, it.Name, driveId, it.Preset, it.Sort);
                    n++;
                }
                return n + " sheet ter-sync.\nBuka viewer, klik sheet untuk pindah sudut kamera 3D.";
            }
        }

        // Tentukan preset kamera dari view yang ditempel di sheet.
        private static string PresetForSheet(Document doc, ViewSheet sheet)
        {
            foreach (ElementId vpId in sheet.GetAllViewports())
            {
                var vp = doc.GetElement(vpId) as Viewport;
                if (vp == null) continue;
                var v = doc.GetElement(vp.ViewId) as View;
                if (v == null) continue;

                switch (v.ViewType)
                {
                    case ViewType.FloorPlan:
                    case ViewType.AreaPlan:
                    case ViewType.EngineeringPlan:
                        return "top";
                    case ViewType.CeilingPlan:
                        return "bottom";
                    case ViewType.ThreeD:
                        return "iso";
                    case ViewType.Elevation:
                    case ViewType.Section:
                        return PresetFromDirection(v.ViewDirection);
                }
            }
            return "iso";
        }

        // Perkiraan sisi pandang dari arah view (Revit Z-up). Aproksimasi:
        // sumbu horizontal dominan -> left/right (X) atau front/back (Y).
        private static string PresetFromDirection(XYZ d)
        {
            double ax = Math.Abs(d.X), ay = Math.Abs(d.Y);
            if (ax >= ay) return d.X >= 0 ? "right" : "left";
            return d.Y >= 0 ? "back" : "front";
        }

        private static string SafeUser(ExternalCommandData cmd)
        {
            try { return "revit-" + cmd.Application.Application.Username; }
            catch { return "revit-addin"; }
        }
    }
}
