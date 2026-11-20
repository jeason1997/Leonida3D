using UnityEngine;
using UnityEngine.InputSystem;

namespace Leonida
{
    /// <summary>F1 fly / F2 walk / F3 drive / F4 plane. Walk and drive follow the terrain height.</summary>
    public class LeonidaPlayerModes : MonoBehaviour
    {
        public enum Mode { Fly, Walk, Drive, Plane }

        public Camera cam;
        public LeonidaTerrain terrain;
        public Mode mode = Mode.Fly;

        FlyCamera _fly;
        float _yaw, _pitch, _lookSens = 0.11f;
        float _carSpeed, _carYaw = 180f;
        Vector3 _carPos, _planePos;
        float _planeSpeed = 85f, _planePitch;
        GameObject _car, _plane;

        public string ModeName => mode switch
        {
            Mode.Walk => "WALK",
            Mode.Drive => "DRIVE",
            Mode.Plane => "PLANE",
            _ => "FLY"
        };

        public void Init(Camera camera, LeonidaTerrain t)
        {
            cam = camera;
            terrain = t;
            _fly = cam.GetComponent<FlyCamera>();
            SetMode(Mode.Fly);

            var args = System.Environment.GetCommandLineArgs();
            int mi = System.Array.IndexOf(args, "-mode");
            if (mi >= 0 && mi + 1 < args.Length)
            {
                string m = args[mi + 1].ToLowerInvariant();
                if (m == "walk") SetMode(Mode.Walk);
                else if (m == "drive") SetMode(Mode.Drive);
                else if (m == "plane") SetMode(Mode.Plane);
            }
        }

        void SetMode(Mode m)
        {
            mode = m;
            if (_fly != null) _fly.enabled = m == Mode.Fly;
            if (m == Mode.Fly && _fly != null) _fly.SetViewFromTransform();

            if (m == Mode.Drive && _car == null) _car = BuildCar();
            if (m == Mode.Plane && _plane == null) _plane = BuildPlane();
            if (_car != null) _car.SetActive(m == Mode.Drive);
            if (_plane != null) _plane.SetActive(m == Mode.Plane);

            if (m == Mode.Walk || m == Mode.Drive || m == Mode.Plane)
            {
                Vector3 e = cam.transform.eulerAngles;
                _pitch = e.x > 180f ? e.x - 360f : e.x;
                _yaw = e.y;
            }
            if (m == Mode.Drive) { _carYaw = _yaw; _carPos = cam.transform.position; _carPos.y = Ground(_carPos.x, -_carPos.z) + 0.55f; }
            if (m == Mode.Plane) { _planePitch = _pitch; _planePos = cam.transform.position; }
        }

        void Update()
        {
            if (LeonidaStartMenu.InputLocked) return;
            var kb = Keyboard.current;
            if (kb == null) return;

            if (kb.f1Key.wasPressedThisFrame) SetMode(Mode.Fly);
            else if (kb.f2Key.wasPressedThisFrame) SetMode(Mode.Walk);
            else if (kb.f3Key.wasPressedThisFrame) SetMode(Mode.Drive);
            else if (kb.f4Key.wasPressedThisFrame) SetMode(Mode.Plane);

            if (mode == Mode.Fly) return;

            Look();
            switch (mode)
            {
                case Mode.Walk: Walk(kb); break;
                case Mode.Drive: Drive(kb); break;
                case Mode.Plane: Plane(kb); break;
            }
        }

        void Look()
        {
            var mouse = Mouse.current;
            if (mouse == null || !mouse.rightButton.isPressed) return;
            Vector2 d = mouse.delta.ReadValue();
            _yaw += d.x * _lookSens;
            _pitch = Mathf.Clamp(_pitch - d.y * _lookSens, -80f, 80f);
        }

        float Ground(float x, float mapNorth)
        {
            if (terrain == null) return 0f;
            return terrain.HeightAt(x, mapNorth);
        }

        void Walk(Keyboard kb)
        {
            Vector3 p = cam.transform.position;
            float ground = Ground(p.x, -p.z);
            p.y = ground + 1.7f;

            Vector3 fwd = Quaternion.Euler(0f, _yaw, 0f) * Vector3.forward;
            Vector3 right = Quaternion.Euler(0f, _yaw, 0f) * Vector3.right;
            Vector3 dir = Vector3.zero;
            if (kb.wKey.isPressed) dir += fwd;
            if (kb.sKey.isPressed) dir -= fwd;
            if (kb.dKey.isPressed) dir += right;
            if (kb.aKey.isPressed) dir -= right;
            float speed = kb.leftShiftKey.isPressed ? 14f : 5.2f;
            if (dir.sqrMagnitude > 0.001f) p += dir.normalized * speed * Time.deltaTime;
            p.y = Ground(p.x, -p.z) + 1.7f;

            cam.transform.position = p;
            cam.transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
        }

