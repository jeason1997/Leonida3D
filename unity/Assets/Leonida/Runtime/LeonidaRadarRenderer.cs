using System.Collections.Generic;
using UnityEngine;

namespace Leonida
{
    /// <summary>GPU radar: minimap tile quads rendered by an orthographic camera into a fixed RT.</summary>
    public class LeonidaRadarRenderer : MonoBehaviour
    {
        public Camera radarCam;
        public RenderTexture Target { get; private set; }

        readonly List<GameObject> _quads = new List<GameObject>();
        int _layer = 30;

        public void Init(Camera main, LeonidaManifest m, Dictionary<string, Texture2D> tiles)
        {
            if (main != null) main.cullingMask &= ~(1 << _layer);

            var shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) shader = Shader.Find("Unlit/Texture");
            float C = m.chunk, west = m.west, north = m.north;

            var root = new GameObject("RadarTiles");
            root.layer = _layer;
            foreach (var kv in tiles)
            {
                string[] p = kv.Key.Split('_');
                if (p.Length != 2 || !int.TryParse(p[0], out int i) || !int.TryParse(p[1], out int j)) continue;
                var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
                go.name = "Radar_" + kv.Key;
                go.layer = _layer;
                go.transform.SetParent(root.transform, false);
                go.transform.position = new Vector3(west + i * C + C * 0.5f, 0f, -(north - j * C - C * 0.5f));
                go.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
                go.transform.localScale = new Vector3(C, C, 1f);
                Destroy(go.GetComponent<Collider>());

                var mat = new Material(shader);
                mat.SetTexture("_BaseMap", kv.Value);
                mat.SetTexture("_MainTex", kv.Value);
                mat.SetVector("_BaseMap_ST", new Vector4(1f, -1f, 0f, 1f));
                mat.SetFloat("_Cull", 0f);
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = mat;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                mr.receiveShadows = false;
                _quads.Add(go);
            }

            var camGo = new GameObject("RadarCamera");
            radarCam = camGo.AddComponent<Camera>();
            radarCam.orthographic = true;
            radarCam.clearFlags = CameraClearFlags.SolidColor;
            radarCam.backgroundColor = new Color(0.14f, 0.25f, 0.34f, 1f);
            radarCam.cullingMask = 1 << _layer;
            radarCam.nearClipPlane = 0.1f;
            radarCam.farClipPlane = 500f;
            radarCam.allowHDR = false;
            radarCam.allowMSAA = false;
            radarCam.depth = -100;
            Target = new RenderTexture(512, 376, 16, RenderTextureFormat.ARGB32);
            Target.filterMode = FilterMode.Bilinear;
            radarCam.targetTexture = Target;
            radarCam.transform.position = new Vector3(0f, 100f, 0f);
            radarCam.transform.rotation = Quaternion.Euler(90f, 180f, 0f);
        }

        public void SetView(Vector3 player, float headingDeg, float mpp, bool flip)
        {
            if (radarCam == null) return;
            radarCam.transform.position = new Vector3(player.x, 100f, player.z);
            radarCam.transform.rotation = Quaternion.Euler(90f, flip ? 180f - headingDeg : 180f + headingDeg, 0f);
            radarCam.orthographicSize = Mathf.Max(1f, mpp * 376f * 0.5f);
        }
    }
}
