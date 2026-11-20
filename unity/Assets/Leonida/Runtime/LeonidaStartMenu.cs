using UnityEngine;
using UnityEngine.InputSystem;

namespace Leonida
{
    /// <summary>Start screen: load in background, then PLAY. Blocks camera/map input until started.</summary>
    public class LeonidaStartMenu : MonoBehaviour
    {
        public static bool InputLocked;

        LeonidaBootstrap _boot;
        string _name = "Player";
        bool _started;
        GUIStyle _title, _sub, _label, _field, _button;

        public void Init(LeonidaBootstrap boot)
        {
            _boot = boot;
            InputLocked = true;
            LeonidaCursor.UiOpen = true;
            Cursor.visible = true;
            Cursor.lockState = CursorLockMode.None;
        }

        void Update()
        {
            var kb = Keyboard.current;
            if (!_started && _boot != null && _boot.Ready && kb != null &&
                (kb.enterKey.wasPressedThisFrame || kb.spaceKey.wasPressedThisFrame))
                StartGame();
        }

        void StartGame()
        {
            _started = true;
            InputLocked = false;
            LeonidaCursor.UiOpen = false;
        }

        void OnGUI()
        {
            if (_started) return;

            GUI.color = new Color(0f, 0f, 0f, 0.58f);
            GUI.DrawTexture(new Rect(0, 0, Screen.width, Screen.height), Texture2D.whiteTexture);
            GUI.color = Color.white;

            if (_title == null)
            {
                _title = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 64, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter,
                };
                _title.normal.textColor = new Color(1f, 0.93f, 0.78f);
                _sub = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 16, alignment = TextAnchor.MiddleCenter,
                };
                _sub.normal.textColor = new Color(0.9f, 0.95f, 1f);
                _label = new GUIStyle(GUI.skin.label) { fontSize = 16 };
                _label.normal.textColor = Color.white;
                _field = new GUIStyle(GUI.skin.textField) { fontSize = 18, alignment = TextAnchor.MiddleCenter };
                _button = new GUIStyle(GUI.skin.button) { fontSize = 26, fontStyle = FontStyle.Bold };
            }

            float cx = Screen.width * 0.5f;
            float y = Screen.height * 0.24f;
            GUI.Label(new Rect(cx - 420f, y, 840f, 90f), "LEONIDA 3D", _title);
            GUI.Label(new Rect(cx - 420f, y + 92f, 840f, 34f), "UNITY NATIVE PORT", _sub);

            GUI.Label(new Rect(cx - 150f, y + 170f, 120f, 30f), "NAME", _label);
            _name = GUI.TextField(new Rect(cx - 20f, y + 166f, 260f, 34f), _name, 20, _field);

            bool ready = _boot != null && _boot.Ready;
            GUI.enabled = ready;
            if (GUI.Button(new Rect(cx - 150f, y + 224f, 300f, 64f), ready ? "PLAY" : "LOADING...", _button))
                StartGame();
            GUI.enabled = true;

            if (_boot != null && !ready)
                GUI.Label(new Rect(cx - 420f, y + 300f, 840f, 30f), _boot.Status, _sub);

            GUI.Label(new Rect(cx - 600f, Screen.height - 52f, 1200f, 28f),
                "WASD move   Q/E height   click to look   M map   F1 fly / F2 walk / F3 drive / F4 plane", _sub);
        }
    }
}
