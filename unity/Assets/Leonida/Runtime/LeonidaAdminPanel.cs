using UnityEngine;
using UnityEngine.InputSystem;

namespace Leonida
{
    /// <summary>F8 admin panel: teleports, player mode, fog and fly speed.</summary>
    public class LeonidaAdminPanel : MonoBehaviour
    {
        Camera _cam;
        LeonidaManifest _manifest;
        LeonidaPlayerModes _modes;
        bool _open;
        public void SetOpen(bool open) { _open = open; }
        GUIStyle _label, _button, _title;

        public void Init(Camera cam, LeonidaManifest manifest, LeonidaPlayerModes modes)
        {
            _cam = cam;
            _manifest = manifest;
            _modes = modes;
        }

        void Update()
        {
            if (LeonidaStartMenu.InputLocked) return;
            var kb = Keyboard.current;
            if (kb != null && kb.f8Key.wasPressedThisFrame) _open = !_open;
        }

        void OnGUI()
        {
            if (!_open || LeonidaStartMenu.InputLocked) return;

            if (_title == null)
            {
                _title = new GUIStyle(GUI.skin.label) { fontSize = 22, fontStyle = FontStyle.Bold };
                _title.normal.textColor = Color.white;
                _label = new GUIStyle(GUI.skin.label) { fontSize = 14 };
                _label.normal.textColor = Color.white;
                _button = new GUIStyle(GUI.skin.button) { fontSize = 13 };
            }

            float w = 380f, h = 520f;
            Rect r = new Rect((Screen.width - w) * 0.5f, (Screen.height - h) * 0.5f, w, h);
            GUI.color = new Color(0f, 0f, 0f, 0.78f);
            GUI.DrawTexture(r, Texture2D.whiteTexture);
            GUI.color = Color.white;
            GUI.Label(new Rect(r.x + 18f, r.y + 12f, w - 36f, 30f), "ADMIN  /  F8", _title);

            float y = r.y + 54f;
            GUI.Label(new Rect(r.x + 18f, y, w - 36f, 20f), "TELEPORT", _label);
            y += 24f;
            if (_manifest != null && _manifest.teleports != null)
            {
                for (int i = 0; i < _manifest.teleports.Count && i < 7; i++)
                {
                    if (GUI.Button(new Rect(r.x + 18f, y, w - 36f, 26f), $"{i + 1}. {_manifest.teleports[i].name}", _button))
                        Teleport(i);
                    y += 29f;
                }
            }

            y += 8f;
            GUI.Label(new Rect(r.x + 18f, y, w - 36f, 20f), "PLAYER MODE", _label);
            y += 24f;
            float bw = (w - 36f - 18f) / 4f;
            string[] names = { "FLY", "WALK", "DRIVE", "PLANE" };
            for (int i = 0; i < 4; i++)
            {
                if (GUI.Button(new Rect(r.x + 18f + i * (bw + 6f), y, bw, 30f), names[i], _button))
                    _modes?.SetMode((LeonidaPlayerModes.Mode)i);
            }
            y += 44f;

            GUI.Label(new Rect(r.x + 18f, y, w - 36f, 20f), "FOG DENSITY", _label);
            y += 22f;
            RenderSettings.fogDensity = GUI.HorizontalSlider(new Rect(r.x + 18f, y, w - 36f, 20f), RenderSettings.fogDensity, 0.00002f, 0.00030f);
            y += 30f;

            var fly = _cam != null ? _cam.GetComponent<FlyCamera>() : null;
            if (fly != null)
            {
                GUI.Label(new Rect(r.x + 18f, y, w - 36f, 20f), $"FLY SPEED  {fly.moveSpeed:F0} m/s", _label);
                y += 22f;
                fly.moveSpeed = GUI.HorizontalSlider(new Rect(r.x + 18f, y, w - 36f, 20f), fly.moveSpeed, 20f, 600f);
                y += 34f;
            }

            if (GUI.Button(new Rect(r.x + 18f, r.yMax - 42f, w - 36f, 30f), "CLOSE", _button))
                _open = false;
        }

        void Teleport(int index)
        {
            if (_cam == null || _manifest == null || _manifest.teleports == null || index >= _manifest.teleports.Count) return;
            var t = _manifest.teleports[index];
            _modes?.SetMode(LeonidaPlayerModes.Mode.Fly);
            _cam.transform.position = new Vector3(t.x, t.z, -t.y);
            float h = t.heading * Mathf.Deg2Rad, p = t.pitch * Mathf.Deg2Rad;
            var fwd = new Vector3(Mathf.Sin(h) * Mathf.Cos(p), Mathf.Sin(p), -Mathf.Cos(h) * Mathf.Cos(p));
            _cam.transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
            var fly = _cam.GetComponent<FlyCamera>();
            if (fly != null) fly.SetViewFromTransform();
        }
    }
}
