using UnityEngine;
using UnityEngine.InputSystem;

namespace Leonida
{
    /// <summary>Simple editor-friendly fly camera: right mouse drag to look, WASD + Q/E, Shift to boost.</summary>
    public class FlyCamera : MonoBehaviour
    {
        public float moveSpeed = 120f;
        public float boostMultiplier = 6f;
        public float lookSensitivity = 0.11f;
        public float minPitch = -85f;
        public float maxPitch = 85f;

        float _yaw;
        float _pitch;

        void Start()
        {
            SetViewFromTransform();
        }

        public void SetViewFromTransform()
        {
            Vector3 e = transform.eulerAngles;
            _pitch = e.x > 180f ? e.x - 360f : e.x;
            _yaw = e.y;
        }

        void Update()
        {
            if (LeonidaStartMenu.InputLocked) return;
            var kb = Keyboard.current;
            var mouse = Mouse.current;

            if (mouse != null && mouse.rightButton.isPressed)
            {
                Vector2 delta = mouse.delta.ReadValue();
                _yaw += delta.x * lookSensitivity;
                _pitch -= delta.y * lookSensitivity;
                _pitch = Mathf.Clamp(_pitch, minPitch, maxPitch);
                transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
            }

            if (kb == null) return;

            Vector3 dir = Vector3.zero;
            if (kb.wKey.isPressed) dir += transform.forward;
            if (kb.sKey.isPressed) dir -= transform.forward;
            if (kb.dKey.isPressed) dir += transform.right;
            if (kb.aKey.isPressed) dir -= transform.right;
            if (kb.eKey.isPressed) dir += Vector3.up;
            if (kb.qKey.isPressed) dir -= Vector3.up;

            if (dir.sqrMagnitude < 0.001f) return;

            float speed = moveSpeed;
            if (kb.leftShiftKey.isPressed || kb.rightShiftKey.isPressed) speed *= boostMultiplier;
            if (kb.leftCtrlKey.isPressed || kb.rightCtrlKey.isPressed) speed *= 0.25f;

            transform.position += dir.normalized * (speed * Time.unscaledDeltaTime);
        }
    }
}
