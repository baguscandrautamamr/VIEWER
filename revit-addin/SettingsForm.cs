using System;
using System.Drawing;
using System.Windows.Forms;

namespace RevitWebViewer
{
    // Dialog pengisian konfigurasi add-in. Menggantikan edit manual file JSON:
    // user isi di sini, lalu disimpan ke %AppData%\RevitWebViewer\ oleh
    // pemanggil (SettingsCommand / ExportPushCommand) lewat Result.Save().
    public class SettingsForm : Form
    {
        private readonly TextBox _url = NewText();
        private readonly TextBox _key = NewText();
        private readonly TextBox _project = NewText();
        private readonly TextBox _bucket = NewText();
        private readonly TextBox _ifc = NewText();
        private readonly TextBox _present = NewText();

        // Config hasil isian (valid). Hanya terisi kalau DialogResult == OK.
        public Config Result { get; private set; }

        private static TextBox NewText()
        {
            return new TextBox { Anchor = AnchorStyles.Left | AnchorStyles.Right, Dock = DockStyle.Fill };
        }

        public SettingsForm(Config existing)
        {
            Text = "Revit Web Viewer — Pengaturan";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(580, 430);
            Font = new Font("Segoe UI", 9f);

            _key.UseSystemPasswordChar = true;
            _bucket.Text = "models";

            if (existing != null)
            {
                _url.Text = existing.SupabaseUrl ?? "";
                _key.Text = existing.ServiceRoleKey ?? "";
                _project.Text = existing.ProjectId ?? "";
                _bucket.Text = string.IsNullOrWhiteSpace(existing.Bucket) ? "models" : existing.Bucket;
                _ifc.Text = existing.IfcConvertPath ?? "";
                _present.Text = existing.PresentBaseUrl ?? "";
            }

            var layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                Padding = new Padding(14, 12, 14, 8),
                AutoSize = false
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

            AddRow(layout, "Supabase URL", _url);
            AddRow(layout, "Service Role Key", _key);

            var showKey = new CheckBox { Text = "Tampilkan key", AutoSize = true, Margin = new Padding(0, 0, 0, 6) };
            showKey.CheckedChanged += (s, e) => _key.UseSystemPasswordChar = !showKey.Checked;
            AddRow(layout, "", showKey);

            AddRow(layout, "Project ID", _project);
            AddRow(layout, "Bucket", _bucket);
            AddRow(layout, "IfcConvert.exe", BuildIfcRow());

            AddRow(layout, "Present Base URL", _present);
            AddRow(layout, "", new Label
            {
                Text = "Present Base URL opsional (buat cetak link). Field lain wajib.",
                AutoSize = true,
                ForeColor = SystemColors.GrayText,
                Margin = new Padding(0, 2, 0, 0)
            });

            Controls.Add(layout);
            Controls.Add(BuildButtonBar());
        }

        private Control BuildIfcRow()
        {
            var row = new TableLayoutPanel
            {
                ColumnCount = 2,
                Dock = DockStyle.Fill,
                AutoSize = true,
                Margin = new Padding(0, 3, 0, 3)
            };
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 78));

            var browse = new Button { Text = "Cari…", Width = 72, Anchor = AnchorStyles.Right };
            browse.Click += (s, e) => BrowseIfc();

            row.Controls.Add(_ifc, 0, 0);
            row.Controls.Add(browse, 1, 0);
            return row;
        }

        private void BrowseIfc()
        {
            using (var dlg = new OpenFileDialog
            {
                Title = "Pilih IfcConvert.exe",
                Filter = "IfcConvert.exe|IfcConvert.exe|Executable (*.exe)|*.exe|Semua file (*.*)|*.*",
                CheckFileExists = true
            })
            {
                if (!string.IsNullOrWhiteSpace(_ifc.Text))
                {
                    try { dlg.FileName = _ifc.Text; } catch { /* path tidak valid, abaikan */ }
                }
                if (dlg.ShowDialog(this) == DialogResult.OK)
                    _ifc.Text = dlg.FileName;
            }
        }

        private Control BuildButtonBar()
        {
            var bar = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(14, 8, 14, 12),
                Height = 52,
                AutoSize = false
            };

            var save = new Button { Text = "Simpan", Width = 90, Height = 28 };
            var cancel = new Button { Text = "Batal", Width = 90, Height = 28, DialogResult = DialogResult.Cancel };
            save.Click += (s, e) => OnSave();

            bar.Controls.Add(save);   // RightToLeft -> Simpan paling kanan
            bar.Controls.Add(cancel);

            AcceptButton = save;
            CancelButton = cancel;
            return bar;
        }

        private void OnSave()
        {
            var cfg = new Config
            {
                SupabaseUrl = _url.Text.Trim(),
                ServiceRoleKey = _key.Text.Trim(),
                ProjectId = _project.Text.Trim(),
                Bucket = _bucket.Text.Trim(),
                IfcConvertPath = _ifc.Text.Trim(),
                PresentBaseUrl = _present.Text.Trim()
            };

            try { cfg.Validate(); }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Belum lengkap",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return; // form tetap terbuka biar bisa dibenerin
            }

            cfg.Normalize();
            Result = cfg;
            DialogResult = DialogResult.OK;
            Close();
        }

        private static void AddRow(TableLayoutPanel layout, string label, Control field)
        {
            int row = layout.RowCount;
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            var lbl = new Label
            {
                Text = label,
                AutoSize = false,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                Margin = new Padding(0, 6, 8, 0)
            };
            field.Margin = new Padding(field.Margin.Left, 3, field.Margin.Right, 3);

            layout.Controls.Add(lbl, 0, row);
            layout.Controls.Add(field, 1, row);
            layout.RowCount = row + 1;
        }

        // Buka dialog, dan kalau user Simpan -> tulis config ke disk.
        // Return true kalau tersimpan. Dipakai dari command supaya alurnya seragam.
        public static bool Edit(Config existing)
        {
            using (var form = new SettingsForm(existing))
            {
                if (form.ShowDialog() != DialogResult.OK) return false;
                form.Result.Save();
                return true;
            }
        }
    }
}
