using System.Collections;
using System.IO;
using UnityEngine;

namespace Leonida
{
    /// <summary>Optional player-only helper: wait for the world, capture a screenshot, quit.</summary>
    public class LeonidaScreenshot : MonoBehaviour
    {
        public string path;
        public float settleSeconds = 2f;
        public float timeoutSeconds = 180f;

        IEnumerator Start()
        {
            var args = System.Environment.GetCommandLineArgs();
            int idx = System.Array.IndexOf(args, "-screenshot");
            if (idx >= 0 && idx + 1 < args.Length) path = args[idx + 1];
            if (string.IsNullOrEmpty(path)) yield break;

            var boot = FindAnyObjectByType<LeonidaBootstrap>();
            float t = 0f;
            while (boot != null && !boot.Ready && t < timeoutSeconds)
            {
                t += Time.unscaledDeltaTime;
                yield return null;
            }
            yield return new WaitForSecondsRealtime(settleSeconds);

            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            ScreenCapture.CaptureScreenshot(path);
            Debug.Log($"LEONIDA_SCREENSHOT {path} ready={boot != null && boot.Ready}");
            yield return new WaitForSecondsRealtime(2f);
            Application.Quit();
        }
    }
}
