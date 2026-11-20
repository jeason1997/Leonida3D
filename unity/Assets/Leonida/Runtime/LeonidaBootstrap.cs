using System;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

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
        public Vector3 startPosition = new Vector3(150f, 420f, 1700f);
        public Vector3 lookTarget = new Vector3(-2400f, 30f, 0f);

        public string Status { get; private set; } = "starting";
        public bool Ready { get; private set; }
        public LeonidaManifest Manifest { get; private set; }

        string _assetsRoot;
        int _chunksLoaded;
        int _chunksTotal;
        bool _cleanMode;

        void Awake()
        {
            _cleanMode = Array.IndexOf(Environment.GetCommandLineArgs(), "-clean") >= 0;
            bool autoStart = Array.IndexOf(Environment.GetCommandLineArgs(), "-autostart") >= 0;
            if (!_cleanMode && !autoStart)
            {
                var menu = gameObject.AddComponent<LeonidaStartMenu>();
                menu.Init(this);
            }
        }
        LeonidaVegetation _veg;
        LeonidaMapUI _mapUi;

        async void Start()
        {
            Application.targetFrameRate = 60;
            QualitySettings.vSyncCount = 1;
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
            ApplyCommandLineCamera();

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
                cam.clearFlags = RenderSettings.skybox != null ? CameraClearFlags.Skybox : CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.58f, 0.72f, 0.86f);
            }
            if (sun != null)
            {
                sun.transform.rotation = Quaternion.Euler(48f, -35f, 0f);
                sun.color = new Color(1f, 0.96f, 0.88f);
                sun.intensity = 1.6f;
                sun.shadows = LightShadows.Soft;
                sun.shadowStrength = 0.8f;
            }
            QualitySettings.shadowDistance = 600f;
            QualitySettings.shadowCascades = 2;

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.55f, 0.58f, 0.62f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.00007f;
            RenderSettings.fogColor = new Color(0.62f, 0.72f, 0.82f);

            var environment = GetComponent<LeonidaEnvironment>();
            if (environment != null) environment.Init(cam, sun);

            LeonidaAO.Configure(Manifest);
            LeonidaWater.Configure(Manifest);
            CreateOcean();
            SetupPostProcessing();

            Status = "building terrain";
            await Task.Yield();

            int ci = Mathf.FloorToInt((startPosition.x - Manifest.west) / Manifest.chunk);
            int cj = Mathf.FloorToInt((Manifest.north - (-startPosition.z)) / Manifest.chunk);

            var terrain = gameObject.AddComponent<LeonidaTerrain>();
            terrain.Build(Manifest, _assetsRoot);
            terrain.BuildNear(Manifest, _assetsRoot, ci, cj, 2);
            var modes = cam.gameObject.AddComponent<LeonidaPlayerModes>();
            modes.Init(cam, terrain, Manifest);

            var admin = gameObject.AddComponent<LeonidaAdminPanel>();
            admin.Init(cam, Manifest, modes);
            if (Array.IndexOf(Environment.GetCommandLineArgs(), "-admin") >= 0) admin.SetOpen(true);

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

            Status = "loading roof details";
            string detailStatus = "details off";
            try
            {
                var details = gameObject.AddComponent<LeonidaDetails>();
                await details.LoadAsync(Manifest, _assetsRoot, ci, cj, 3,
                    (done, total, key) => Status = $"loading roof details {done}/{total}  ({key})");
                detailStatus = $"details {details.LoadedChunks} chunks / {details.VertexCount} verts";
            }
            catch (Exception e)
            {
                Debug.LogError("Leonida: roof details failed: " + e);
                detailStatus = "details failed";
            }

            Status = "loading vegetation";
            string vegStatus = "veg off";
            try
            {
                _veg = gameObject.AddComponent<LeonidaVegetation>();
                _veg.cam = cam;
                _veg.treeRadius = 1200;
                _veg.shrubRadius = 500;
                _veg.grassRadius = 200;
                await _veg.Init(Manifest, _assetsRoot,
                    (done, total, name) => Status = $"loading vegetation {done}/{total}  ({name})");
                vegStatus = $"veg t{_veg.TreeInstances} s{_veg.ShrubInstances} g{_veg.GrassInstances}  vegchunks {_veg.LoadedChunks}";
            }
            catch (Exception e)
            {
                // Vegetation is optional: the map and city must still come up without it.
                Debug.LogError("Leonida: vegetation failed: " + e);
                vegStatus = "veg failed";
                _veg = null;
            }

            Ready = true;
            Status = $"READY  terrain chunks {terrain.ChunkCount}  city tiles {_chunksLoaded}/{_chunksTotal}  {detailStatus}  {vegStatus}";
            Debug.Log("Leonida: " + Status);

            var mapUi = gameObject.AddComponent<LeonidaMapUI>();
            mapUi.Init(cam, Manifest);
            mapUi.Hidden = _cleanMode;
            if (System.Array.IndexOf(System.Environment.GetCommandLineArgs(), "-map") >= 0)
                mapUi.SetOpen(true);
        }

        void SetupPostProcessing()
        {
            if (cam == null) return;
            cam.allowHDR = true;
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;

            var go = new GameObject("PostVolume");
            var volume = go.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 10f;
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();

            var tone = profile.Add<Tonemapping>(true);
            tone.mode.Override(TonemappingMode.ACES);

            var color = profile.Add<ColorAdjustments>(true);
            color.contrast.Override(10f);
            color.saturation.Override(6f);
            color.postExposure.Override(0.15f);

            var bloom = profile.Add<Bloom>(true);
            bloom.intensity.Override(0.15f);
            bloom.threshold.Override(1.05f);
            bloom.scatter.Override(0.65f);

            volume.profile = profile;
        }

        void ApplyCommandLineCamera()
        {
            var args = Environment.GetCommandLineArgs();
            float Arg(string name, float fallback)
            {
                int i = Array.IndexOf(args, name);
                if (i >= 0 && i + 1 < args.Length &&
                    float.TryParse(args[i + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out float v))
                    return v;
                return fallback;
            }

            if (Array.IndexOf(args, "-camx") >= 0 || Array.IndexOf(args, "-camy") >= 0 || Array.IndexOf(args, "-camz") >= 0)
                startPosition = new Vector3(Arg("-camx", startPosition.x), Arg("-camy", startPosition.y), Arg("-camz", startPosition.z));
            if (Array.IndexOf(args, "-lookx") >= 0 || Array.IndexOf(args, "-looky") >= 0 || Array.IndexOf(args, "-lookz") >= 0)
                lookTarget = new Vector3(Arg("-lookx", lookTarget.x), Arg("-looky", lookTarget.y), Arg("-lookz", lookTarget.z));
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

        GUIStyle _hudStyle;
        float _fps;

        void OnGUI()
        {
            if (_cleanMode || LeonidaStartMenu.InputLocked || (_mapUi != null && _mapUi.IsOpen)) return;
            if (_hudStyle == null)
            {
                _hudStyle = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 15,
                    fontStyle = FontStyle.Bold,
                };
            }
            _hudStyle.normal.textColor = Ready ? Color.white : new Color(1f, 0.9f, 0.6f);
            _fps = Mathf.Lerp(_fps <= 0f ? 60f : _fps, 1f / Mathf.Max(0.0001f, Time.smoothDeltaTime), 0.08f);
            var style = _hudStyle;
            GUI.Box(new Rect(12, 12, 920, 86), GUIContent.none);
            GUI.Label(new Rect(22, 18, 900, 24), "LEONIDA 3D / Unity native port", style);
            GUI.Label(new Rect(22, 42, 900, 22), Status, style);
            GUI.Label(new Rect(Screen.width - 170f, 18f, 150f, 24f), $"FPS {_fps:F0}", style);
            if (_veg != null)
            {
                GUI.Label(new Rect(22, 66, 900, 22),
                    $"veg  t{_veg.TreeInstances}  s{_veg.ShrubInstances}  g{_veg.GrassInstances}   chunks {_veg.LoadedChunks}  variants {_veg.LoadedVariants}",
                    style);
            }
            if (Ready)
            {
                GUI.Label(new Rect(12, Screen.height - 34, 900, 22),
                    "WASD move   Q/E height   click: mouse   Shift boost   F1-F4 modes   M map   F8 admin", style);
            }
        }
    }
}
