using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace RevitWebViewer
{
    public class IfcElement
    {
        public string Guid;
        public string Category;
        public string Name;
    }

    // Port dari scripts/lib/ifc-elements.mjs. Ambil {GlobalId, kategori, nama}
    // tiap objek visual dari teks IFC. Kategori = nama family Revit (bagian
    // sebelum ':' di atribut Name IFC).
    public static class IfcElementParser
    {
        // #n = IFC<TYPE> ( '<22-char GlobalId>' , #owner , <Name: '...' atau $>
        private static readonly Regex Re = new Regex(
            @"#\d+\s*=\s*IFC([A-Z0-9]+)\s*\(\s*'([0-9A-Za-z_$]{22})'\s*,\s*#\d+\s*,\s*(\$|'((?:[^'\\]|\\.)*)')",
            RegexOptions.Compiled);

        private static readonly HashSet<string> ExcludeExact = new HashSet<string>
        {
            "PROJECT", "SITE", "BUILDING", "BUILDINGSTOREY",
            "DISTRIBUTIONPORT", "SPACE", "OPENINGELEMENT", "ANNOTATION", "GRID"
        };

        private static bool IsExcluded(string type)
        {
            return type.StartsWith("REL")
                || type.StartsWith("PROPERTY")
                || type.EndsWith("TYPE")
                || type.EndsWith("STYLE")
                || ExcludeExact.Contains(type);
        }

        private static string CategoryFromName(string rawName, string type)
        {
            if (string.IsNullOrEmpty(rawName)) return "IFC" + type;
            int idx = rawName.IndexOf(':');
            string family = (idx >= 0 ? rawName.Substring(0, idx) : rawName).Trim();
            return string.IsNullOrEmpty(family) ? "IFC" + type : family;
        }

        public static List<IfcElement> Parse(string text)
        {
            var seen = new HashSet<string>();
            var rows = new List<IfcElement>();
            foreach (Match m in Re.Matches(text))
            {
                string type = m.Groups[1].Value;
                string guid = m.Groups[2].Value;
                string rawName = m.Groups[4].Success && m.Groups[3].Value != "$" ? m.Groups[4].Value : null;
                if (IsExcluded(type) || seen.Contains(guid)) continue;
                seen.Add(guid);
                rows.Add(new IfcElement
                {
                    Guid = guid,
                    Category = CategoryFromName(rawName, type),
                    Name = rawName
                });
            }
            return rows;
        }
    }
}
