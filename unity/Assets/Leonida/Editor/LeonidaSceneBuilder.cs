using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Leonida.EditorTools
{
    public static class LeonidaSceneBuilder
    {
        const string ScenePath = "Assets/Scenes/Leonida.unity";

        [MenuItem("Leonida/Build Scene")]
        public static void Build()
        {
            Directory.CreateDirectory("Assets/Scenes");

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            camGo.AddComponent<AudioListener>();
            cam.nearClipPlane = 0.3f;
            cam.farClipPlane = 25000f;
            cam.fieldOfView = 72f;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.58f, 0.72f, 0.86f);
            camGo.AddComponent<FlyCamera>();

            var sunGo = new GameObject("Sun");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.96f, 0.88f);
            sun.intensity = 1.25f;
            sun.shadows = LightShadows.None;
            sunGo.transform.rotation = Quaternion.Euler(48f, -35f, 0f);

            var worldGo = new GameObject("LeonidaWorld");
            var boot = worldGo.AddComponent<LeonidaBootstrap>();
            boot.cam = cam;
            boot.sun = sun;
            boot.chunkRadius = 2;
            worldGo.AddComponent<LeonidaScreenshot>();

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.46f, 0.50f, 0.55f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.00007f;
            RenderSettings.fogColor = new Color(0.62f, 0.72f, 0.82f);
            RenderSettings.skybox = null;

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            PlayerSettings.productName = "Leonida 3D";
            PlayerSettings.companyName = "Leonida Offline";
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.defaultScreenWidth = 1600;
            PlayerSettings.defaultScreenHeight = 900;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.resizableWindow = true;

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("LEONIDA_SCENE_OK " + ScenePath);
        }
    }
}
