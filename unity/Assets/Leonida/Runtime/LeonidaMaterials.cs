using System.Collections.Generic;
using UnityEngine;

namespace Leonida
{
    public static class LeonidaMaterials
    {
        static readonly Dictionary<string, Material> Cache = new Dictionary<string, Material>();
        static Material _baseLit;

        static Material BaseLit
        {
            get
            {
                if (_baseLit == null) _baseLit = Resources.Load<Material>("URPLit");
                return _baseLit;
            }
        }

        static Material Lit(string key, Color color, float smoothness, float metallic = 0f)
        {
            if (Cache.TryGetValue(key, out var cached)) return cached;

            Material m;
            if (BaseLit != null)
            {
                m = new Material(BaseLit) { name = key };
            }
            else
            {
                var shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null)
                {
                    Debug.LogError("Leonida: URP Lit shader not found (Resources/URPLit.mat missing)");
                    shader = Shader.Find("Standard");
                }
                m = new Material(shader) { name = key };
            }

            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);
            if (m.HasProperty("_Color")) m.SetColor("_Color", color);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
            m.enableInstancing = true;
            Cache[key] = m;
            return m;
        }

        public static Material Terrain()
        {
            const string key = "LeonidaTerrain";
            if (Cache.TryGetValue(key, out var cached)) return cached;

            // First pass: plain URP Lit ground so it receives the sun and building shadows.
            // The site's vertex-coloured terrain shader can replace this later.
            var m = Lit(key, new Color(0.33f, 0.39f, 0.25f), 0.08f);
            Cache[key] = m;
            return m;
        }

        public static Material For(string gltfName)
        {
            string n = gltfName ?? string.Empty;
            if (n.StartsWith("Building_Wall"))
                return Lit("Building_Wall", new Color(0.76f, 0.73f, 0.66f), 0.22f);
            if (n.StartsWith("Building_Roof"))
                return Lit("Building_Roof", new Color(0.31f, 0.31f, 0.30f), 0.18f);
            if (n.StartsWith("Road_highway"))
                return Lit("Road_highway", new Color(0.10f, 0.10f, 0.11f), 0.25f);
            if (n.StartsWith("Road_dirt"))
                return Lit("Road_dirt", new Color(0.40f, 0.31f, 0.20f), 0.12f);
            if (n.StartsWith("Road_"))
                return Lit("Road_road", new Color(0.14f, 0.14f, 0.15f), 0.22f);
            if (n.StartsWith("RS_Sidewalk"))
                return Lit("RS_Sidewalk", new Color(0.60f, 0.58f, 0.53f), 0.16f);
            if (n.StartsWith("RS_Kerb"))
                return Lit("RS_Kerb", new Color(0.68f, 0.66f, 0.60f), 0.16f);
            if (n.StartsWith("RS_Concrete"))
                return Lit("RS_Concrete", new Color(0.50f, 0.49f, 0.45f), 0.12f);
            if (n.StartsWith("RS_Barrier"))
                return Lit("RS_Barrier", new Color(0.58f, 0.57f, 0.52f), 0.12f);
            if (n.StartsWith("RS_Pier"))
                return Lit("RS_Pier", new Color(0.42f, 0.35f, 0.28f), 0.10f);
            if (n.StartsWith("Water"))
                return Lit("Water", new Color(0.05f, 0.24f, 0.34f), 0.92f, 0.15f);
            return Lit("Building_Wall", new Color(0.76f, 0.73f, 0.66f), 0.22f);
        }
    }
}
