using System;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Rendering;

namespace Leonida
{
    /// <summary>
    /// Loads manifest + terrain + nearby city chunks at Play, and drives the loading HUD.
    /// Everything is read from Assets/StreamingAssets/leonida (the offline mirror).
    /// </summary>
    public class LeonidaBootstrap : MonoBehaviour
    {
        public Camera cam;
        public Light sun;
        [Range(0, 5)] public int chunkRadius = 2;
        public Vector3 startPosition = new Vector3(150f, 220f, 1700f);
        public Vector3 lookTarget = new Vector3(-2400f, 60f, -300f);

        public string Status { get; private set; } = "starting";
        public bool Ready { get; private set; }
        public LeonidaManifest Manifest { get; private set; }

        string _assetsRoot;
        int _chunksLoaded;
        int _chunksTotal;

        async void Start()
        {
            Application.targetFrameRate = 120;
            try
            {
                await LoadAsync();
            }
            catch (Exception e)
            {
                Status = "ERROR: " + e.Message;
                Debug.LogException(e);
            }
        }

        async Task LoadAsync()
        {
            _assetsRoot = Path.Combine(Application.streamingAssetsPath, "leonida", "assets");
            if (!File.Exists(Path.Combine(_assetsRoot, "manifest.json")))
            {
                // Git checkout: assets are stored once in web/site/assets and synced for builds.
                string alt = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "web", "site", "assets"));
                if (File.Exists(Path.Combine(alt, "manifest.json")))
                {
                    _assetsRoot = alt;
                    Debug.Log($"Leonida: using shared assets from {alt}");
                }
            }
            string manifestPath = Path.Combine(_assetsRoot, "manifest.json");
            if (!File.Exists(manifestPath))
            {
                Status = "manifest missing: " + manifestPath;
                Debug.LogError("Leonida: " + Status);
                return;
            }

            Status = "reading manifest";
            Manifest = JsonUtility.FromJson<LeonidaManifest>(File.ReadAllText(manifestPath));
            if (Manifest == null || Manifest.terrain == null)
            {
                Status = "manifest parse failed";
                return;
            }

            if (cam != null)
            {
                cam.transform.position = startPosition;
                cam.transform.LookAt(lookTarget);
                cam.farClipPlane = 25000f;
                cam.nearClipPlane = 0.3f;
                cam.fieldOfView = 72f;
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.58f, 0.72f, 0.86f);
            }
            if (sun != null)
            {
                sun.transform.rotation = Quaternion.Euler(48f, -35f, 0f);
                sun.color = new Color(1f, 0.96f, 0.88f);
                sun.intensity = 1.35f;
                sun.shadows = LightShadows.Soft;
                sun.shadowStrength = 0.8f;
            }
            QualitySettings.shadowDistance = 3000f;

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.42f, 0.46f, 0.52f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.00007f;
            RenderSettings.fogColor = new Color(0.62f, 0.72f, 0.82f);

            CreateOcean();

            Status = "building terrain";
            await Task.Yield();

            var terrain = gameObject.AddComponent<LeonidaTerrain>();
            terrain.Build(Manifest, _assetsRoot);

            int ci = Mathf.FloorToInt((startPosition.x - Manifest.west) / Manifest.chunk);
            int cj = Mathf.FloorToInt((Manifest.north - (-startPosition.z)) / Manifest.chunk);
            Status = $"loading chunks around {ci}_{cj}";

            var chunks = gameObject.AddComponent<LeonidaChunks>();
            await chunks.LoadAsync(Manifest, _assetsRoot, ci, cj, chunkRadius, (loaded, total, label) =>
            {
                _chunksLoaded = loaded;
                _chunksTotal = total;
                Status = $"loading city {loaded}/{total}  ({label})";
            });

            _chunksLoaded = chunks.Loaded;
            _chunksTotal = chunks.Total;
            Ready = true;
            Status = $"READY  terrain chunks {terrain.ChunkCount}  city tiles {_chunksLoaded}/{_chunksTotal}";
            Debug.Log("Leonida: " + Status);
        }

        void CreateOcean()
        {
            if (GameObject.Find("Ocean") != null) return;
            var go = GameObject.CreatePrimitive(PrimitiveType.Plane);
            go.name = "Ocean";
            go.transform.position = new Vector3(0f, 0.05f, 0f);
            go.transform.localScale = new Vector3(6000f, 1f, 6000f);   // 60 km
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = LeonidaMaterials.For("Water");
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            var collider = go.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
        }

        void OnGUI()
        {
            var style = new GUIStyle(GUI.skin.label)
            {
                fontSize = 15,
                fontStyle = FontStyle.Bold,
                normal = { textColor = Ready ? Color.white : new Color(1f, 0.9f, 0.6f) },
            };
            GUI.Box(new Rect(12, 12, 620, 58), GUIContent.none);
            GUI.Label(new Rect(22, 18, 600, 24), "LEONIDA 3D — Unity native port", style);
            GUI.Label(new Rect(22, 42, 600, 22), Status, style);
            if (Ready)
            {
                GUI.Label(new Rect(12, Screen.height - 34, 900, 22),
                    "WASD move   Q/E down/up   right mouse drag look   Shift boost   Ctrl slow", style);
            }
        }
    }
}
