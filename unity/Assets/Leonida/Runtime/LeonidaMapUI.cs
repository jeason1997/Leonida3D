using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Leonida
{
    /// <summary>
    /// IMGUI minimap + full map + teleports. Uses the stitched Resources/MapFull.png,
    /// so it has no Canvas/UI Toolkit/font dependency and works in the player build.
    /// </summary>
    public class LeonidaMapUI : MonoBehaviour
    {
        Camera _cam;
        LeonidaManifest _manifest;
        Texture2D _map;
        float _x0 = -10856f, _x1 = 3480f, _y0 = -9480f, _y1 = 11000f;
        float _radarMeters = 1600f;
        bool _mapOpen;
        public bool Hidden;
        readonly Dictionary<string, Texture2D> _tiles = new Dictionary<string, Texture2D>();
        public void SetOpen(bool open) { _mapOpen = open; }
        GUIStyle _label;
        GUIStyle _title;

        public void Init(Camera cam, LeonidaManifest manifest)
        {
            _cam = cam;
            _manifest = manifest;
            _map = Resources.Load<Texture2D>("MapFull");
            _tiles.Clear();
            if (manifest != null && manifest.minimap != null && manifest.minimap.tiles != null)
            {
                foreach (string key in manifest.minimap.tiles)
                {
                    var tex = Resources.Load<Texture2D>($"Minimap/mm_{key}");
                    if (tex != null) _tiles[key] = tex;
                }
            }
            if (_map == null)
            {
                Debug.LogWarning("Leonida: Resources/MapFull.png missing");
                return;
            }

            if (manifest != null && manifest.minimap != null && manifest.minimap.tiles != null && manifest.minimap.tiles.Count > 0)
            {
                int i0 = int.MaxValue, i1 = int.MinValue, j0 = int.MaxValue, j1 = int.MinValue;
                foreach (string key in manifest.minimap.tiles)
                {
                    string[] p = key.Split('_');
                    if (p.Length != 2 || !int.TryParse(p[0], out int i) || !int.TryParse(p[1], out int j)) continue;
                    i0 = Mathf.Min(i0, i); i1 = Mathf.Max(i1, i);
                    j0 = Mathf.Min(j0, j); j1 = Mathf.Max(j1, j);
                }
                _x0 = manifest.west + i0 * manifest.chunk;
                _x1 = manifest.west + (i1 + 1) * manifest.chunk;
                _y0 = manifest.north - (j1 + 1) * manifest.chunk;
                _y1 = manifest.north - j0 * manifest.chunk;
            }
        }

        void Update()
        {
            if (LeonidaStartMenu.InputLocked) return;
            var kb = Keyboard.current;
            if (kb == null) return;

            if (kb.mKey.wasPressedThisFrame) _mapOpen = !_mapOpen;
            if (kb.escapeKey.wasPressedThisFrame) _mapOpen = false;

            if (kb.digit1Key.wasPressedThisFrame) Teleport(0);
            else if (kb.digit2Key.wasPressedThisFrame) Teleport(1);
            else if (kb.digit3Key.wasPressedThisFrame) Teleport(2);
            else if (kb.digit4Key.wasPressedThisFrame) Teleport(3);
            else if (kb.digit5Key.wasPressedThisFrame) Teleport(4);
            else if (kb.digit6Key.wasPressedThisFrame) Teleport(5);
            else if (kb.digit7Key.wasPressedThisFrame) Teleport(6);
        }

        void OnGUI()
        {
            if (Hidden || LeonidaStartMenu.InputLocked || _map == null || _cam == null) return;

            if (_label == null)
            {
                _label = new GUIStyle(GUI.skin.label) { fontSize = 14, fontStyle = FontStyle.Bold };
                _label.normal.textColor = Color.white;
                _title = new GUIStyle(_label) { fontSize = 26 };
            }

            float w = Mathf.Clamp(Screen.width * 0.19f, 260f, 380f);
            float h = w * 0.70f;
            Rect radar = new Rect(Screen.width - w - 24f, Screen.height - h - 24f, w, h);
            DrawRadar(radar);

            if (_mapOpen) DrawFullMap();
            else DrawHint();
        }
        void DrawRadar(Rect rect)
        {
            GUI.color = new Color(0.05f, 0.12f, 0.18f, 0.95f);
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = Color.white;

            Vector3 p = _cam.transform.position;
            float camNorth = -p.z;
            Vector3 fwd = _cam.transform.forward;
            float heading = Mathf.Atan2(fwd.x, -fwd.z) * Mathf.Rad2Deg;
            float mpp = Mathf.Clamp(1.6f + Mathf.Max(0f, p.y) / 110f, 1.6f, 40f);
            float k = 1f / mpp;
            float C = _manifest != null ? _manifest.chunk : 2048f;
            float west = _manifest != null ? _manifest.west : _x0;
            float north = _manifest != null ? _manifest.north : _y1;

            GUI.BeginClip(rect);
            Vector2 c = new Vector2(rect.width * 0.5f, rect.height * 0.62f);
            GUIUtility.RotateAroundPivot(-heading, c);

            float R = Mathf.Sqrt(rect.width * rect.width + rect.height * rect.height) * mpp;
            int i0 = Mathf.FloorToInt((p.x - R - west) / C), i1 = Mathf.FloorToInt((p.x + R - west) / C);
            int j0 = Mathf.FloorToInt((north - (camNorth + R)) / C), j1 = Mathf.FloorToInt((north - (camNorth - R)) / C);
            for (int i = i0; i <= i1; i++)
            {
                for (int j = j0; j <= j1; j++)
                {
                    if (!_tiles.TryGetValue($"{i}_{j}", out var tex) || tex == null) continue;
                    float mx = west + i * C + C * 0.5f;
                    float mn = north - j * C - C * 0.5f;
                    float sx = c.x + (mx - p.x) * k;
                    float sy = c.y - (mn - camNorth) * k;
                    GUI.DrawTexture(new Rect(sx - C * k * 0.5f, sy - C * k * 0.5f, C * k, C * k), tex, ScaleMode.StretchToFill, false);
                }
            }

            var arrow = new GUIStyle(_label) { fontSize = 20, alignment = TextAnchor.MiddleCenter };
            GUIUtility.RotateAroundPivot(heading, c);
            GUI.EndClip();

            // The player arrow and N marker must stay screen-aligned, not rotate with the map.
            float cx = rect.x + rect.width * 0.5f;
            float cy = rect.y + rect.height * 0.62f;
            GUI.Label(new Rect(cx - 14f, cy - 14f, 28f, 28f), "▲", arrow);

            float rad = heading * Mathf.Deg2Rad;
            float nx = Mathf.Sin(-rad), ny = -Mathf.Cos(-rad);
            float sx2 = nx > 0f ? (rect.width - 14f - cx + rect.x) / nx : nx < 0f ? (14f - cx + rect.x) / nx : float.PositiveInfinity;
            float sy2 = ny > 0f ? (rect.height - 14f - cy + rect.y) / ny : ny < 0f ? (14f - cy + rect.y) / ny : float.PositiveInfinity;
            float rim = Mathf.Min(sx2, sy2);
            var nstyle = new GUIStyle(_label) { fontSize = 13, alignment = TextAnchor.MiddleCenter };
            GUI.Label(new Rect(cx + nx * rim - 10f, cy + ny * rim - 10f, 20f, 20f), "N", nstyle);

            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(new Rect(rect.x - 3f, rect.y - 3f, 3f, rect.height + 6f), Texture2D.whiteTexture);
            GUI.DrawTexture(new Rect(rect.xMax, rect.y - 3f, 3f, rect.height + 6f), Texture2D.whiteTexture);
            GUI.color = Color.white;
        }

        void DrawFullMap()
        {
            GUI.color = new Color(0.02f, 0.03f, 0.05f, 0.9f);
            GUI.DrawTexture(new Rect(0f, 0f, Screen.width, Screen.height), Texture2D.whiteTexture);
            GUI.color = Color.white;

            float maxW = Screen.width - 120f;
            float maxH = Screen.height - 120f;
            float scale = Mathf.Min(maxW / _map.width, maxH / _map.height);
            float mw = _map.width * scale;
            float mh = _map.height * scale;
            Rect r = new Rect((Screen.width - mw) * 0.5f, (Screen.height - mh) * 0.5f, mw, mh);
            GUI.DrawTexture(r, _map, ScaleMode.StretchToFill, true);

            GUI.Label(new Rect(28f, 20f, 600f, 40f), "LEONIDA  ·  MAP", _title);
            GUI.Label(new Rect(28f, Screen.height - 40f, 900f, 24f), "M / Esc: close    1-7: teleport", _label);

            if (_manifest != null && _manifest.teleports != null)
            {
                float y = 66f;
                for (int i = 0; i < _manifest.teleports.Count; i++)
                {
                    GUI.Label(new Rect(28f, y, 500f, 22f), $"{i + 1}. {_manifest.teleports[i].name}", _label);
                    y += 24f;
                }
            }
        }

        void DrawHint()
        {
            var hint = new GUIStyle(_label) { fontSize = 13 };
            hint.normal.textColor = new Color(1f, 1f, 1f, 0.75f);
            GUI.Label(new Rect(20f, Screen.height - 32f, 1100f, 22f),
                "M: map    1-7: teleport    WASD/QE: fly    right mouse: look", hint);
        }

        void Teleport(int index)
        {
            if (_manifest == null || _manifest.teleports == null || index < 0 || index >= _manifest.teleports.Count) return;
            var t = _manifest.teleports[index];
            if (_cam == null) return;

            _cam.transform.position = new Vector3(t.x, t.z, -t.y);
            float h = t.heading * Mathf.Deg2Rad;
            float p = t.pitch * Mathf.Deg2Rad;
            Vector3 forward = new Vector3(Mathf.Sin(h) * Mathf.Cos(p), Mathf.Sin(p), -Mathf.Cos(h) * Mathf.Cos(p));
            _cam.transform.rotation = Quaternion.LookRotation(forward, Vector3.up);
            var fly = _cam.GetComponent<FlyCamera>();
            if (fly != null) fly.SetViewFromTransform();
            _mapOpen = false;
        }
    }
}