        void Drive(Keyboard kb)
        {
            float throttle = (kb.wKey.isPressed ? 1f : 0f) - (kb.sKey.isPressed ? 1f : 0f);
            float steer = (kb.dKey.isPressed ? 1f : 0f) - (kb.aKey.isPressed ? 1f : 0f);
            _carSpeed += throttle * 18f * Time.deltaTime;
            _carSpeed -= _carSpeed * 0.55f * Time.deltaTime;
            _carSpeed = Mathf.Clamp(_carSpeed, -10f, 38f);
            _carYaw += steer * (14f + Mathf.Abs(_carSpeed) * 0.55f) * Time.deltaTime * Mathf.Sign(_carSpeed + 0.01f);

            Vector3 fwd = Quaternion.Euler(0f, _carYaw, 0f) * Vector3.forward;
            Vector3 p = _carPos + fwd * _carSpeed * Time.deltaTime;
            p.y = Ground(p.x, -p.z) + 0.55f;
            _carPos = p;
            cam.transform.position = p;
            _yaw = _carYaw;

            if (_car != null)
            {
                _car.transform.position = p + Vector3.up * 0.2f;
                _car.transform.rotation = Quaternion.Euler(0f, _carYaw, 0f);
            }

            Vector3 camPos = p - fwd * 9f + Vector3.up * 4.2f;
            camPos.y = Mathf.Max(camPos.y, Ground(camPos.x, -camPos.z) + 1.4f);
            cam.transform.position = camPos;
            cam.transform.rotation = Quaternion.LookRotation((p + fwd * 5f + Vector3.up * 1.2f) - camPos, Vector3.up);
        }

        void Plane(Keyboard kb)
        {
            float throttle = (kb.wKey.isPressed ? 1f : 0f) - (kb.sKey.isPressed ? 1f : 0f);
            _planeSpeed = Mathf.Clamp(_planeSpeed + throttle * 22f * Time.deltaTime, 35f, 160f);
            float pitch = (kb.sKey.isPressed && !kb.wKey.isPressed) ? -10f : (kb.wKey.isPressed && !kb.sKey.isPressed ? 8f : 0f);
            float bank = (kb.dKey.isPressed ? 1f : 0f) - (kb.aKey.isPressed ? 1f : 0f);
            _planePitch = Mathf.Lerp(_planePitch, pitch, 2f * Time.deltaTime);
            _yaw += bank * 28f * Time.deltaTime;

            Vector3 fwd = Quaternion.Euler(_planePitch, _yaw, -bank * 25f) * Vector3.forward;
            Vector3 p = _planePos + fwd * _planeSpeed * Time.deltaTime;
            p.y = Mathf.Max(p.y, Ground(p.x, -p.z) + 8f);
            _planePos = p;
            cam.transform.position = p;

            if (_plane != null)
            {
                _plane.transform.position = p;
                _plane.transform.rotation = Quaternion.LookRotation(fwd, Vector3.up) * Quaternion.Euler(0f, 0f, -bank * 25f);
            }

            Vector3 camPos = p - fwd * 13f + Vector3.up * 4f;
            cam.transform.position = camPos;
            cam.transform.rotation = Quaternion.LookRotation(p + fwd * 10f - camPos, Vector3.up);
        }

        GameObject BuildCar()
        {
            var root = new GameObject("PlayerCar");
            var mat = new Material(Shader.Find("Universal Render Pipeline/Lit")) { color = new Color(0.65f, 0.08f, 0.06f) };
            var body = GameObject.CreatePrimitive(PrimitiveType.Cube);
            body.transform.SetParent(root.transform, false);
            body.transform.localScale = new Vector3(2.0f, 0.7f, 4.2f);
            body.transform.localPosition = new Vector3(0f, 0.65f, 0f);
            body.GetComponent<Renderer>().sharedMaterial = mat;
            Destroy(body.GetComponent<Collider>());
            for (int i = 0; i < 4; i++)
            {
                var wheel = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                wheel.transform.SetParent(root.transform, false);
                wheel.transform.localScale = new Vector3(0.55f, 0.22f, 0.55f);
                wheel.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
                wheel.transform.localPosition = new Vector3(i % 2 == 0 ? -1.0f : 1.0f, 0.38f, i < 2 ? 1.35f : -1.35f);
                wheel.GetComponent<Renderer>().sharedMaterial = mat;
                Destroy(wheel.GetComponent<Collider>());
            }
            root.SetActive(false);
            return root;
        }

        GameObject BuildPlane()
        {
            var root = new GameObject("PlayerPlane");
            var mat = new Material(Shader.Find("Universal Render Pipeline/Lit")) { color = new Color(0.82f, 0.84f, 0.86f) };
            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            body.transform.SetParent(root.transform, false);
            body.transform.localScale = new Vector3(0.8f, 3.0f, 0.8f);
            body.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            body.GetComponent<Renderer>().sharedMaterial = mat;
            Destroy(body.GetComponent<Collider>());
            var wing = GameObject.CreatePrimitive(PrimitiveType.Cube);
            wing.transform.SetParent(root.transform, false);
            wing.transform.localScale = new Vector3(12f, 0.18f, 2.0f);
            wing.transform.localPosition = new Vector3(0f, 0f, 0.4f);
            wing.GetComponent<Renderer>().sharedMaterial = mat;
            Destroy(wing.GetComponent<Collider>());
            var tail = GameObject.CreatePrimitive(PrimitiveType.Cube);
            tail.transform.SetParent(root.transform, false);
            tail.transform.localScale = new Vector3(3.4f, 0.16f, 1.0f);
            tail.transform.localPosition = new Vector3(0f, 0.7f, -2.4f);
            tail.GetComponent<Renderer>().sharedMaterial = mat;
            Destroy(tail.GetComponent<Collider>());
            root.SetActive(false);
            return root;
        }
    }
}
