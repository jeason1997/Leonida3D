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

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("LEONIDA_ENV_OK");
        }
    }
}
