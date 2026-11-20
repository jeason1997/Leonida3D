using UnityEditor;
using UnityEngine;

namespace Leonida.EditorTools
{
    public static class LeonidaEnvironmentAssets
    {
        [MenuItem("Leonida/Create Environment Materials")]
        public static void Create()
        {
            System.IO.Directory.CreateDirectory("Assets/Leonida/Resources");
            FixTexture("Assets/Leonida/Resources/AOAtlas.png", false);

            var skyShader = Shader.Find("Leonida/Sky");
            if (skyShader != null && AssetDatabase.LoadAssetAtPath<Material>("Assets/Leonida/Resources/LeonidaSky.mat") == null)
            {
                var m = new Material(skyShader) { name = "LeonidaSky" };
                AssetDatabase.CreateAsset(m, "Assets/Leonida/Resources/LeonidaSky.mat");
            }
            else if (skyShader == null)
            {
                Debug.LogError("LEONIDA_ENV sky shader missing");
            }

            // Built-in procedural skybox as a guaranteed fallback/primary sky.
            var proc = Shader.Find("Skybox/Procedural");
            if (proc != null && AssetDatabase.LoadAssetAtPath<Material>("Assets/Leonida/Resources/ProceduralSky.mat") == null)
            {
                var m = new Material(proc) { name = "ProceduralSky" };
                m.SetFloat("_AtmosphereThickness", 0.72f);
                m.SetColor("_SkyTint", new Color(0.42f, 0.58f, 0.82f));
                m.SetColor("_GroundColor", new Color(0.42f, 0.42f, 0.38f));
                m.SetFloat("_Exposure", 1.25f);
                m.SetFloat("_SunSize", 0.035f);
                m.SetFloat("_SunSizeConvergence", 5f);
                m.SetFloat("_SunDisk", 2f);
                AssetDatabase.CreateAsset(m, "Assets/Leonida/Resources/ProceduralSky.mat");
            }

            var waterShader = Shader.Find("Leonida/Water");
            if (waterShader != null && AssetDatabase.LoadAssetAtPath<Material>("Assets/Leonida/Resources/Water.mat") == null)
            {
                var m = new Material(waterShader) { name = "Water" };
                var normal = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Leonida/Resources/WaterNormal.png");
                if (normal != null) m.SetTexture("_NormalMap", normal);
                AssetDatabase.CreateAsset(m, "Assets/Leonida/Resources/Water.mat");
            }
            else if (waterShader == null)
            {
                Debug.LogError("LEONIDA_ENV water shader missing");
            }

            var facadeShader = Shader.Find("Leonida/Facade");
            if (facadeShader != null && AssetDatabase.LoadAssetAtPath<Material>("Assets/Leonida/Resources/Facade.mat") == null)
            {
                var m = new Material(facadeShader) { name = "Facade" };
                m.SetFloat("_Night", 0f);
                AssetDatabase.CreateAsset(m, "Assets/Leonida/Resources/Facade.mat");
            }
            else if (facadeShader == null)
            {
                Debug.LogError("LEONIDA_ENV facade shader missing");
            }

            var roofShader = Shader.Find("Leonida/Roof");
            if (roofShader != null && AssetDatabase.LoadAssetAtPath<Material>("Assets/Leonida/Resources/Roof.mat") == null)
            {
                var m = new Material(roofShader) { name = "Roof" };
                AssetDatabase.CreateAsset(m, "Assets/Leonida/Resources/Roof.mat");
            }
            else if (roofShader == null)
            {
                Debug.LogError("LEONIDA_ENV roof shader missing");
            }

            var detailShader = Shader.Find("Leonida/Detail");
            if (detailShader != null && AssetDatabase.LoadAssetAtPath<Material>("Assets/Leonida/Resources/Detail.mat") == null)
            {
                var m = new Material(detailShader) { name = "Detail" };
                AssetDatabase.CreateAsset(m, "Assets/Leonida/Resources/Detail.mat");
            }
            else if (detailShader == null)
            {
                Debug.LogError("LEONIDA_ENV detail shader missing");
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("LEONIDA_ENV_OK");
        }

        static void FixTexture(string path, bool sRGB)
        {
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null) return;
            importer.sRGBTexture = sRGB;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.maxTextureSize = 2048;
            importer.SaveAndReimport();
        }
    }
}
