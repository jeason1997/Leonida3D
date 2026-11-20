using UnityEngine;

namespace Leonida
{
    /// <summary>Whole-map AO atlas built from the web build's ao_*.webp tiles.</summary>
    public static class LeonidaAO
    {
        public static void Configure(LeonidaManifest m)
        {
            var tex = Resources.Load<Texture2D>("AOAtlas");
            if (tex == null)
            {
                Debug.LogWarning("Leonida: AOAtlas.png missing");
                return;
            }
            int i0 = int.MaxValue, i1 = int.MinValue, j0 = int.MaxValue, j1 = int.MinValue;
            int n = 0;
            foreach (string key in m.ao)
            {
                string[] p = key.Split('_');
                if (p.Length != 2 || !int.TryParse(p[0], out int i) || !int.TryParse(p[1], out int j)) continue;
                i0 = Mathf.Min(i0, i); i1 = Mathf.Max(i1, i);
                j0 = Mathf.Min(j0, j); j1 = Mathf.Max(j1, j);
                n++;
            }
            if (n == 0) return;
            Shader.SetGlobalTexture("_AOTex", tex);
            Shader.SetGlobalVector("_AORect", new Vector4(
                m.west + i0 * m.chunk,
                m.north - (j1 + 1) * m.chunk,
                (i1 - i0 + 1) * m.chunk,
                (j1 - j0 + 1) * m.chunk));
        }
    }
}
