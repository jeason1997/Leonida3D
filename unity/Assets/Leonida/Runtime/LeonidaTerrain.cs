using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;

namespace Leonida
{
    /// <summary>
    /// Builds the whole-map far terrain from assets/terrain/far.bin.
    /// Map coords: x east, y north, z up. Unity: (x, height, -north), matching the GLB chunks.
    /// </summary>
    public class LeonidaTerrain : MonoBehaviour
    {
        public Material terrainMaterial;

        public int ChunkCount { get; private set; }

        short[] _heights;
        int _heightN;
        LeonidaManifest _manifest;
        readonly Dictionary<string, MeshRenderer> _far = new Dictionary<string, MeshRenderer>();

        /// <summary>Bilinear terrain height in map metres (x east, north positive).</summary>
        public float HeightAt(float mapX, float mapNorth)
        {
            if (_heights == null || _manifest == null) return 0f;
            int n = _heightN;
            float fx = (mapX - _manifest.west) / _manifest.chunk;
            float fy = (_manifest.north - mapNorth) / _manifest.chunk;
            int i = Mathf.Clamp(Mathf.FloorToInt(fx), 0, _manifest.nx - 1);
            int j = Mathf.Clamp(Mathf.FloorToInt(fy), 0, _manifest.ny - 1);
            float lx = Mathf.Clamp01(fx - i);
            float ly = Mathf.Clamp01(fy - j);
            int offset = (j * _manifest.nx + i) * n * n;
            int x0 = Mathf.Clamp(Mathf.FloorToInt(lx * (n - 1)), 0, n - 2);
            int y0 = Mathf.Clamp(Mathf.FloorToInt(ly * (n - 1)), 0, n - 2);
            float ax = lx * (n - 1) - x0;
            float ay = ly * (n - 1) - y0;
            short a = _heights[offset + y0 * n + x0];
            short b = _heights[offset + y0 * n + x0 + 1];
            short c = _heights[offset + (y0 + 1) * n + x0];
            short d = _heights[offset + (y0 + 1) * n + x0 + 1];
            float h = ((a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay) * 0.1f;
            return h;
        }

        public void Build(LeonidaManifest m, string assetsRoot)
        {
            ChunkCount = 0;
            _manifest = m;
            string path = System.IO.Path.Combine(assetsRoot, m.terrain.far);
            if (!System.IO.File.Exists(path))
            {
                Debug.LogError($"Leonida: terrain file missing: {path}");
                return;
            }

            byte[] bytes = System.IO.File.ReadAllBytes(path);
            int n = m.terrain.far_n;
            int perChunk = n * n;
            int expected = m.nx * m.ny * perChunk * 2;
            if (bytes.Length < expected)
            {
                Debug.LogError($"Leonida: far.bin is {bytes.Length} bytes, expected {expected}");
                return;
            }

            var heights = new short[m.nx * m.ny * perChunk];
            Buffer.BlockCopy(bytes, 0, heights, 0, expected);
            _heights = heights;
            _heightN = n;

            if (terrainMaterial == null)
            {
                terrainMaterial = LeonidaMaterials.Terrain();
            }

            float C = m.chunk;
            var root = new GameObject("Terrain").transform;
            root.SetParent(transform, false);

            for (int j = 0; j < m.ny; j++)
            {
                for (int i = 0; i < m.nx; i++)
                {
                    var go = new GameObject($"terrain_{i}_{j}");
                    go.transform.SetParent(root, false);
                    var filter = go.AddComponent<MeshFilter>();
                    var renderer = go.AddComponent<MeshRenderer>();
                    renderer.sharedMaterial = terrainMaterial;
                    renderer.shadowCastingMode = ShadowCastingMode.Off;
                    renderer.receiveShadows = true;
                    filter.sharedMesh = BuildChunkMesh(m, heights, i, j, n, C);
                    _far[$"{i}_{j}"] = renderer;
                    ChunkCount++;
                }
            }

            Debug.Log($"Leonida: terrain built, {ChunkCount} chunks, {m.nx * m.ny * perChunk} vertices");
        }

        /// <summary>
        /// Replace far terrain around the camera with 8 m near tiles that carry the web build's
        /// aerial color_*.jpg texture. Radius is in 2048 m chunks.
        /// </summary>
        public void BuildNear(LeonidaManifest m, string assetsRoot, int centerI, int centerJ, int radius)
        {
            if (m.terrain.near == null || m.terrain.near.Count == 0) return;
            int n = m.terrain.near_n;
            float C = m.chunk;
            var nearRoot = new GameObject("TerrainNear").transform;
            nearRoot.SetParent(transform, false);
            var baseMat = Resources.Load<Material>("URPLit");

            for (int dj = -radius; dj <= radius; dj++)
            {
                for (int di = -radius; di <= radius; di++)
                {
                    int i = centerI + di, j = centerJ + dj;
                    if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) continue;
                    string key = $"{i}_{j}";
                    if (!m.terrain.near.Contains(key)) continue;

                    string binPath = Path.Combine(assetsRoot, "terrain", $"near_{key}.bin");
                    if (!File.Exists(binPath)) continue;
                    byte[] raw = File.ReadAllBytes(binPath);
                    if (raw.Length < n * n * 2) continue;
                    var heights = new short[n * n];
                    Buffer.BlockCopy(raw, 0, heights, 0, n * n * 2);

                    var mesh = BuildNearMesh(m, heights, i, j, n, C);
                    var go = new GameObject($"near_{key}");
                    go.transform.SetParent(nearRoot, false);
                    go.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var mr = go.AddComponent<MeshRenderer>();

                    Material mat = baseMat != null ? new Material(baseMat) : new Material(Shader.Find("Universal Render Pipeline/Lit"));
                    mat.name = $"terrain_near_{key}";
                    string jpg = Path.Combine(assetsRoot, "terrain", $"color_{key}.jpg");
                    if (File.Exists(jpg))
                    {
                        var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                        if (tex.LoadImage(File.ReadAllBytes(jpg)))
                        {
                            tex.wrapMode = TextureWrapMode.Clamp;
                            tex.anisoLevel = 8;
                            mat.SetTexture("_BaseMap", tex);
                            mat.SetColor("_BaseColor", Color.white);
                        }
                    }
                    if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 0.05f);
                    mr.sharedMaterial = mat;
                    mr.receiveShadows = true;
                    mr.shadowCastingMode = ShadowCastingMode.Off;

                    if (_far.TryGetValue(key, out var far)) far.enabled = false;
                }
            }
        }

