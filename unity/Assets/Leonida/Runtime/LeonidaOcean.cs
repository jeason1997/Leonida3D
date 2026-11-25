using UnityEngine;

namespace Leonida
{
    /// <summary>High-density Gerstner wave grid around the camera; flat far plane underneath.</summary>
    public class LeonidaOcean : MonoBehaviour
    {
        public Camera cam;
        public Material material;
        public float size = 4000f;
        public int segments = 384;

        Mesh _mesh;

        public void Init(Camera camera, Material mat)
        {
            cam = camera;
            material = mat;
            Build();
        }

        void Build()
        {
            int n = segments + 1;
            var verts = new Vector3[n * n];
            var normals = new Vector3[n * n];
            var uvs = new Vector2[n * n];
            float step = size / segments, half = size * 0.5f;
            for (int z = 0; z < n; z++)
            {
                for (int x = 0; x < n; x++)
                {
                    int i = z * n + x;
                    verts[i] = new Vector3(-half + x * step, 0f, -half + z * step);
                    normals[i] = Vector3.up;
                    uvs[i] = new Vector2((float)x / segments, (float)z / segments);
                }
            }

            var tris = new int[segments * segments * 6];
            int t = 0;
            for (int z = 0; z < segments; z++)
            {
                for (int x = 0; x < segments; x++)
                {
                    int i = z * n + x;
                    tris[t++] = i; tris[t++] = i + n; tris[t++] = i + 1;
                    tris[t++] = i + 1; tris[t++] = i + n; tris[t++] = i + n + 1;
                }
            }

            _mesh = new Mesh { name = "OceanWaves" };
            _mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            _mesh.vertices = verts;
            _mesh.normals = normals;
            _mesh.uv = uvs;
            _mesh.triangles = tris;
            _mesh.RecalculateBounds();

            var go = new GameObject("OceanWaveMesh");
            go.transform.SetParent(transform, false);
            var filter = go.AddComponent<MeshFilter>();
            filter.sharedMesh = _mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        void LateUpdate()
        {
            if (cam == null) return;
            float cell = size / segments;
            Vector3 p = cam.transform.position;
            transform.position = new Vector3(Mathf.Floor(p.x / cell) * cell, 0.06f, Mathf.Floor(p.z / cell) * cell);
        }
    }
}
