using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace RevitWebViewer
{
    // Dialog pilih project dari daftar yang sudah ada di Supabase.
    public class ProjectPickerForm : Form
    {
        private readonly ListBox _list = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false };

        public ProjectRow Selected { get; private set; }

        public ProjectPickerForm(List<ProjectRow> rows)
        {
            Text = "Pilih Project";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(540, 320);
            Font = new Font("Segoe UI", 9f);

            foreach (var r in rows) _list.Items.Add(r);
            if (_list.Items.Count > 0) _list.SelectedIndex = 0;
            _list.DoubleClick += (s, e) => Accept();

            var ok = new Button { Text = "Pilih", Width = 90, Height = 28 };
            var cancel = new Button { Text = "Batal", Width = 90, Height = 28, DialogResult = DialogResult.Cancel };
            ok.Click += (s, e) => Accept();

            var bar = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(12, 8, 12, 12),
                Height = 52
            };
            bar.Controls.Add(ok);
            bar.Controls.Add(cancel);

            var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12, 12, 12, 0) };
            panel.Controls.Add(_list);

            Controls.Add(panel);
            Controls.Add(bar);
            AcceptButton = ok;
            CancelButton = cancel;
        }

        private void Accept()
        {
            if (_list.SelectedItem == null) return;
            Selected = (ProjectRow)_list.SelectedItem;
            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
