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
        public void SetOpen(bool open) { _mapOpen = open; }
        GUIStyle _label;
        GUIStyle _title;

        public void Init(Camera cam, LeonidaManifest manifest)
        {
            _cam = cam;
            _manifest = manifest;
            _map = Resources.Load<Texture2D>("MapFull");
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
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(new Rect(rect.x - 3f, rect.y - 3f, rect.width + 6f, rect.height + 6f), Texture2D.whiteTexture);
            GUI.color = Color.white;

            Vector3 p = _cam.transform.position;
            float u = Mathf.InverseLerp(_x0, _x1, p.x);
            float v = Mathf.InverseLerp(_y0, _y1, -p.z);
            float uw = _radarMeters / Mathf.Max(1f, _x1 - _x0);
            float uh = _radarMeters / Mathf.Max(1f, _y1 - _y0);
            Rect uv = new Rect(u - uw * 0.5f, v - uh * 0.5f, uw, uh);

            Vector3 fwd = _cam.transform.forward;
            float heading = Mathf.Atan2(fwd.x, -fwd.z) * Mathf.Rad2Deg;

            GUIUtility.RotateAroundPivot(heading, rect.center);
            GUI.DrawTextureWithTexCoords(rect, _map, uv, true);
            GUIUtility.RotateAroundPivot(-heading, rect.center);

            // player arrow
            var arrow = new GUIStyle(_label) { fontSize = 22, alignment = TextAnchor.MiddleCenter };
            GUI.Label(new Rect(rect.center.x - 14f, rect.center.y - 14f, 28f, 28f), "▲", arrow);

            // N marker
            var n = new GUIStyle(_label) { fontSize = 13, alignment = TextAnchor.MiddleCenter };
            GUI.Label(new Rect(rect.x + 6f, rect.y + 4f, 30f, 22f), "N", n);
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
            GUI.color = new Color(0f, 0f, 0f, 0.8f);
            GUI.DrawTexture(new Rect(r.x - 2f, r.y - 2f, r.width + 4f, 2f), Texture2D.whiteTexture);
            GUI.color = Color.white;

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
