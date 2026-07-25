using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace RevitWebViewer
{
    // Upload GLB ke Google Drive TANPA lewat body server app (hindari limit
    // 4.5MB Vercel): minta resumable upload session ke app, lalu PUT byte
    // langsung ke Google.
    public static class DriveUploader
    {
        public static async Task<string> UploadAsync(
            string presentBaseUrl, string serviceKey, string fileName, byte[] glb)
        {
            if (string.IsNullOrWhiteSpace(presentBaseUrl))
                throw new Exception(
                    "Present Base URL belum diisi di Pengaturan.\n" +
                    "Isi alamat website (mis. https://actviewer.vercel.app) — " +
                    "dibutuhkan untuk upload model ke Google Drive.");

            string baseUrl = presentBaseUrl.TrimEnd('/');

            using (var http = new HttpClient())
            {
                http.Timeout = TimeSpan.FromMinutes(15);

                // 1) Minta resumable upload session dari app (auth: service key).
                var reqBody = new JObject { ["fileName"] = fileName }.ToString();
                var createReq = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/api/drive/create-upload")
                {
                    Content = new StringContent(reqBody, Encoding.UTF8, "application/json")
                };
                createReq.Headers.TryAddWithoutValidation("x-service-key", serviceKey);

                var createRes = await http.SendAsync(createReq);
                string createTxt = await createRes.Content.ReadAsStringAsync();
                if (!createRes.IsSuccessStatusCode)
                    throw new Exception("Minta upload session gagal (" + (int)createRes.StatusCode + "): " + createTxt);

                string uploadUri = (string)JObject.Parse(createTxt)["uploadUri"];
                if (string.IsNullOrWhiteSpace(uploadUri))
                    throw new Exception("Upload session URI kosong dari server.");

                // 2) PUT byte GLB langsung ke Google (URI sudah pre-authorized,
                //    JANGAN kirim header auth Supabase ke sini).
                using (var putContent = new ByteArrayContent(glb))
                {
                    putContent.Headers.TryAddWithoutValidation("Content-Type", "model/gltf-binary");
                    var putRes = await http.PutAsync(uploadUri, putContent);
                    string putTxt = await putRes.Content.ReadAsStringAsync();
                    if (!putRes.IsSuccessStatusCode)
                        throw new Exception("Upload GLB ke Drive gagal (" + (int)putRes.StatusCode + "): " + putTxt);

                    string id = (string)JObject.Parse(putTxt)["id"];
                    if (string.IsNullOrWhiteSpace(id))
                        throw new Exception("Drive tidak mengembalikan file id.");
                    return id;
                }
            }
        }
    }
}
