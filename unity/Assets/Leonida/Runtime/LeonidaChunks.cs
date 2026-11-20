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
                        MirrorX(chunkGo);
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

        // glTFast converts glTF's right-handed X to Unity's left-handed space by mirroring X.
        // The city GLBs are authored in the map frame (x east, z = -north), so mirror the baked
        // meshes back and flip the triangle winding to keep front faces outside.
        void MirrorX(GameObject root)
        {
            var filters = root.GetComponentsInChildren<MeshFilter>(true);
            foreach (var filter in filters)
            {
                var source = filter.sharedMesh;
                if (source == null) continue;

                var mesh = Instantiate(source);
                mesh.name = source.name + "_map";

                var vertices = mesh.vertices;
                for (int i = 0; i < vertices.Length; i++) vertices[i].x = -vertices[i].x;
                mesh.vertices = vertices;

                var normals = mesh.normals;
                if (normals != null && normals.Length == vertices.Length)
                {
                    for (int i = 0; i < normals.Length; i++) normals[i].x = -normals[i].x;
                    mesh.normals = normals;
                }

                var tangents = mesh.tangents;
                if (tangents != null && tangents.Length == vertices.Length)
                {
                    for (int i = 0; i < tangents.Length; i++) tangents[i].x = -tangents[i].x;
                    mesh.tangents = tangents;
                }

                var triangles = mesh.triangles;
                for (int i = 0; i + 2 < triangles.Length; i += 3)
                {
                    int tmp = triangles[i];
                    triangles[i] = triangles[i + 1];
                    triangles[i + 1] = tmp;
                }
                mesh.triangles = triangles;
                mesh.RecalculateBounds();
                filter.sharedMesh = mesh;
            }
        }

        void ApplyMaterials(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<MeshRenderer>(true);
            foreach (var r in renderers)
            {
                var filter = r.GetComponent<MeshFilter>();
                string meshName = filter != null && filter.sharedMesh != null ? filter.sharedMesh.name : string.Empty;

                var materials = r.sharedMaterials;
                bool building = false;
                if (materials == null || materials.Length == 0)
                {
                    r.sharedMaterial = Resolve(meshName, 0, string.Empty);
                    building = true;
                }
                else
                {
                    // glTFast rewrites material names, so use the stable mesh/primitive layout instead:
                    // Buildings/Filler [wall, roof], Roads [highway, road, dirt],
                    // RoadSides [sidewalk, kerb, concrete, barrier, pier], Water/OpenSea [water].
                    for (int i = 0; i < materials.Length; i++)
                    {
                        string original = materials[i] != null ? materials[i].name : string.Empty;
                        materials[i] = Resolve(meshName, i, original);
                        if (meshName.StartsWith("Buildings") || meshName.StartsWith("Filler")) building = true;
                    }
                    r.sharedMaterials = materials;
                }
                r.shadowCastingMode = building ? ShadowCastingMode.On : ShadowCastingMode.Off;
                r.receiveShadows = true;
                r.lightProbeUsage = LightProbeUsage.Off;
                r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            }
        }

        static Material Resolve(string meshName, int slot, string originalName)
        {
            if (meshName.StartsWith("Water") || meshName.StartsWith("OpenSea"))
                return LeonidaMaterials.For("Water");

            if (meshName.StartsWith("Buildings") || meshName.StartsWith("Filler"))
                return LeonidaMaterials.For(slot == 0 ? "Building_Wall" : "Building_Roof");

            if (meshName.StartsWith("Roads"))
            {
                if (slot == 0) return LeonidaMaterials.For("Road_highway");
                if (slot == 1) return LeonidaMaterials.For("Road_road");
                return LeonidaMaterials.For("Road_dirt");
            }

            if (meshName.StartsWith("RoadSides"))
            {
                switch (slot)
                {
                    case 0: return LeonidaMaterials.For("RS_Sidewalk");
                    case 1: return LeonidaMaterials.For("RS_Kerb");
                    case 2: return LeonidaMaterials.For("RS_Concrete");
                    case 3: return LeonidaMaterials.For("RS_Barrier");
                    default: return LeonidaMaterials.For("RS_Pier");
                }
            }

            return LeonidaMaterials.For(originalName);
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
