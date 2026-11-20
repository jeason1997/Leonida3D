using System.IO;
using UnityEditor;
using UnityEngine;

namespace Leonida.EditorTools
{
    public static class LeonidaBaseMaterials
    {
        [MenuItem("Leonida/Create Base Materials")]
        public static void Create()
        {
            Directory.CreateDirectory("Assets/Leonida/Resources");

            var urp = Shader.Find("Universal Render Pipeline/Lit");
            if (urp == null)
            {
                Debug.LogError("LEONIDA_MAT urp lit shader missing");
            }
            else if (AssetDatabase.LoadAssetAtPath<Material>("Assets/Leonida/Resources/URPLit.mat") == null)
            {
                var m = new Material(urp) { name = "URPLit" };
                AssetDatabase.CreateAsset(m, "Assets/Leonida/Resources/URPLit.mat");
            }

            var terrain = Shader.Find("Leonida/TerrainVertexColor");
            if (terrain == null)
            {
                Debug.LogError("LEONIDA_MAT terrain shader missing");
            }
            else if (AssetDatabase.LoadAssetAtPath<Material>("Assets/Leonida/Resources/LeonidaTerrain.mat") == null)
            {
                var m = new Material(terrain) { name = "LeonidaTerrain" };
                AssetDatabase.CreateAsset(m, "Assets/Leonida/Resources/LeonidaTerrain.mat");
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("LEONIDA_MAT_OK");
        }
    }
}
