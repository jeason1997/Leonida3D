using UnityEditor;

namespace Leonida.EditorTools
{
    public static class LeonidaPipeline
    {
        [MenuItem("Leonida/Build Scene + Windows Player")]
        public static void BuildAll()
        {
            LeonidaBaseMaterials.Create();
            LeonidaSceneBuilder.Build();
            LeonidaPlayerBuilder.BuildWindows();
        }
    }
}
