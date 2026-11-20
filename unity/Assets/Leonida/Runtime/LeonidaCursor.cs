using UnityEngine;
using UnityEngine.InputSystem;

namespace Leonida
{
    /// <summary>Click the view to capture the mouse, Esc to release. UI panels set UiOpen.</summary>
    public static class LeonidaCursor
    {
        public static bool UiOpen;

        public static void Update()
        {
            if (LeonidaStartMenu.InputLocked)
            {
                Unlock();
                return;
            }
            var kb = Keyboard.current;
            if (kb != null && kb.escapeKey.wasPressedThisFrame)
            {
                Unlock();
                return;
            }
            var m = Mouse.current;
            if (!UiOpen && m != null && m.leftButton.wasPressedThisFrame && Cursor.lockState != CursorLockMode.Locked)
                Lock();
        }

        public static void Lock()
        {
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }

        public static void Unlock()
        {
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }
    }
}
