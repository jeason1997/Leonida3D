using System;
using System.Collections.Generic;
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

        public void Build(LeonidaManifest m, string assetsRoot)
        {
            ChunkCount = 0;
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
                    ChunkCount++;
                }
            }

            Debug.Log($"Leonida: terrain built, {ChunkCount} chunks, {m.nx * m.ny * perChunk} vertices");
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

        static Color HeightColor(float h)
        {
            if (h < 0.35f) return new Color(0.62f, 0.56f, 0.40f);   // beach / seabed sand
            if (h < 2.0f) return new Color(0.36f, 0.43f, 0.24f);    // coastal green
            if (h < 12f) return new Color(0.33f, 0.40f, 0.24f);     // city ground
            if (h < 35f) return new Color(0.30f, 0.34f, 0.24f);
            return new Color(0.42f, 0.42f, 0.38f);                  // higher ground
        }
    }
}
