using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;
using UnityEngine.Rendering;

namespace Leonida
{
    /// <summary>
    /// Streams the exported city chunks (GLB) around a centre chunk via glTFast.
    /// Chunk GLB vertices already use the map's three.js frame: x east, y up, z = -north.
    /// </summary>
    public class LeonidaChunks : MonoBehaviour
    {
        public int Loaded { get; private set; }
        public int Total { get; private set; }
        public string LastError { get; private set; }

        readonly List<GltfImport> _imports = new List<GltfImport>();

        public async Task LoadAsync(LeonidaManifest m, string assetsRoot, int centerI, int centerJ,
                                    int radius, Action<int, int, string> progress)
        {
            var keys = new List<Vector2Int>();
            for (int dj = -radius; dj <= radius; dj++)
            {
                for (int di = -radius; di <= radius; di++)
                {
                    int i = centerI + di;
                    int j = centerJ + dj;
                    if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) continue;
                    keys.Add(new Vector2Int(i, j));
                }
            }
            keys.Sort((a, b) =>
            {
                int da = (a.x - centerI) * (a.x - centerI) + (a.y - centerJ) * (a.y - centerJ);
                int db = (b.x - centerI) * (b.x - centerI) + (b.y - centerJ) * (b.y - centerJ);
                return da.CompareTo(db);
            });

            Total = keys.Count;
            Loaded = 0;

            foreach (var key in keys)
            {
                string rel = $"chunks/chunk_{key.x}_{key.y}.glb";
                string path = Path.Combine(assetsRoot, rel.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(path))
                {
                    Loaded++;
                    continue;
                }

                string label = $"{key.x}_{key.y}";
                try
                {
                    var gltf = new GltfImport();
                    bool ok = await gltf.LoadFile(path);
                    if (!ok)
                    {
                        LastError = $"glTF load failed: {label}";
                        Debug.LogWarning($"Leonida: {LastError}");
                        Loaded++;
                        progress?.Invoke(Loaded, Total, label);
                        continue;
                    }

                    var chunkGo = new GameObject($"chunk_{label}");
                    chunkGo.transform.SetParent(transform, false);
                    var instantiator = new GameObjectInstantiator(gltf, chunkGo.transform);
                    bool instantiated = await gltf.InstantiateMainSceneAsync(instantiator);
                    if (!instantiated)
                    {
                        LastError = $"glTF instantiate failed: {label}";
                        Debug.LogWarning($"Leonida: {LastError}");
                    }
                    else
                    {
                        ApplyMaterials(chunkGo);
                        _imports.Add(gltf);
                    }
                }
                catch (Exception e)
                {
                    LastError = $"{label}: {e.Message}";
                    Debug.LogError($"Leonida chunk {label} failed: {e}");
                }

                Loaded++;
                progress?.Invoke(Loaded, Total, label);
                await Task.Yield();
            }
        }

        void ApplyMaterials(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<MeshRenderer>(true);
            foreach (var r in renderers)
            {
                var materials = r.sharedMaterials;
                bool building = false;
                if (materials == null || materials.Length == 0)
                {
                    r.sharedMaterial = LeonidaMaterials.For(string.Empty);
                    building = true;
                }
                else
                {
                    // A chunk mesh has one submesh per glTF primitive; replace every slot,
                    // otherwise the untouched slots keep glTFast's build-stripped shader (pink).
                    for (int i = 0; i < materials.Length; i++)
                    {
                        string name = materials[i] != null ? materials[i].name : string.Empty;
                        if (name.StartsWith("Building_")) building = true;
                        materials[i] = LeonidaMaterials.For(name);
                    }
                    r.sharedMaterials = materials;
                }
                r.shadowCastingMode = building ? ShadowCastingMode.On : ShadowCastingMode.Off;
                r.receiveShadows = true;
                r.lightProbeUsage = LightProbeUsage.Off;
                r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            }
        }

        void OnDestroy()
        {
            foreach (var gltf in _imports)
            {
                gltf?.Dispose();
            }
            _imports.Clear();
        }
    }
}
