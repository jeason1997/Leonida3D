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
        public bool IsOpen => _mapOpen;
        readonly Dictionary<string, Texture2D> _tiles = new Dictionary<string, Texture2D>();
        public void SetOpen(bool open) { _mapOpen = open; LeonidaCursor.UiOpen = open; if (open) LeonidaCursor.Unlock(); }
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
            if (kb.rKey.wasPressedThisFrame) { _radarFlip = !_radarFlip; _radarLastW = 0; }
            LeonidaCursor.UiOpen = _mapOpen;
            if (_mapOpen) LeonidaCursor.Unlock();

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
        bool _radarFlip = true;
        Vector2? _waypoint;
        Rect _mapRect;
        Texture2D _radarTex;
        Color32[] _radarPixels;
        Vector3 _radarLastPos;
        float _radarLastHeading;
        int _radarLastW, _radarLastH;

        void DrawRadar(Rect rect)
        {
            if (Event.current != null && Event.current.type != EventType.Repaint) return;
            Vector3 p = _cam.transform.position;
            float camNorth = -p.z;
            Vector3 fwd = _cam.transform.forward;
            float heading = Mathf.Atan2(fwd.x, -fwd.z) * Mathf.Deg2Rad;
            float mpp = Mathf.Clamp(1.6f + Mathf.Max(0f, p.y) / 110f, 1.6f, 40f);

            int w = Mathf.Max(64, Mathf.RoundToInt(rect.width));
            int h = Mathf.Max(48, Mathf.RoundToInt(rect.height));
            if (_radarTex == null || _radarTex.width != w || _radarTex.height != h)
            {
                _radarTex = new Texture2D(w, h, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point };
                _radarPixels = new Color32[w * h];
            }

            bool dirty = _radarLastW != w || _radarLastH != h
                      || (p - _radarLastPos).sqrMagnitude > 0.25f
                      || Mathf.Abs(Mathf.DeltaAngle(_radarLastHeading, heading * Mathf.Rad2Deg)) > 0.5f;
            if (dirty)
            {
                _radarLastPos = p;
                _radarLastHeading = heading * Mathf.Rad2Deg;
                _radarLastW = w; _radarLastH = h;

            Color32 water = new Color32(35, 64, 86, 255);
            float cx = w * 0.5f, cy = h * 0.62f;
            float rh = heading * (_radarFlip ? -1f : 1f);
            float sin = Mathf.Sin(rh), cos = Mathf.Cos(rh);
            float mapW = Mathf.Max(1f, _x1 - _x0), mapH = Mathf.Max(1f, _y1 - _y0);
            float C = _manifest != null ? _manifest.chunk : 2048f;
            float west = _manifest != null ? _manifest.west : _x0;
            float north = _manifest != null ? _manifest.north : _y1;

            for (int y = 0; y < h; y++)
            {
                float dy = y - cy;
                for (int x = 0; x < w; x++)
                {
                    float dx = x - cx;
                    // screen up = camera forward; right = camera right
                    float east = dx * cos - dy * sin;
                    float northM = -dx * sin - dy * cos;
                    float mapX = p.x + east * mpp;
                    float mapNorth = camNorth + northM * mpp;
                    float u = (mapX - _x0) / mapW;
                    float v = (mapNorth - _y0) / mapH;
                    if (u < 0f || u > 1f || v < 0f || v > 1f)
                    {
                        _radarPixels[y * w + x] = water;
                        continue;
                    }

                    int ti = Mathf.FloorToInt((mapX - west) / C);
                    int tj = Mathf.FloorToInt((north - mapNorth) / C);
                    if (_tiles.TryGetValue($"{ti}_{tj}", out var tile) && tile != null)
                    {
                        float tu = (mapX - (west + ti * C)) / C;
                        float tv = (mapNorth - (north - (tj + 1) * C)) / C;
                        _radarPixels[y * w + x] = tile.GetPixelBilinear(tu, tv);
                    }
                    else _radarPixels[y * w + x] = water;
                }
            }

            _radarTex.SetPixels32(_radarPixels);
            _radarTex.Apply(false);
            }
            GUI.DrawTexture(rect, _radarTex, ScaleMode.StretchToFill, false);

            // Player arrow stays up; the map image itself is already heading-up.
            float scx = rect.x + rect.width * 0.5f;
            float scy = rect.y + rect.height * 0.62f;
            var arrow = new GUIStyle(_label) { fontSize = 20, alignment = TextAnchor.MiddleCenter };
            GUI.Label(new Rect(scx - 14f, scy - 14f, 28f, 28f), "\u25B2", arrow);

            // N on the rim, where north currently is.
            float nh = heading * (_radarFlip ? -1f : 1f);
            float nx = Mathf.Sin(-nh), ny = -Mathf.Cos(-nh);
            float cw = rect.width * 0.5f, chh = rect.height * 0.62f;
            float sx2 = nx > 0f ? (rect.width - 12f - cw) / nx : nx < 0f ? (12f - cw) / nx : float.PositiveInfinity;
            float sy2 = ny > 0f ? (rect.height - 12f - chh) / ny : ny < 0f ? (12f - chh) / ny : float.PositiveInfinity;
            float rim = Mathf.Min(sx2, sy2);
            var nstyle = new GUIStyle(_label) { fontSize = 13, alignment = TextAnchor.MiddleCenter };
            GUI.Label(new Rect(scx + nx * rim - 10f, scy + ny * rim - 10f, 20f, 20f), "N", nstyle);

            if (_waypoint.HasValue)
            {
                float we = _waypoint.Value.x - p.x;
                float wn = _waypoint.Value.y - camNorth;
                float wh = heading * (_radarFlip ? -1f : 1f);
                float wdx = we * Mathf.Cos(wh) - wn * Mathf.Sin(wh);
                float wdy = -we * Mathf.Sin(wh) - wn * Mathf.Cos(wh);
                float wx = Mathf.Clamp(scx + wdx / mpp, rect.x + 8f, rect.xMax - 8f);
                float wy = Mathf.Clamp(scy + wdy / mpp, rect.y + 8f, rect.yMax - 8f);
                var wstyle = new GUIStyle(_label) { fontSize = 18, alignment = TextAnchor.MiddleCenter };
                GUI.color = new Color(1f, 0.85f, 0.2f);
                GUI.Label(new Rect(wx - 10f, wy - 10f, 20f, 20f), "\u25C6", wstyle);
                GUI.color = Color.white;
            }
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(new Rect(rect.x - 3f, rect.y - 3f, rect.width + 6f, 3f), Texture2D.whiteTexture);
            GUI.DrawTexture(new Rect(rect.x - 3f, rect.yMax, rect.width + 6f, 3f), Texture2D.whiteTexture);
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
            _mapRect = r;
            GUI.DrawTexture(r, _map, ScaleMode.StretchToFill, true);

            var ev = Event.current;
            if (ev != null && ev.type == EventType.MouseDown && r.Contains(ev.mousePosition))
            {
                float mx = Mathf.Lerp(_x0, _x1, (ev.mousePosition.x - r.x) / r.width);
                float mn = Mathf.Lerp(_y1, _y0, (ev.mousePosition.y - r.y) / r.height);
                if (ev.button == 0) _waypoint = new Vector2(mx, mn);
                else if (ev.button == 1) _waypoint = null;
            }
            if (_waypoint.HasValue)
            {
                float wx = r.x + Mathf.InverseLerp(_x0, _x1, _waypoint.Value.x) * r.width;
                float wy = r.y + Mathf.InverseLerp(_y1, _y0, _waypoint.Value.y) * r.height;
                var wstyle = new GUIStyle(_label) { fontSize = 20, alignment = TextAnchor.MiddleCenter };
                GUI.color = new Color(1f, 0.85f, 0.2f);
                GUI.Label(new Rect(wx - 10f, wy - 10f, 20f, 20f), "\u25C6", wstyle);
                GUI.color = Color.white;
            }

            GUI.Label(new Rect(28f, 20f, 600f, 40f), "LEONIDA  \u00b7  MAP", _title);
            GUI.Label(new Rect(28f, Screen.height - 40f, 900f, 24f), "M / Esc: close    1-7: teleport    click: waypoint    right click: clear", _label);

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
                "M: map    1-7: teleport    R: flip radar    WASD/QE: fly", hint);
        }

        void Teleport(int index)
        {
            if (_manifest == null || _manifest.teleports == null || index < 0 || index >= _manifest.teleports.Count) return;
            var t = _manifest.teleports[index];
            if (_cam == null) return;
            var modes = _cam.GetComponent<LeonidaPlayerModes>();
            if (modes != null) modes.SetMode(LeonidaPlayerModes.Mode.Fly);

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
