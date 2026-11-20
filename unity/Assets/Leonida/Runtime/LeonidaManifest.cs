using System;
using System.Collections.Generic;

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
}