        static Mesh BuildNearMesh(LeonidaManifest m, short[] heights, int ci, int cj, int n, float C)
        {
            int vcount = n * n;
            var vertices = new Vector3[vcount];
            var uv = new Vector2[vcount];
            float x0 = m.west + ci * C;
            float north0 = m.north - cj * C;
            float step = C / (n - 1);
            for (int r = 0; r < n; r++)
            {
                for (int q = 0; q < n; q++)
                {
                    int vi = r * n + q;
                    float h = heights[vi] * 0.1f;
                    float x = x0 + q * step;
                    float north = north0 - r * step;
                    vertices[vi] = new Vector3(x, h, -north);
                    uv[vi] = new Vector2(q / (float)(n - 1), 1f - r / (float)(n - 1));
                }
            }

            var triangles = new int[(n - 1) * (n - 1) * 6];
            int ti = 0;
            for (int r = 0; r < n - 1; r++)
            {
                for (int q = 0; q < n - 1; q++)
                {
                    int a = r * n + q, b = a + 1, c = a + n, d = c + 1;
                    triangles[ti++] = a; triangles[ti++] = c; triangles[ti++] = b;
                    triangles[ti++] = b; triangles[ti++] = c; triangles[ti++] = d;
                }
            }

            var mesh = new Mesh
            {
                name = $"near_{ci}_{cj}",
                indexFormat = IndexFormat.UInt32,
                vertices = vertices,
                uv = uv,
                triangles = triangles,
            };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh BuildChunkMesh(LeonidaManifest m, short[] heights, int ci, int cj, int n, float C)
        {
            int perChunk = n * n;
            int offset = (cj * m.nx + ci) * perChunk;
            int vcount = n * n;
            var vertices = new Vector3[vcount];
            var colors = new Color[vcount];

            float x0 = m.west + ci * C;
            float north0 = m.north - cj * C;
            float step = C / (n - 1);

            for (int r = 0; r < n; r++)
            {
                for (int q = 0; q < n; q++)
                {
                    int vi = r * n + q;
                    float h = heights[offset + vi] * 0.1f;
                    float x = x0 + q * step;
                    float north = north0 - r * step;
                    vertices[vi] = new Vector3(x, h, -north);
                    colors[vi] = HeightColor(h);
                }
            }

            var triangles = new int[(n - 1) * (n - 1) * 6];
            int ti = 0;
            for (int r = 0; r < n - 1; r++)
            {
                for (int q = 0; q < n - 1; q++)
                {
                    int a = r * n + q;
                    int b = a + 1;
                    int c = a + n;
                    int d = c + 1;
                    // Unity front faces are clockwise; these wind so the top face points up.
                    triangles[ti++] = a; triangles[ti++] = c; triangles[ti++] = b;
                    triangles[ti++] = b; triangles[ti++] = c; triangles[ti++] = d;
                }
            }

            var mesh = new Mesh
            {
                name = $"terrain_{ci}_{cj}",
                vertices = vertices,
                colors = colors,
                triangles = triangles,
            };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Color HeightColor(float h)        {
            if (h < 0.35f) return new Color(0.62f, 0.56f, 0.40f);   // beach / seabed sand
            if (h < 2.0f) return new Color(0.36f, 0.43f, 0.24f);    // coastal green
            if (h < 12f) return new Color(0.33f, 0.40f, 0.24f);     // city ground
            if (h < 35f) return new Color(0.30f, 0.34f, 0.24f);
            return new Color(0.42f, 0.42f, 0.38f);                  // higher ground
        }
    }
}
