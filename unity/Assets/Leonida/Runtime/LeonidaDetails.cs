using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Rendering;

namespace Leonida
{
    /// <summary>
    /// Rooftop details exported by scripts/web_details.py into details/det_&lt;i&gt;_&lt;j&gt;.bin.
    /// Layout (little endian): u32 vertexCount, u32 indexCount, f32 originX, f32 originZ,
    /// i16 positions (5 cm) * 3 per vertex, u8 sRGB colors * 3 per vertex, padding,
    /// u16 or u32 indices (u16 when vertexCount &lt; 65536).
    /// </summary>
    public class LeonidaDetails : MonoBehaviour
    {
        public int LoadedChunks { get; private set; }
        public int VertexCount { get; private set; }
        public string LastError { get; private set; }

        public async Task LoadAsync(LeonidaManifest m, string assetsRoot, int centerI, int centerJ,
                                    int radius, Action<int, int, string> progress = null)
        {
            if (m.details == null) return;

            var keys = new List<(string key, int i, int j, int dist)>();
            foreach (string key in m.details)
            {
                string[] parts = key.Split('_');
                if (parts.Length != 2 || !int.TryParse(parts[0], out int i) || !int.TryParse(parts[1], out int j))
                    continue;
                int dist = Mathf.Abs(i - centerI) + Mathf.Abs(j - centerJ);
                if (dist <= radius) keys.Add((key, i, j, dist));
            }
            keys.Sort((a, b) => a.dist.CompareTo(b.dist));

            int done = 0;
            foreach (var item in keys)
            {
                string path = Path.Combine(assetsRoot, "details", $"det_{item.key}.bin");
                if (!File.Exists(path))
                {
                    done++;
                    continue;
                }

                try
                {
                    byte[] buf = await Task.Run(() => File.ReadAllBytes(path));
                    if (buf.Length < 16)
                    {
                        LastError = $"det_{item.key} too short";
                        continue;
                    }

                    uint nv = BitConverter.ToUInt32(buf, 0);
                    uint ni = BitConverter.ToUInt32(buf, 4);
                    float ox = BitConverter.ToSingle(buf, 8);
                    float oz = BitConverter.ToSingle(buf, 12);
                    int posBytes = checked((int)nv * 6);
                    int colBytes = checked((int)nv * 3);
                    int ioff = 16 + posBytes + colBytes;
                    ioff += (4 - (ioff % 4)) % 4;
                    int indexBytes = checked((int)ni * (nv < 65536 ? 2 : 4));

                    if (buf.Length < ioff + indexBytes)
                    {
                        LastError = $"det_{item.key} truncated";
                        continue;
                    }

                    var vertices = new Vector3[nv];
                    var colors = new Color32[nv];
                    var lin = new Color32[nv];

                    for (int v = 0; v < nv; v++)
                    {
                        int po = 16 + v * 6;
                        short px = BitConverter.ToInt16(buf, po);
                        short py = BitConverter.ToInt16(buf, po + 2);
                        short pz = BitConverter.ToInt16(buf, po + 4);
                        vertices[v] = new Vector3(px * 0.05f + ox, py * 0.05f, pz * 0.05f + oz);
                        int co = 16 + posBytes + v * 3;
                        colors[v] = new Color32(buf[co], buf[co + 1], buf[co + 2], 255);
                    }

                    int[] triangles;
                    if (nv < 65536)
                    {
                        triangles = new int[ni];
                        for (int k = 0; k < ni; k++)
                            triangles[k] = BitConverter.ToUInt16(buf, ioff + k * 2);
                    }
                    else
                    {
                        triangles = new int[ni];
                        for (int k = 0; k < ni; k++)
                            triangles[k] = (int)BitConverter.ToUInt32(buf, ioff + k * 4);
                    }

                    var mesh = new Mesh
                    {
                        name = $"det_{item.key}",
                        indexFormat = nv >= 65536 ? IndexFormat.UInt32 : IndexFormat.UInt16,
                    };
                    mesh.SetVertices(vertices);
                    mesh.SetColors(colors);
                    mesh.SetTriangles(triangles, 0, true);
                    mesh.RecalculateNormals();
                    mesh.RecalculateBounds();

                    var go = new GameObject($"details_{item.key}");
                    go.transform.SetParent(transform, false);
                    go.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var mr = go.AddComponent<MeshRenderer>();
                    mr.sharedMaterial = LeonidaMaterials.Detail();
                    mr.shadowCastingMode = ShadowCastingMode.On;
                    mr.receiveShadows = true;

                    VertexCount += vertices.Length;
                    LoadedChunks++;
                }
                catch (Exception e)
                {
                    LastError = $"{item.key}: {e.Message}";
                    Debug.LogWarning($"Leonida details {item.key}: {e}");
                }

                done++;
                progress?.Invoke(done, keys.Count, item.key);
                await Task.Yield();
            }
        }
    }
}
