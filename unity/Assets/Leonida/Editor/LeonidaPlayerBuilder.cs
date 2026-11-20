using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Leonida.EditorTools
{
    public static class LeonidaPlayerBuilder
    {
        const string ScenePath = "Assets/Scenes/Leonida.unity";
        const string OutDir = "Build/Windows";
        const string ExePath = OutDir + "/Leonida.exe";

        [MenuItem("Leonida/Build Windows Player")]
        public static void BuildWindows()
        {
            Directory.CreateDirectory(OutDir);
            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = ExePath,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.Development,
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            Debug.Log($"LEONIDA_PLAYER_RESULT {report.summary.result} bytes={report.summary.totalSize} errors={report.summary.totalErrors}");
            if (report.summary.result != BuildResult.Succeeded)
            {
                EditorApplication.Exit(1);
            }
        }
    }
}
