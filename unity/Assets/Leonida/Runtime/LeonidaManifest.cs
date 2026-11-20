using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Leonida
{
    [Serializable]
    public class LeonidaManifest
    {
        public int chunk;
        public int nx;
        public int ny;
        public float west;
        public float north;
        public LeonidaTerrainInfo terrain;
        public List<string> ao;
        public List<string> details;
        public LeonidaMinimapInfo minimap;
        public List<LeonidaLandmark> landmarks;
        public List<LeonidaTeleport> teleports;
        public LeonidaSpawn spawn;
        public LeonidaVegInfo veg;
    }

    [Serializable]
    public class LeonidaTerrainInfo
    {
        public List<string> near;
        public List<string> colors;
        public string far;
        public int far_n;
        public int near_n;
        public LeonidaHeightInfo height16;
    }

    [Serializable]
    public class LeonidaHeightInfo
    {
        public string file;
        public int w;
        public int h;
        public int cell;
    }

    [Serializable]
    public class LeonidaMinimapInfo
    {
        public float res;
        public int n;
        public List<string> tiles;
        public string water;
    }

    [Serializable]
    public class LeonidaLandmark
    {
        public string id;
        public string name;
        public string file;
        public float x;
        public float y;
        public float z;
        public float rot;
    }

    [Serializable]
    public class LeonidaTeleport
    {
        public string name;
        public float x;
        public float y;
        public float z;
        public float heading;
        public float pitch;
    }

    [Serializable]
    public class LeonidaSpawn
    {
        public float x;
        public float y;
        public float z;
        public float heading;
    }

    /// <summary>
    /// Manifest "veg" block: one entry per vegetation variant (palms, pines, oaks, shrubs, grass)
    /// plus the billboard atlas. Mirrors the JS viewer's world.m.veg.
    /// </summary>
    [Serializable]
    public class LeonidaVegInfo
    {
        public List<LeonidaVegVariant> variants;
        public string atlas;

        /// <summary>
        /// Per-variant instance counts per vegetation chunk, keyed "i_j".
        /// JsonUtility cannot deserialize veg.chunks (string -> int[] object), so this field is
        /// filled by <see cref="LeonidaVegChunkCounts.Parse"/> from the raw manifest JSON.
        /// </summary>
        [NonSerialized] public Dictionary<string, int[]> chunkCounts;
    }

    [Serializable]
    public class LeonidaVegVariant
    {
        public string name;
        public string kind;
        public LeonidaVegImp imp;
    }

    /// <summary>Billboard impostor metadata (uv rect, world width/height, base offset).</summary>
    [Serializable]
    public class LeonidaVegImp
    {
        public float[] uv;
        public float w;
        public float h;
        public float @base;
    }

    /// <summary>
    /// Parses the "veg.chunks" object out of the raw manifest text. JsonUtility support for
    /// dictionaries is missing, so a regex over "i_j":[n,n,...] entries is used instead. Keys of
    /// that shape only occur inside veg.chunks (ao / details / minimap.tiles are string arrays).
    /// </summary>
    public static class LeonidaVegChunkCounts
    {
        static readonly Regex ChunkPattern = new Regex(
            "\"(\\d+)_(\\d+)\"\\s*:\\s*\\[([0-9,\\s]*)\\]",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        public static Dictionary<string, int[]> Parse(string manifestJson)
        {
            var result = new Dictionary<string, int[]>(StringComparer.Ordinal);
            if (string.IsNullOrEmpty(manifestJson)) return result;

            int vegIndex = manifestJson.IndexOf("\"veg\"", StringComparison.Ordinal);
            int searchFrom = vegIndex >= 0 ? vegIndex : 0;
            int chunksIndex = manifestJson.IndexOf("\"chunks\"", searchFrom, StringComparison.Ordinal);
            if (chunksIndex < 0) return result;

            string scope = manifestJson.Substring(chunksIndex);
            foreach (Match match in ChunkPattern.Matches(scope))
            {
                string key = match.Groups[1].Value + "_" + match.Groups[2].Value;
                string body = match.Groups[3].Value;
                var counts = new List<int>();
                if (!string.IsNullOrWhiteSpace(body))
                {
                    string[] parts = body.Split(',');
                    for (int i = 0; i < parts.Length; i++)
                    {
                        int value;
                        if (int.TryParse(parts[i].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
                            counts.Add(value);
                        else
                            counts.Add(0);
                    }
                }
                result[key] = counts.ToArray();
            }
            return result;
        }
    }
}
