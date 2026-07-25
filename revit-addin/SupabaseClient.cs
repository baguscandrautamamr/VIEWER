using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitWebViewer
{
    // Satu baris tabel `projects`, dipakai form Pengaturan buat pilih/buat
    // project tanpa buka SQL Editor.
    public class ProjectRow
    {
        public string Id;
        public string Name;
        public string Token;

        // Ditampilkan di ListBox picker.
        public override string ToString()
        {
            return (string.IsNullOrEmpty(Name) ? "(tanpa nama)" : Name) + "   —   " + Id;
        }
    }

    // Wrapper HttpClient untuk Supabase Storage + PostgREST. Meniru langkah
    // di scripts/push-model.mjs. Pakai service role key (server-side).
    public class SupabaseClient : IDisposable
    {
        private readonly Config _cfg;
        private readonly HttpClient _http;

        public SupabaseClient(Config cfg)
        {
            _cfg = cfg;
            _http = new HttpClient();
            _http.DefaultRequestHeaders.Add("apikey", cfg.ServiceRoleKey);
            _http.DefaultRequestHeaders.Add("Authorization", "Bearer " + cfg.ServiceRoleKey);
        }

        public async Task<int> GetNextVersionAsync()
        {
            string url = _cfg.SupabaseUrl +
                "/rest/v1/model_versions?project_id=eq." + _cfg.ProjectId +
                "&select=version_number&order=version_number.desc&limit=1";
            string body = await GetStringAsync(url);
            var arr = JArray.Parse(body);
            int last = arr.Count > 0 ? (int)arr[0]["version_number"] : 0;
            return last + 1;
        }

        public async Task<string> UploadGlbAsync(string storagePath, byte[] glb)
        {
            string url = _cfg.SupabaseUrl + "/storage/v1/object/" + _cfg.Bucket + "/" + storagePath;
            using (var content = new ByteArrayContent(glb))
            {
                content.Headers.TryAddWithoutValidation("Content-Type", "model/gltf-binary");
                var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
                req.Headers.TryAddWithoutValidation("x-upsert", "true");
                var res = await _http.SendAsync(req);
                await EnsureOk(res, "Upload GLB");
            }
            return _cfg.SupabaseUrl + "/storage/v1/object/public/" + _cfg.Bucket + "/" + storagePath;
        }

        public async Task<string> InsertModelVersionAsync(int version, string glbDriveFileId, string pushedBy)
        {
            var payload = new JObject
            {
                ["project_id"] = _cfg.ProjectId,
                ["version_number"] = version,
                ["glb_drive_file_id"] = glbDriveFileId,
                ["pushed_by"] = pushedBy
            };
            var res = await PostJsonAsync(_cfg.SupabaseUrl + "/rest/v1/model_versions",
                payload.ToString(), "return=representation");
            await EnsureOk(res, "Insert model_versions");
            var arr = JArray.Parse(await res.Content.ReadAsStringAsync());
            return arr.Count > 0 ? (string)arr[0]["id"] : null;
        }

        public async Task UpsertElementsAsync(string versionId, List<IfcElement> rows)
        {
            const int chunk = 500;
            for (int i = 0; i < rows.Count; i += chunk)
            {
                var arr = new JArray();
                for (int j = i; j < Math.Min(i + chunk, rows.Count); j++)
                {
                    var r = rows[j];
                    arr.Add(new JObject
                    {
                        ["project_id"] = _cfg.ProjectId,
                        ["global_id"] = r.Guid,
                        ["category"] = r.Category,
                        ["name"] = r.Name != null ? new JValue(r.Name) : JValue.CreateNull(),
                        ["last_updated_version_id"] = versionId
                    });
                }
                string url = _cfg.SupabaseUrl + "/rest/v1/elements?on_conflict=project_id,global_id";
                var res = await PostJsonAsync(url, arr.ToString(), "resolution=merge-duplicates,return=minimal");
                await EnsureOk(res, "Upsert elements");
            }
        }

        // Hapus semua sheet project ini (dipanggil sebelum sync ulang biar tidak dobel).
        public async Task DeleteSheetsAsync()
        {
            string url = _cfg.SupabaseUrl + "/rest/v1/sheets?project_id=eq." + _cfg.ProjectId;
            var req = new HttpRequestMessage(HttpMethod.Delete, url);
            req.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
            var res = await _http.SendAsync(req);
            await EnsureOk(res, "Hapus sheet lama");
        }

        // Insert 1 sheet (PDF di Drive + preset kamera).
        public async Task InsertSheetAsync(string number, string name, string pdfDriveFileId, string preset, int sortOrder)
        {
            var payload = new JObject
            {
                ["project_id"] = _cfg.ProjectId,
                ["sheet_number"] = number,
                ["sheet_name"] = name != null ? new JValue(name) : JValue.CreateNull(),
                ["pdf_drive_file_id"] = pdfDriveFileId,
                ["camera_preset"] = preset,
                ["sort_order"] = sortOrder
            };
            var res = await PostJsonAsync(_cfg.SupabaseUrl + "/rest/v1/sheets", payload.ToString(), "return=minimal");
            await EnsureOk(res, "Insert sheet");
        }

        public async Task<string> GetTokenAsync()
        {
            try
            {
                string url = _cfg.SupabaseUrl + "/rest/v1/projects?id=eq." + _cfg.ProjectId +
                    "&select=client_access_token";
                var arr = JArray.Parse(await GetStringAsync(url));
                return arr.Count > 0 ? (string)arr[0]["client_access_token"] : null;
            }
            catch { return null; }
        }

        // Daftar semua project (buat picker di form Pengaturan). Butuh service
        // role key karena RLS memblok anon di tabel projects.
        public async Task<List<ProjectRow>> ListProjectsAsync()
        {
            string url = _cfg.SupabaseUrl +
                "/rest/v1/projects?select=id,name,client_access_token&order=created_at.desc";
            var arr = JArray.Parse(await GetStringAsync(url));
            var list = new List<ProjectRow>();
            foreach (var it in arr)
            {
                list.Add(new ProjectRow
                {
                    Id = (string)it["id"],
                    Name = (string)it["name"],
                    Token = (string)it["client_access_token"]
                });
            }
            return list;
        }

        // Buat project baru langsung dari Revit -> kembalikan id (UUID) hasil.
        public async Task<string> CreateProjectAsync(string name, string token)
        {
            var payload = new JObject
            {
                ["name"] = name,
                ["client_access_token"] = token
            };
            var res = await PostJsonAsync(_cfg.SupabaseUrl + "/rest/v1/projects",
                payload.ToString(), "return=representation");
            await EnsureOk(res, "Buat project");
            var arr = JArray.Parse(await res.Content.ReadAsStringAsync());
            return arr.Count > 0 ? (string)arr[0]["id"] : null;
        }

        private async Task<string> GetStringAsync(string url)
        {
            var res = await _http.GetAsync(url);
            await EnsureOk(res, "GET");
            return await res.Content.ReadAsStringAsync();
        }

        private Task<HttpResponseMessage> PostJsonAsync(string url, string json, string prefer)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            req.Headers.TryAddWithoutValidation("Prefer", prefer);
            return _http.SendAsync(req);
        }

        private static async Task EnsureOk(HttpResponseMessage res, string what)
        {
            if (!res.IsSuccessStatusCode)
            {
                string body = await res.Content.ReadAsStringAsync();
                throw new Exception(what + " gagal (" + (int)res.StatusCode + "): " + body);
            }
        }

        public void Dispose() { _http.Dispose(); }
    }
}
