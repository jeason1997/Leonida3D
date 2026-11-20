using UnityEngine;

namespace Leonida
{
    /// <summary>Exposes the original height16 terrain map to the water shader for depth/shore foam.</summary>
    public static class LeonidaWater
    {
        public static void Configure(LeonidaManifest m)
        {
            var tex = Resources.Load<Texture2D>("Height16");
            if (tex == null)
            {
                Debug.LogWarning("Leonida: Height16.png missing");
                return;
            }
            Shader.SetGlobalTexture("_HeightTex", tex);
            Shader.SetGlobalVector("_HMap", new Vector4(
                m.west, m.north,
                (m.terrain.height16.w - 1) * m.terrain.height16.cell,
                (m.terrain.height16.h - 1) * m.terrain.height16.cell));
        }
    }
}
