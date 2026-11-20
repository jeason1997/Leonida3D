using System.Collections.Generic;
using UnityEngine;

namespace Leonida
{
    public static class LeonidaMaterials
    {
        static readonly Dictionary<string, Material> Cache = new Dictionary<string, Material>();
        static Material _baseLit;
        static Material _baseWater;
        static Material _baseFacade;
        static Material _baseRoof;

        static Material BaseLit
        {
            get
            {
                if (_baseLit == null) _baseLit = Resources.Load<Material>("URPLit");
                return _baseLit;
            }
        }

        static Material BaseWater
        {
            get
            {
                if (_baseWater == null)
                {
                    _baseWater = Resources.Load<Material>("Water");
                    if (_baseWater == null)
                    {
                        var shader = Shader.Find("Leonida/Water");
                        if (shader != null) _baseWater = new Material(shader);
                        Debug.LogWarning($"Leonida: Water.mat missing, fallback shader={(_baseWater != null ? _baseWater.shader.name : "null")}");
                    }
                }
                return _baseWater;
            }
        }

        static Material BaseFacade
        {
            get
            {
                if (_baseFacade == null)
                {
                    _baseFacade = Resources.Load<Material>("Facade2");
                    if (_baseFacade == null) _baseFacade = Resources.Load<Material>("Facade");
                    if (_baseFacade == null)
                    {
                        var shader = Shader.Find("Leonida/Facade2");
                        if (shader == null) shader = Shader.Find("Leonida/Facade");
                        if (shader != null) _baseFacade = new Material(shader);
                        Debug.LogWarning($"Leonida: Facade2.mat missing, fallback shader={(_baseFacade != null ? _baseFacade.shader.name : "null")}");
                    }
                }
                return _baseFacade;
            }
        }

        static Material BaseRoof
        {
            get
            {
                if (_baseRoof == null) _baseRoof = Resources.Load<Material>("Roof");
                return _baseRoof;
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

        public static Material Detail()
        {
            const string key = "LeonidaDetail";
            if (Cache.TryGetValue(key, out var cached)) return cached;

            var baseDetail = Resources.Load<Material>("Detail");
            Material m;
            if (baseDetail != null)
            {
                m = new Material(baseDetail) { name = key };
            }
            else
            {
                var shader = Shader.Find("Leonida/TerrainVertexColor");
                if (shader != null)
                {
                    m = new Material(shader) { name = key };
                    if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", new Color(0.58f, 0.56f, 0.52f, 1f));
                }
                else
                {
                    m = Lit(key, new Color(0.55f, 0.53f, 0.48f), 0.1f);
                }
            }
            m.enableInstancing = true;
            Cache[key] = m;
            return m;
        }

        public static Material For(string gltfName)
        {
            string n = gltfName ?? string.Empty;
            if (n.StartsWith("Building_Wall"))
                return Facade();
            if (n.StartsWith("Building_Roof"))
                return Roof();
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
                return Water();
            return Lit("Building_Wall", new Color(0.76f, 0.73f, 0.66f), 0.22f);
        }

        static Material Water()
        {
            const string key = "Water";
            if (Cache.TryGetValue(key, out var cached)) return cached;

            Material m;
            if (BaseWater != null)
            {
                m = new Material(BaseWater) { name = key };
            }
            else
            {
                m = Lit(key, new Color(0.05f, 0.24f, 0.34f), 0.92f, 0.15f);
            }
            if (m.HasProperty("_ShallowColor")) m.SetColor("_ShallowColor", new Color(0.13f, 0.60f, 0.66f, 1f));
            if (m.HasProperty("_DeepColor")) m.SetColor("_DeepColor", new Color(0.02f, 0.17f, 0.27f, 1f));
            if (m.HasProperty("_SpecStrength")) m.SetFloat("_SpecStrength", 0.55f);
            if (m.HasProperty("_NormalStrength")) m.SetFloat("_NormalStrength", 0.35f);
            if (m.HasProperty("_WaveScale")) m.SetFloat("_WaveScale", 0.006f);
            m.enableInstancing = true;
            Cache[key] = m;
            return m;
        }

        static Material Facade()
        {
            const string key = "Building_Wall";
            if (Cache.TryGetValue(key, out var cached)) return cached;

            if (BaseFacade == null)
            {
                return Lit(key, new Color(0.76f, 0.73f, 0.66f), 0.22f);
            }

            var m = new Material(BaseFacade) { name = key };
            m.SetFloat("_Night", 0f);
            m.enableInstancing = true;
            Cache[key] = m;
            return m;
        }

        static Material Roof()
        {
            const string key = "Building_Roof";
            if (Cache.TryGetValue(key, out var cached)) return cached;

            if (BaseRoof == null)
            {
                return Lit(key, new Color(0.56f, 0.54f, 0.49f), 0.22f);
            }

            var m = new Material(BaseRoof) { name = key };
            m.enableInstancing = true;
            Cache[key] = m;
            return m;
        }
    }
}
