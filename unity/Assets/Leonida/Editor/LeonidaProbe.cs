using UnityEditor;
using UnityEngine;

public static class LeonidaProbe
{
    public static void Run()
    {
        Debug.Log($"LEONIDA_PROBE version={Application.unityVersion} target={EditorUserBuildSettings.activeBuildTarget}");
        Debug.Log($"LEONIDA_PROBE project={Application.dataPath}");
        Debug.Log("LEONIDA_PROBE_OK");
    }
}
