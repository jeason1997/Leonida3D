using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;
using UnityEngine.Rendering;

namespace Leonida
{
    /// <summary>
    /// Native port of the web viewer's vegetation system (Reference/js/vegetation.js).
    ///
    /// Instances come from veg/inst_&lt;i&gt;_&lt;j&gt;.bin: 8-byte records grouped by variant, in the
    /// order of veg.variants. Each variant GLB is loaded once through glTFast and its primitives are
    /// baked into standalone meshes (node transforms applied) so they can be drawn with
    /// Graphics.DrawMeshInstanced. Instances are re-picked (nearest chunks first, within the per-kind
    /// radii) whenever the camera moved more than 25 m or a new chunk finished loading.
    ///
    /// Map frame matches the generated city/terrain: x east, y up, z = -north.
    /// </summary>
    public class LeonidaVegetation : MonoBehaviour
    {
        public int treeRadius = 350;
        public int shrubRadius = 180;
        public int grassRadius = 70;
        public int farRadius = 2000;

        public int maxTrees = 6000;
        public int maxShrubs = 8000;
        public int maxGrass = 15000;

        public Camera cam;

        /// <summary>
        /// glTF UVs have v = 0 at the top of the image; Unity textures loaded with
        /// Texture2D.LoadImage have v = 0 at the bottom. Flip V when baking so the URP Lit
        /// materials sample the cards the same way the web viewer does.
        /// </summary>
        public bool flipTextureV = true;

        public int LoadedChunks { get; private set; }
        public int LoadedVariants { get; private set; }
        public int TreeInstances { get; private set; }
        public int ShrubInstances { get; private set; }
        public int GrassInstances { get; private set; }
        public string LastError { get; private set; }

        const int RecordSize = 8;
        const int InstancesPerBatch = 1023;
        const float MoveThreshold = 25f;
        const float InitialChunkWait = 8f;
        const string BaseMaterialResource = "URPLit";

        enum VegKind
        {
            Tree,
            Shrub,
            Grass,
        }

        // Exactly the 8 bytes the exporter wrote, kept verbatim to keep chunk memory small.
        struct VegRecord
        {
            public ushort u;      // x fraction of chunk (0..65535)
            public ushort v;      // north fraction of chunk (0..65535, from the north edge)
            public short h;       // height in cm
            public byte yaw;      // yaw, 256 steps per turn
            public byte scale;    // scale in 1/100
        }

        sealed class VegPart
        {
            public Mesh mesh;
            public Material material;
            public bool castShadows;
            public readonly List<Matrix4x4[]> batches = new List<Matrix4x4[]>();
            public readonly List<int> counts = new List<int>();
            public int total;

            public void Reset()
            {
                for (int i = 0; i < counts.Count; i++) counts[i] = 0;
                total = 0;
            }

            public void Add(Matrix4x4 matrix)
            {
                int index = total;
                int batch = index / InstancesPerBatch;
                if (batch == batches.Count)
                {
                    batches.Add(new Matrix4x4[InstancesPerBatch]);
                    counts.Add(0);
                }
                batches[batch][index % InstancesPerBatch] = matrix;
                counts[batch] = counts[batch] + 1;
                total++;
            }
        }

        sealed class VegVariant
        {
            public string name;
            public string kind;
            public int manifestIndex;
            public VegKind type;
            public int quota;
            public int count;
            public readonly List<VegPart> parts = new List<VegPart>();

            public void Reset()
            {
                count = 0;
                for (int i = 0; i < parts.Count; i++) parts[i].Reset();
            }

            public void Add(Matrix4x4 matrix)
            {
                count++;
                for (int i = 0; i < parts.Count; i++) parts[i].Add(matrix);
            }
        }

        sealed class VegChunk
        {
            public string key;
            public int i;
            public int j;
            public Vector3 centre;
            public float x0;
            public float northEdge;
            public VegRecord[] records;
            public int[] varStart;
            public int[] varCount;
        }

