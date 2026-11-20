using UnityEngine;
using UnityEngine.InputSystem;

namespace Leonida
{
    /// <summary>Fly camera matching the web player: WASD + mouse look, E/Space up, Q/Ctrl down,
    /// wheel changes speed (30 m/s base, Shift x4), smoothed velocity, never below terrain.</summary>
    public class FlyCamera : MonoBehaviour
    {
        public float moveSpeed = 30f;
        public float boostMultiplier = 4f;
        public float lookSensitivity = 0.11f;
        public float minPitch = -85f;
        public float maxPitch = 85f;
        public LeonidaTerrain terrain;

        float _yaw;
        float _pitch;
        Vector3 _vel;

        void Start()
        {
            SetViewFromTransform();
        }

        public void SetViewFromTransform()
        {
            Vector3 e = transform.eulerAngles;
            _pitch = e.x > 180f ? e.x - 360f : e.x;
            _yaw = e.y;
            _vel = Vector3.zero;
        }

        void Update()
        {
            if (LeonidaStartMenu.InputLocked) return;
            LeonidaCursor.Update();

            var mouse = Mouse.current;
            if (mouse != null && Cursor.lockState == CursorLockMode.Locked)
            {
                Vector2 delta = mouse.delta.ReadValue();
                _yaw += delta.x * lookSensitivity;
                _pitch = Mathf.Clamp(_pitch + delta.y * lookSensitivity, minPitch, maxPitch);
                transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
            }

            if (mouse != null)
            {
                float scroll = mouse.scroll.ReadValue().y;
                if (Mathf.Abs(scroll) > 0.01f)
                    moveSpeed = Mathf.Clamp(moveSpeed * (scroll > 0 ? 1.25f : 0.8f), 2f, 2000f);
            }

            var kb = Keyboard.current;
            if (kb == null) return;

            Vector3 fwd = Quaternion.Euler(_pitch, _yaw, 0f) * Vector3.forward;
            Vector3 right = Quaternion.Euler(0f, _yaw, 0f) * Vector3.right;
            float f = (kb.wKey.isPressed || kb.upArrowKey.isPressed ? 1f : 0f) - (kb.sKey.isPressed || kb.downArrowKey.isPressed ? 1f : 0f);
            float r = (kb.dKey.isPressed || kb.rightArrowKey.isPressed ? 1f : 0f) - (kb.aKey.isPressed || kb.leftArrowKey.isPressed ? 1f : 0f);
            float u = (kb.eKey.isPressed || kb.spaceKey.isPressed ? 1f : 0f) - (kb.qKey.isPressed || kb.leftCtrlKey.isPressed ? 1f : 0f);
            Vector3 wish = fwd * f + right * r + Vector3.up * u;
            if (wish.sqrMagnitude > 1f) wish.Normalize();
            float speed = moveSpeed * (kb.leftShiftKey.isPressed || kb.rightShiftKey.isPressed ? boostMultiplier : 1f);
            wish *= speed;

            _vel = Vector3.Lerp(_vel, wish, 1f - Mathf.Exp(-6f * Time.deltaTime));
            transform.position += _vel * Time.deltaTime;

            if (terrain != null)
            {
                float g = terrain.HeightAt(transform.position.x, -transform.position.z);
                if (transform.position.y < g + 1.5f) transform.position = new Vector3(transform.position.x, g + 1.5f, transform.position.z);
            }
            transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
        }
    }
}
