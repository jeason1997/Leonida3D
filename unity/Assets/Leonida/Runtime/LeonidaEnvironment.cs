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
            if (sky == null) sky = Resources.Load<Material>("ProceduralSky");
            if (sky == null)
            {
                Debug.LogWarning("Leonida: sky material missing");
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
            sky.SetFloat("_Turbidity", 3.2f);
            sky.SetFloat("_Rayleigh", 1.4f);
            sky.SetFloat("_MieCoefficient", 0.004f);
            sky.SetFloat("_MieDirectionalG", 0.8f);
            sky.SetVector("_Up", Vector3.up);
            sky.SetFloat("_Gain", 0.22f);
            sky.SetColor("_CloudLit", new Color(1.0f, 1.0f, 1.0f, 1f));
            sky.SetColor("_CloudShade", new Color(0.46f, 0.51f, 0.60f, 1f));
            sky.SetColor("_CloudGlow", Color.black);
            sky.SetFloat("_Warm", 0f);
            DynamicGI.UpdateEnvironment();
        }
    }
}