        sealed class ChunkMeta
        {
            public string key;
            public int i;
            public int j;
            public int[] counts;
            public Vector3 centre;
        }

        static readonly Dictionary<string, string> SourceTexture = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "VEG_Frond", "frond.png" },
            { "VEG_Needles", "needles.png" },
            { "VEG_Leaves", "leaves.png" },
            { "VEG_Grass", "grass.png" },
            { "VEG_GrassDry", "grass_dry.png" },
            { "VEG_Sawgrass", "grass.png" },
            { "VEG_PalmTrunk", "palm_trunk.png" },
            { "VEG_SabalTrunk", "bark.png" },
            { "VEG_Bark", "bark.png" },
        };

        static readonly HashSet<string> LeafTextures = new HashSet<string>(StringComparer.Ordinal)
        {
            "frond.png",
            "needles.png",
            "leaves.png",
            "grass.png",
            "grass_dry.png",
        };

        readonly List<VegVariant> _variants = new List<VegVariant>();
        readonly List<ChunkMeta> _metas = new List<ChunkMeta>();
        readonly Dictionary<string, VegChunk> _chunks = new Dictionary<string, VegChunk>(StringComparer.Ordinal);
        readonly HashSet<string> _loading = new HashSet<string>(StringComparer.Ordinal);
        readonly List<VegChunk> _sortedChunks = new List<VegChunk>();
        readonly Dictionary<string, Material> _materials = new Dictionary<string, Material>(StringComparer.Ordinal);
        readonly Dictionary<string, Texture2D> _textures = new Dictionary<string, Texture2D>(StringComparer.Ordinal);

        Dictionary<string, int[]> _chunkCounts;
        string _assetsRoot;
        string _texRoot;
        Material _baseMaterial;
        float _chunk = 2048f;
        float _chunkHalfDiag = 1448f;
        float _west;
        float _north;
        int _manifestVariantCount;
        bool _initialized;
        bool _dirty;
        bool _hasPick;
        Vector3 _lastPick;

        // ------------------------------------------------------------------ setup

        /// <summary>
        /// Loads every variant GLB and prepares materials. Awaiting this is optional; the instance
        /// chunks stream in from Refresh()/Update() afterwards. Never throws for asset problems,
        /// so the caller can keep the rest of the map alive.
        /// </summary>
        public async Task Init(LeonidaManifest manifest, string assetsRoot, Action<int, int, string> progress = null)
        {
            _assetsRoot = assetsRoot;
            if (manifest == null)
            {
                LastError = "manifest is null";
                Debug.LogWarning("Leonida vegetation: " + LastError);
                return;
            }

            _chunk = manifest.chunk > 0 ? manifest.chunk : 2048f;
            _west = manifest.west;
            _north = manifest.north;
            _chunkHalfDiag = _chunk * 0.70710677f;

            LeonidaVegInfo veg = manifest.veg;
            if (veg == null || veg.variants == null || veg.variants.Count == 0)
            {
                LastError = "manifest has no veg.variants";
                Debug.LogWarning("Leonida vegetation: " + LastError);
                return;
            }

            _manifestVariantCount = veg.variants.Count;

            Dictionary<string, int[]> counts = veg.chunkCounts;
            if (counts == null)
            {
                string manifestPath = string.IsNullOrEmpty(assetsRoot) ? "manifest.json" : Path.Combine(assetsRoot, "manifest.json");
                if (File.Exists(manifestPath))
                {
                    counts = LeonidaVegChunkCounts.Parse(File.ReadAllText(manifestPath));
                    veg.chunkCounts = counts;
                }
                else
                {
                    Debug.LogWarning("Leonida vegetation: manifest.json not found at " + manifestPath);
                }
            }
            _chunkCounts = counts ?? new Dictionary<string, int[]>(StringComparer.Ordinal);
            BuildMetadata();

            _texRoot = string.IsNullOrEmpty(assetsRoot) ? "veg/tex" : Path.Combine(assetsRoot, "veg", "tex");
            _baseMaterial = Resources.Load<Material>(BaseMaterialResource);

            int loaded = 0;
            for (int i = 0; i < veg.variants.Count; i++)
            {
                LeonidaVegVariant info = veg.variants[i];
                string name = info != null ? info.name : null;
                if (!string.IsNullOrEmpty(name))
                {
                    if (await LoadVariant(info, i)) loaded++;
                }
                progress?.Invoke(i + 1, veg.variants.Count, string.IsNullOrEmpty(name) ? "?" : name);
                await Task.Yield();
            }

            LoadedVariants = loaded;
            ComputeQuotas();

            _initialized = _variants.Count > 0;
            if (!_initialized)
            {
                if (string.IsNullOrEmpty(LastError)) LastError = "no vegetation variants loaded";
                Debug.LogWarning("Leonida vegetation: " + LastError);
                return;
            }

            Camera camera = cam != null ? cam : Camera.main;
            Vector3 start = camera != null ? camera.transform.position : transform.position;

            // Give the chunks around the spawn a short window to arrive so the first pick (and the
            // bootstrap status line) shows real numbers instead of pop-in. Failure to finish in time
            // is harmless: chunks keep streaming from Update().
            RequestChunks(start);
            float deadline = Time.realtimeSinceStartup + InitialChunkWait;
            while (_loading.Count > 0 && Time.realtimeSinceStartup < deadline)
            {
                await Task.Yield();
            }
            if (this == null) return;

            Refresh(start);

            Debug.Log($"Leonida vegetation: variants {_variants.Count}/{veg.variants.Count}, " +
                      $"instance chunks {_metas.Count} ({LoadedChunks} loaded), " +
                      $"trees {TreeInstances}/{maxTrees}, shrubs {ShrubInstances}/{maxShrubs}, grass {GrassInstances}/{maxGrass}");
        }

        async Task<bool> LoadVariant(LeonidaVegVariant info, int manifestIndex)
        {
            string path = string.IsNullOrEmpty(_assetsRoot)
                ? info.name + ".glb"
                : Path.Combine(_assetsRoot, "veg", info.name + ".glb");
            if (!File.Exists(path))
            {
                LastError = "variant file missing: " + path;
                Debug.LogWarning("Leonida vegetation: " + LastError);
                return false;
            }

            var gltf = new GltfImport();
            GameObject root = null;
            var variant = new VegVariant
            {
                name = info.name,
                kind = info.kind ?? string.Empty,
                manifestIndex = manifestIndex,
                type = KindOf(info.kind),
                quota = int.MaxValue,
            };

            try
            {
                bool ok = await gltf.LoadFile(path);
                if (this == null) return false;
                if (!ok)
                {
                    LastError = "glTF load failed: " + info.name;
                    Debug.LogWarning("Leonida vegetation: " + LastError);
                    return false;
                }

                root = new GameObject("veg_template_" + info.name);
                root.transform.SetParent(transform, false);
                bool instantiated = await gltf.InstantiateMainSceneAsync(root.transform);
                if (this == null) return false;
                if (!instantiated)
                {
                    LastError = "glTF instantiate failed: " + info.name;
                    Debug.LogWarning("Leonida vegetation: " + LastError);
                    return false;
                }

                MeshFilter[] filters = root.GetComponentsInChildren<MeshFilter>(true);
                for (int fi = 0; fi < filters.Length; fi++)
                {
                    MeshFilter filter = filters[fi];
                    Mesh source = filter != null ? filter.sharedMesh : null;
                    if (source == null) continue;

                    MeshRenderer renderer = filter.GetComponent<MeshRenderer>();
                    Material[] sourceMaterials = renderer != null ? renderer.sharedMaterials : null;
                    Matrix4x4 local = root.transform.worldToLocalMatrix * filter.transform.localToWorldMatrix;

                    int subMeshes = Mathf.Max(1, source.subMeshCount);
                    for (int sub = 0; sub < subMeshes; sub++)
                    {
                        string sourceName = MaterialNameAt(sourceMaterials, sub, variant.type);
                        Material material = GetMaterial(sourceName);
                        if (material == null) continue;

                        Mesh baked = BakeMesh(source, sub, local, flipTextureV);
                        if (baked == null) continue;

                        variant.parts.Add(new VegPart
                        {
                            mesh = baked,
                            material = material,
                            castShadows = variant.type != VegKind.Grass,
                        });
                    }
                }

                if (variant.parts.Count == 0)
                {
                    LastError = "no usable mesh in " + info.name;
                    Debug.LogWarning("Leonida vegetation: " + LastError);
                    for (int i = 0; i < variant.parts.Count; i++)
                    {
                        if (variant.parts[i].mesh != null) Destroy(variant.parts[i].mesh);
                    }
                    return false;
                }

                _variants.Add(variant);
                return true;
            }
            catch (Exception e)
            {
                LastError = info.name + ": " + e.Message;
                Debug.LogError($"Leonida vegetation: variant {info.name} failed: {e}");
                return false;
            }
            finally
            {
                if (root != null)
                {
                    // Deactivate before releasing the glTF data: Destroy is deferred to end of frame.
                    root.SetActive(false);
                    Destroy(root);
                }
                try
                {
                    gltf.Dispose();
                }
                catch (Exception)
                {
                    // Disposal is best effort; the baked meshes are independent copies.
                }
            }
        }

        static string MaterialNameAt(Material[] materials, int submesh, VegKind fallbackKind)
        {
            if (materials != null && materials.Length > 0)
            {
                Material material = materials[Mathf.Min(submesh, materials.Length - 1)];
                if (material != null && !string.IsNullOrEmpty(material.name)) return material.name;
            }
            if (fallbackKind == VegKind.Grass) return "VEG_Grass";
            if (fallbackKind == VegKind.Shrub) return "VEG_Leaves";
            return "VEG_Bark";
        }

        /// <summary>
        /// Copies one primitive into a standalone mesh, applying the node transform so the mesh can
        /// be fed to Graphics.DrawMeshInstanced. Baking positions only (keeping the triangle order)
        /// preserves what the renderer would have submitted for the instantiated template.
        /// </summary>
        static Mesh BakeMesh(Mesh source, int submesh, Matrix4x4 local, bool flipV)
        {
            if (source == null || submesh < 0 || submesh >= source.subMeshCount) return null;

            Vector3[] vertices = source.vertices;
            if (vertices == null || vertices.Length == 0) return null;

            int[] triangles = source.GetTriangles(submesh);
            if (triangles == null || triangles.Length == 0) return null;

            for (int i = 0; i < vertices.Length; i++) vertices[i] = local.MultiplyPoint3x4(vertices[i]);

            Vector3[] normals = source.normals;
            if (normals != null && normals.Length == vertices.Length)
            {
                Matrix4x4 normalMatrix = local.inverse.transpose;
                for (int i = 0; i < normals.Length; i++)
                {
                    Vector3 n = normalMatrix.MultiplyVector(normals[i]);
                    normals[i] = n.sqrMagnitude > 1e-10f ? n.normalized : Vector3.up;
                }
            }

            Vector2[] uv = source.uv;
            if (flipV && uv != null && uv.Length == vertices.Length)
            {
                for (int i = 0; i < uv.Length; i++) uv[i] = new Vector2(uv[i].x, 1f - uv[i].y);
            }

            var mesh = new Mesh { name = source.name + "_" + submesh };
            if (vertices.Length > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.vertices = vertices;
            if (normals != null && normals.Length == vertices.Length) mesh.normals = normals;
            if (uv != null && uv.Length == vertices.Length) mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        void ComputeQuotas()
        {
            int trees = 0, shrubs = 0, grass = 0;
            for (int i = 0; i < _variants.Count; i++)
            {
                switch (_variants[i].type)
                {
                    case VegKind.Tree: trees++; break;
                    case VegKind.Shrub: shrubs++; break;
                    default: grass++; break;
                }
            }

            for (int i = 0; i < _variants.Count; i++)
            {
                VegVariant variant = _variants[i];
                int count = variant.type == VegKind.Tree ? trees : (variant.type == VegKind.Shrub ? shrubs : grass);
                int cap = CapFor(variant.type);
                // Split the kind's budget evenly so every variant shows up near the camera.
                variant.quota = Mathf.Max(1, count > 0 ? cap / count : cap);
            }
        }

        // ------------------------------------------------------------------ materials

        Material GetMaterial(string sourceName)
        {
            string key = NormalizeMaterialName(sourceName);
            if (key.Length == 0) key = "VEG_Bark";

            Material cached;
            if (_materials.TryGetValue(key, out cached)) return cached;

            string file;
            if (!SourceTexture.TryGetValue(key, out file)) file = "bark.png";

            Color tint = Color.white;
            if (key == "VEG_Sawgrass") tint = new Color(0.85f, 0.8f, 0.55f);
            else if (key == "VEG_SabalTrunk") tint = new Color(0.8f, 0.75f, 0.68f);

            bool leaf = LeafTextures.Contains(file);
            Material material = CreateMaterial(file, tint, leaf, leaf);
            if (material != null) _materials[key] = material;
            return material;
        }

        Material CreateMaterial(string file, Color tint, bool alphaClip, bool doubleSided)
        {
            Texture2D texture = GetTexture(file);
            Material material = null;
            try
            {
                if (_baseMaterial != null)
                {
                    material = new Material(_baseMaterial);
                }
                else
                {
                    Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                    if (shader == null) shader = Shader.Find("Standard");
                    if (shader == null)
                    {
                        LastError = "URP Lit shader not found";
                        Debug.LogError("Leonida vegetation: " + LastError);
                        return null;
                    }
                    material = new Material(shader);
                }

                material.name = "veg_" + Path.GetFileNameWithoutExtension(file) + (alphaClip ? "_cutout" : "_opaque");
                if (texture != null && material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
                if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", tint);
                if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
                if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.15f);
                if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
                if (material.HasProperty("_Cull")) material.SetFloat("_Cull", doubleSided ? 0f : 2f);

                if (alphaClip)
                {
                    if (material.HasProperty("_AlphaClip")) material.SetFloat("_AlphaClip", 1f);
                    if (material.HasProperty("_Cutoff")) material.SetFloat("_Cutoff", 0.45f);
                    material.EnableKeyword("_ALPHATEST_ON");
                    material.SetOverrideTag("RenderType", "TransparentCutout");
                    material.renderQueue = (int)RenderQueue.AlphaTest;
                }

                material.enableInstancing = true;
                material.doubleSidedGI = doubleSided;
                return material;
            }
            catch (Exception e)
            {
                LastError = "material " + file + ": " + e.Message;
                Debug.LogError("Leonida vegetation: " + LastError);
                if (material != null) Destroy(material);
                return null;
            }
        }

        Texture2D GetTexture(string file)
        {
            Texture2D cached;
            if (_textures.TryGetValue(file, out cached)) return cached;

            string path = Path.Combine(_texRoot, file);
            Texture2D texture = null;
            try
            {
                if (!File.Exists(path))
                {
                    LastError = "texture missing: " + path;
                    Debug.LogWarning("Leonida vegetation: " + LastError);
                    return null;
                }

                byte[] bytes = File.ReadAllBytes(path);
                texture = new Texture2D(2, 2, TextureFormat.RGBA32, true, false)
                {
                    name = "veg_" + Path.GetFileNameWithoutExtension(file),
                };
                if (!texture.LoadImage(bytes))
                {
                    LastError = "texture decode failed: " + path;
                    Debug.LogWarning("Leonida vegetation: " + LastError);
                    Destroy(texture);
                    return null;
                }

                texture.wrapMode = TextureWrapMode.Clamp;
                texture.filterMode = FilterMode.Trilinear;
                texture.anisoLevel = 4;
                _textures[file] = texture;
                return texture;
            }
            catch (Exception e)
            {
                LastError = "texture " + file + ": " + e.Message;
                Debug.LogError("Leonida vegetation: " + LastError);
                if (texture != null) Destroy(texture);
                return null;
            }
        }

        static string NormalizeMaterialName(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return string.Empty;
            string name = raw.Trim();

            int paren = name.IndexOf(" (", StringComparison.Ordinal);
            if (paren > 0) name = name.Substring(0, paren);

            int dot = name.LastIndexOf('.');
            if (dot > 0 && dot < name.Length - 1)
            {
                bool digits = true;
                for (int i = dot + 1; i < name.Length; i++)
                {
                    if (!char.IsDigit(name[i]))
                    {
                        digits = false;
                        break;
                    }
                }
                if (digits) name = name.Substring(0, dot);
            }
            return name;
        }

        // ------------------------------------------------------------------ chunks

        void BuildMetadata()
        {
            _metas.Clear();
            if (_chunkCounts == null) return;

            foreach (KeyValuePair<string, int[]> pair in _chunkCounts)
            {
                string key = pair.Key;
                if (string.IsNullOrEmpty(key)) continue;
                int separator = key.IndexOf('_');
                if (separator <= 0 || separator >= key.Length - 1) continue;

                int i, j;
                if (!int.TryParse(key.Substring(0, separator), NumberStyles.Integer, CultureInfo.InvariantCulture, out i)) continue;
                if (!int.TryParse(key.Substring(separator + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out j)) continue;

                _metas.Add(new ChunkMeta
                {
                    key = key,
                    i = i,
                    j = j,
                    counts = pair.Value,
                    centre = ChunkCentre(i, j),
                });
            }
        }

        Vector3 ChunkCentre(int i, int j)
        {
            float x = _west + (i + 0.5f) * _chunk;
            float north = _north - (j + 0.5f) * _chunk;
            return new Vector3(x, 0f, -north);
        }

        void RequestChunks(Vector3 camera)
        {
            float loadRadius = farRadius + _chunk * 0.75f;
            float loadRadiusSq = loadRadius * loadRadius;

            for (int i = 0; i < _metas.Count; i++)
            {
                ChunkMeta meta = _metas[i];
                if (_chunks.ContainsKey(meta.key) || _loading.Contains(meta.key)) continue;

                float dx = meta.centre.x - camera.x;
                float dz = meta.centre.z - camera.z;
                if (dx * dx + dz * dz > loadRadiusSq) continue;

                if (!_loading.Add(meta.key)) continue;
                _ = LoadChunkAsync(meta);
            }
        }

        async Task LoadChunkAsync(ChunkMeta meta)
        {
            VegChunk chunk = null;
            try
            {
                string path = string.IsNullOrEmpty(_assetsRoot)
                    ? "inst_" + meta.key + ".bin"
                    : Path.Combine(_assetsRoot, "veg", "inst_" + meta.key + ".bin");

                if (File.Exists(path))
                {
                    byte[] bytes = await Task.Run(() => File.ReadAllBytes(path));
                    if (this == null) return;
                    chunk = ParseChunk(meta, bytes);
                }
                else
                {
                    LastError = "chunk file missing: " + path;
                    Debug.LogWarning("Leonida vegetation: " + LastError);
                }
            }
            catch (Exception e)
            {
                LastError = "chunk " + meta.key + ": " + e.Message;
                Debug.LogWarning($"Leonida vegetation: chunk {meta.key} failed: {e.Message}");
            }
            finally
            {
                if (chunk == null) chunk = EmptyChunk(meta);
                _chunks[meta.key] = chunk;
                _loading.Remove(meta.key);
                LoadedChunks = _chunks.Count;
                _dirty = true;
            }
        }

        VegChunk EmptyChunk(ChunkMeta meta)
        {
            var chunk = new VegChunk
            {
                key = meta.key,
                i = meta.i,
                j = meta.j,
                centre = meta.centre,
                x0 = _west + meta.i * _chunk,
                northEdge = _north - meta.j * _chunk,
                records = new VegRecord[0],
                varStart = new int[_manifestVariantCount],
                varCount = new int[_manifestVariantCount],
            };
            return chunk;
        }

        VegChunk ParseChunk(ChunkMeta meta, byte[] bytes)
        {
            VegChunk chunk = EmptyChunk(meta);

            int nVariants = meta.counts != null ? Mathf.Min(meta.counts.Length, _manifestVariantCount) : 0;
            int available = bytes != null ? bytes.Length / RecordSize : 0;

            int wanted = 0;
            for (int vi = 0; vi < nVariants; vi++) wanted += Mathf.Max(0, meta.counts[vi]);

            int capacity = Mathf.Min(wanted, available);
            if (capacity < 0) capacity = 0;
            chunk.records = capacity > 0 ? new VegRecord[capacity] : new VegRecord[0];

            int record = 0;
            for (int vi = 0; vi < nVariants; vi++)
            {
                int want = Mathf.Max(0, meta.counts[vi]);
                int take = Mathf.Min(want, available - record);
                if (take < 0) take = 0;

                chunk.varStart[vi] = record;
                chunk.varCount[vi] = take;

                for (int k = 0; k < take; k++, record++)
                {
                    int o = record * RecordSize;
                    chunk.records[record] = new VegRecord
                    {
                        u = (ushort)(bytes[o] | (bytes[o + 1] << 8)),
                        v = (ushort)(bytes[o + 2] | (bytes[o + 3] << 8)),
                        h = (short)(bytes[o + 4] | (bytes[o + 5] << 8)),
                        yaw = bytes[o + 6],
                        scale = bytes[o + 7],
                    };
                }
                if (record >= available) break;
            }

            return chunk;
        }

        // ------------------------------------------------------------------ runtime

        void Update()
        {
            if (!_initialized) return;
            Camera camera = cam != null ? cam : Camera.main;
            if (camera == null) return;
            Refresh(camera.transform.position);
        }

        /// <summary>Streams nearby chunks and re-picks the drawn instances around the camera.</summary>
        public void Refresh(Vector3 cameraPosition)
        {
            if (!_initialized) return;

            RequestChunks(cameraPosition);

            bool moved = !_hasPick || (cameraPosition - _lastPick).sqrMagnitude > MoveThreshold * MoveThreshold;
            if (_dirty || moved)
            {
                Rebuild(cameraPosition);
                _lastPick = cameraPosition;
                _hasPick = true;
                _dirty = false;
            }

            Draw();
        }

        void Rebuild(Vector3 camera)
        {
            for (int i = 0; i < _variants.Count; i++) _variants[i].Reset();

            _sortedChunks.Clear();
            foreach (KeyValuePair<string, VegChunk> pair in _chunks) _sortedChunks.Add(pair.Value);
            _sortedChunks.Sort((a, b) =>
            {
                float ax = a.centre.x - camera.x;
                float az = a.centre.z - camera.z;
                float bx = b.centre.x - camera.x;
                float bz = b.centre.z - camera.z;
                return (ax * ax + az * az).CompareTo(bx * bx + bz * bz);
            });

            // u/v are 16-bit fractions of the 2048 m chunk (see vegetation.js).
            float fraction = _chunk / 65535f;
            float yawStep = 360f / 256f;
            float scaleStep = 0.01f;

            for (int ci = 0; ci < _sortedChunks.Count; ci++)
            {
                VegChunk chunk = _sortedChunks[ci];
                float chunkDx = chunk.centre.x - camera.x;
                float chunkDz = chunk.centre.z - camera.z;
                float chunkDistance = Mathf.Sqrt(chunkDx * chunkDx + chunkDz * chunkDz);

                for (int vi = 0; vi < _variants.Count; vi++)
                {
                    VegVariant variant = _variants[vi];
                    if (variant.parts.Count == 0 || variant.count >= variant.quota) continue;

                    float radius = RadiusFor(variant.type);
                    // Whole chunk can be skipped if no instance of it can fall inside the radius.
                    if (chunkDistance - _chunkHalfDiag > radius) continue;

                    float radiusSq = radius * radius;
                    int index = variant.manifestIndex;
                    if (index < 0 || index >= chunk.varStart.Length) continue;

                    int start = chunk.varStart[index];
                    int end = start + chunk.varCount[index];
                    for (int k = start; k < end && variant.count < variant.quota; k++)
                    {
                        VegRecord r = chunk.records[k];
                        float x = chunk.x0 + r.u * fraction;
                        float north = chunk.northEdge - r.v * fraction;
                        float z = -north;

                        float dx = x - camera.x;
                        float dz = z - camera.z;
                        if (dx * dx + dz * dz > radiusSq) continue;

                        var position = new Vector3(x, r.h * 0.01f, z);
                        Quaternion rotation = Quaternion.Euler(0f, r.yaw * yawStep, 0f);
                        float s = r.scale * scaleStep;
                        variant.Add(Matrix4x4.TRS(position, rotation, new Vector3(s, s, s)));
                    }
                }
            }

            int trees = 0, shrubs = 0, grass = 0;
            for (int i = 0; i < _variants.Count; i++)
            {
                VegVariant variant = _variants[i];
                switch (variant.type)
                {
                    case VegKind.Tree: trees += variant.count; break;
                    case VegKind.Shrub: shrubs += variant.count; break;
                    default: grass += variant.count; break;
                }
            }
            TreeInstances = trees;
            ShrubInstances = shrubs;
            GrassInstances = grass;
        }

        void Draw()
        {
            Camera camera = cam != null ? cam : Camera.main;
            int layer = gameObject.layer;

            for (int vi = 0; vi < _variants.Count; vi++)
            {
                VegVariant variant = _variants[vi];
                for (int pi = 0; pi < variant.parts.Count; pi++)
                {
                    VegPart part = variant.parts[pi];
                    if (part.mesh == null || part.material == null) continue;

                    for (int b = 0; b < part.batches.Count; b++)
                    {
                        int count = part.counts[b];
                        if (count <= 0) continue;

                        Graphics.DrawMeshInstanced(
                            part.mesh, 0, part.material, part.batches[b], count, null,
                            part.castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off,
                            true, layer, camera);
                    }
                }
            }
        }

        static VegKind KindOf(string kind)
        {
            if (string.IsNullOrEmpty(kind)) return VegKind.Shrub;
            if (kind.StartsWith("grass", StringComparison.OrdinalIgnoreCase)) return VegKind.Grass;
            if (kind == "palm" || kind == "pine" || kind == "oak") return VegKind.Tree;
            return VegKind.Shrub;
        }

        float RadiusFor(VegKind kind)
        {
            if (kind == VegKind.Tree) return treeRadius;
            if (kind == VegKind.Shrub) return shrubRadius;
            return grassRadius;
        }

        int CapFor(VegKind kind)
        {
            if (kind == VegKind.Tree) return maxTrees;
            if (kind == VegKind.Shrub) return maxShrubs;
            return maxGrass;
        }

        void OnDestroy()
        {
            for (int vi = 0; vi < _variants.Count; vi++)
            {
                VegVariant variant = _variants[vi];
                for (int pi = 0; pi < variant.parts.Count; pi++)
                {
                    VegPart part = variant.parts[pi];
                    if (part.mesh != null) Destroy(part.mesh);
                }
            }
            _variants.Clear();

            // Materials are shared between variants, so release each one exactly once here.
            foreach (KeyValuePair<string, Material> pair in _materials)
            {
                if (pair.Value != null) Destroy(pair.Value);
            }
            _materials.Clear();

            foreach (KeyValuePair<string, Texture2D> pair in _textures)
            {
                if (pair.Value != null) Destroy(pair.Value);
            }
            _textures.Clear();
            _chunks.Clear();
            _metas.Clear();
            _loading.Clear();
        }
    }
}
