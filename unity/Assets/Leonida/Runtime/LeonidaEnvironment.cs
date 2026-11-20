using UnityEngine;

namespace Leonida
{
    /// <summary>Sky/environment setup shared by the editor scene and player builds.</summary>
    public class LeonidaEnvironment : MonoBehaviour
    {
        public Camera cam;
        public Light sun;

        void Start()
        {
            Init(cam, sun);
        }

        public void Init(Camera cam, Light sun)
        {
            var sky = Resources.Load<Material>("LeonidaSky");
            if (sky == null)
            {
                Debug.LogWarning("Leonida: Resources/LeonidaSky.mat missing");
                return;
            }

            RenderSettings.skybox = sky;
            if (cam != null)
            {
                cam.clearFlags = CameraClearFlags.Skybox;
            }
            if (sun != null)
            {
                // A directional light points along the rays; the visible sun is opposite.
                sky.SetVector("_SunDir", -sun.transform.forward);
            }
            DynamicGI.UpdateEnvironment();
        }
    }
}
