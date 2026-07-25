using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitWebViewer
{
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

        public async Task<string> InsertModelVersionAsync(int version, string publicUrl, string pushedBy)
        {
            var payload = new JObject
            {
                ["project_id"] = _cfg.ProjectId,
                ["version_number"] = version,
                ["glb_storage_path"] = publicUrl,
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
