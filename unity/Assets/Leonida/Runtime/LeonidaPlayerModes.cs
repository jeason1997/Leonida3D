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
        public LeonidaManifest manifest;
        public Mode mode = Mode.Fly;

        FlyCamera _fly;
        float _yaw, _pitch, _lookSens = 0.11f;
        float _carSpeed, _carYaw = 180f;
        float _walkY, _walkVy;
        Vector3 _carPos, _planePos;
        float _planeSpeed = 60f, _planePitch, _planeYaw, _planeRoll, _planeThrottle = 0.65f, _planeSink;
        GameObject _car, _plane;

        public string ModeName => mode switch
        {
            Mode.Walk => "WALK",
            Mode.Drive => "DRIVE",
            Mode.Plane => "PLANE",
            _ => "FLY"
        };

        public void Init(Camera camera, LeonidaTerrain t, LeonidaManifest m = null)
        {
            cam = camera;
            terrain = t;
            manifest = m;
            _fly = cam.GetComponent<FlyCamera>();
            if (_fly != null) _fly.terrain = t;
            SetMode(Mode.Fly);

            var args = System.Environment.GetCommandLineArgs();
            int mi = System.Array.IndexOf(args, "-mode");
            if (mi >= 0 && mi + 1 < args.Length)
            {
                string modeArg = args[mi + 1].ToLowerInvariant();
                if (modeArg == "walk") SetMode(Mode.Walk);
                else if (modeArg == "drive") SetMode(Mode.Drive);
                else if (modeArg == "plane") SetMode(Mode.Plane);
            }
        }

        public void SetMode(Mode m)
        {
            mode = m;
            if (_fly != null) _fly.enabled = m == Mode.Fly;
            if (m == Mode.Fly && _fly != null) _fly.SetViewFromTransform();

            if (m == Mode.Drive && _car == null) _car = BuildCar();
            if (m == Mode.Plane && _plane == null) _plane = BuildPlane();
            if (_car != null) _car.SetActive(m == Mode.Drive);
            if (_plane != null) _plane.SetActive(m == Mode.Plane);

            if (m == Mode.Walk)
            {
                _walkY = Ground(cam.transform.position.x, -cam.transform.position.z) + 0.05f;
                _walkVy = 0f;
                _pitch = 0f;
            }
            if (m == Mode.Walk || m == Mode.Drive || m == Mode.Plane)
            {
                Vector3 e = cam.transform.eulerAngles;
                _pitch = e.x > 180f ? e.x - 360f : e.x;
                _yaw = e.y;
            }
            if (m == Mode.Drive)
            {
                _carYaw = _yaw;
                Vector3 from = cam.transform.position;
                float g = Ground(from.x, -from.z);
                if (from.y > g + 30f && manifest != null && manifest.teleports != null && manifest.teleports.Count > 3)
                {
                    var t = manifest.teleports[3]; // Vice Beach, open road
                    from = new Vector3(t.x, t.z, -t.y);
                }
                _carPos = from;
                _carPos.y = Ground(_carPos.x, -_carPos.z) + 0.55f;
            }
            if (m == Mode.Plane)
            {
                _planePitch = 0f; _planeYaw = _yaw; _planeRoll = 0f; _planeThrottle = 0.65f; _planeSink = 0f;
                _planeSpeed = 60f;
                _planePos = cam.transform.position;
                _planePos.y = Mathf.Max(_planePos.y, Ground(_planePos.x, -_planePos.z) + 150f);
            }
        }

        void Update()
        {
            if (LeonidaStartMenu.InputLocked) return;
            LeonidaCursor.Update();
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
            if (mouse == null || Cursor.lockState != CursorLockMode.Locked) return;
            Vector2 d = mouse.delta.ReadValue();
            _yaw += d.x * _lookSens;
            _pitch = Mathf.Clamp(_pitch + d.y * _lookSens, -80f, 80f);
        }

        float Ground(float x, float mapNorth)
        {
            if (terrain == null) return 0f;
            return terrain.HeightAt(x, mapNorth);
        }

        void Walk(Keyboard kb)
        {
            Vector3 p = cam.transform.position;
            p.x = p.x; p.z = p.z;
            Vector3 fwd = Quaternion.Euler(0f, _yaw, 0f) * Vector3.forward;
            Vector3 right = Quaternion.Euler(0f, _yaw, 0f) * Vector3.right;
            Vector3 dir = Vector3.zero;
            if (kb.wKey.isPressed || kb.upArrowKey.isPressed) dir += fwd;
            if (kb.sKey.isPressed || kb.downArrowKey.isPressed) dir -= fwd;
            if (kb.dKey.isPressed || kb.rightArrowKey.isPressed) dir += right;
            if (kb.aKey.isPressed || kb.leftArrowKey.isPressed) dir -= right;
            if (dir.sqrMagnitude > 1f) dir.Normalize();
            float speed = kb.leftShiftKey.isPressed ? 9f : 4.5f;
            Vector3 next = new Vector3(p.x, _walkY, p.z) + dir * (speed * Time.deltaTime);

            float ground = Ground(next.x, -next.z);
            _walkVy -= 9.81f * Time.deltaTime;
            _walkY += _walkVy * Time.deltaTime;
            if (_walkY <= ground) { _walkY = ground; _walkVy = 0f; }
            if (_walkY <= ground + 0.05f && kb.spaceKey.isPressed) _walkVy = 5.2f;

            cam.transform.position = new Vector3(next.x, _walkY + 1.65f, next.z);
            cam.transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
        }

        void Drive(Keyboard kb)
        {
            float throttle = kb.wKey.isPressed ? 1f : 0f;
            float brake = kb.sKey.isPressed ? 1f : 0f;
            float steer = (kb.aKey.isPressed ? 1f : 0f) - (kb.dKey.isPressed ? 1f : 0f);
            bool handbrake = kb.spaceKey.isPressed;

            if (throttle > 0f) _carSpeed += (_carSpeed < 0f ? 18f : 12f) * throttle * Time.deltaTime;
            if (brake > 0f) _carSpeed -= (_carSpeed > 0f ? 25f : 6f) * brake * Time.deltaTime;
            if (handbrake) _carSpeed *= Mathf.Exp(-2.5f * Time.deltaTime);
            if (throttle == 0f && brake == 0f) _carSpeed *= Mathf.Exp(-0.35f * Time.deltaTime);
            _carSpeed = Mathf.Clamp(_carSpeed, -12f, 60f);
            float turn = steer * Mathf.Min(Mathf.Abs(_carSpeed) / 6f, 1f) * (0.9f - 0.5f * Mathf.Min(Mathf.Abs(_carSpeed) / 60f, 1f));
            _carYaw -= turn * Mathf.Sign(_carSpeed + 0.001f) * Mathf.Rad2Deg * Time.deltaTime;

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
            const float G = 9.81f, V_MAX = 92f, THRUST = 13f, STALL = 30f, CRUISE = 60f;
            const float TURN = 0.85f, MAX_BANK = 0.75f, ROLL = 1.1f, PITCH_RATE = 0.9f;
            float drag = THRUST / (V_MAX * V_MAX);

            float planeTurn = (kb.aKey.isPressed ? 1f : 0f) - (kb.dKey.isPressed ? 1f : 0f);
            _yaw -= planeTurn * 28f * Time.deltaTime;
            float thr = (kb.wKey.isPressed ? 1f : 0f) - (kb.sKey.isPressed ? 1f : 0f);
            _planeThrottle = Mathf.Clamp01(_planeThrottle + thr * 0.6f * Time.deltaTime);

            float v = _planeSpeed;
            float auth = Mathf.Clamp((v - STALL * 0.5f) / (CRUISE - STALL * 0.5f), 0.15f, 1f);
            float dyaw = Mathf.DeltaAngle(_planeYaw, _yaw) * Mathf.Deg2Rad;
            float yawRate = Mathf.Clamp(dyaw * 2f, -TURN * auth, TURN * auth);
            _planeYaw += yawRate * Mathf.Rad2Deg * Time.deltaTime;

            float wantPitch = Mathf.Clamp(_pitch * Mathf.Deg2Rad, -1.2f, 1.2f);
            _planePitch += Mathf.Clamp((wantPitch - _planePitch) * 2.5f, -PITCH_RATE * auth, PITCH_RATE * auth) * Time.deltaTime;
            float bank = Mathf.Clamp(Mathf.Atan(v * yawRate / G), -MAX_BANK, MAX_BANK);
            _planeRoll += (bank - _planeRoll) * (1f - Mathf.Exp(-ROLL * Time.deltaTime));

            if (v < STALL)
            {
                float stall = Mathf.Clamp01(1f - v / STALL);
                _planePitch -= stall * 1.8f * Time.deltaTime;
                _planeSink += (stall * 16f - _planeSink) * (1f - Mathf.Exp(-1.5f * Time.deltaTime));
            }
            else _planeSink *= Mathf.Exp(-2f * Time.deltaTime);

            float a = THRUST * _planeThrottle - drag * v * v - G * Mathf.Sin(_planePitch);
            _planeSpeed = Mathf.Max(0f, v + a * Time.deltaTime);

            Vector3 fwd = Quaternion.Euler(_planePitch * Mathf.Rad2Deg, _planeYaw, -_planeRoll * Mathf.Rad2Deg) * Vector3.forward;
            Vector3 p = _planePos + fwd * (_planeSpeed * Time.deltaTime);
            p.y -= _planeSink * Time.deltaTime;
            float ground = Ground(p.x, -p.z) + 2f;
            if (p.y < ground) p.y = ground;
            _planePos = p;

            if (_plane != null)
            {
                _plane.transform.position = p;
                _plane.transform.rotation = Quaternion.LookRotation(fwd, Vector3.up) * Quaternion.Euler(0f, 0f, -_planeRoll * Mathf.Rad2Deg);
            }

            Vector3 camPos = p - fwd * 17f + Vector3.up * 4f;
            camPos.y = Mathf.Max(camPos.y, Ground(camPos.x, -camPos.z) + 1.5f);
            cam.transform.position = camPos;
            cam.transform.rotation = Quaternion.LookRotation(p + fwd * 40f - camPos, Vector3.up);
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
