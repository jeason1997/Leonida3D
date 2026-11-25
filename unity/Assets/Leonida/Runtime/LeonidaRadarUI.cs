using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Leonida
{
    /// <summary>2D-canvas equivalent of the web minimap: masked panel, rotated RawImage tiles, fixed arrow.</summary>
    public class LeonidaRadarUI : MonoBehaviour
    {
        public Camera main;
        public LeonidaManifest manifest;
        public LeonidaMapUI map;

        Canvas _canvas;
        RectTransform _panel, _mapRoot;
        Text _arrow, _north, _waypoint;
        readonly List<RawImage> _tiles = new List<RawImage>();
        readonly List<Vector2> _tileMap = new List<Vector2>();
        readonly List<float> _tileSize = new List<float>();
        readonly List<string> _tileKeys = new List<string>();

        const float W = 260f, H = 190f;
        int _loadsThisFrame;

        public void Init(Camera cam, LeonidaManifest m, Dictionary<string, Texture2D> tiles, LeonidaMapUI owner)
        {
            main = cam; manifest = m; map = owner;

            var go = new GameObject("RadarCanvas");
            _canvas = go.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 40;

            var panelGo = new GameObject("RadarPanel");
            _panel = panelGo.AddComponent<RectTransform>();
            _panel.SetParent(go.transform, false);
            _panel.anchorMin = _panel.anchorMax = new Vector2(1f, 0f);
            _panel.pivot = new Vector2(1f, 0f);
            _panel.anchoredPosition = new Vector2(-16f, 16f);
            _panel.sizeDelta = new Vector2(W, H);
            var bg = panelGo.AddComponent<Image>();
            bg.color = new Color(0.14f, 0.25f, 0.34f, 0.96f);
            bg.raycastTarget = false;
            panelGo.AddComponent<RectMask2D>();

            var mapGo = new GameObject("RadarMap");
            _mapRoot = mapGo.AddComponent<RectTransform>();
            _mapRoot.SetParent(panelGo.transform, false);
            _mapRoot.anchorMin = _mapRoot.anchorMax = new Vector2(0.5f, 0.5f);
            _mapRoot.pivot = new Vector2(0.5f, 0.5f);
            _mapRoot.anchoredPosition = Vector2.zero;
            _mapRoot.sizeDelta = new Vector2(W, H);

            var keys = tiles != null && tiles.Count > 0 ? new List<string>(tiles.Keys) : new List<string>(m.minimap.tiles);
            foreach (string key in keys)
            {
                string[] p = key.Split('_');
                if (p.Length != 2 || !int.TryParse(p[0], out int i) || !int.TryParse(p[1], out int j)) continue;
                var tileGo = new GameObject("MM_" + key);
                var rt = tileGo.AddComponent<RectTransform>();
                rt.SetParent(_mapRoot, false);
                rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 0.5f);
                rt.pivot = new Vector2(0.5f, 0.5f);
                var raw = tileGo.AddComponent<RawImage>();
                raw.texture = tiles != null && tiles.TryGetValue(key, out var tex) ? tex : null;
                raw.raycastTarget = false;
                _tiles.Add(raw);
                _tileKeys.Add(key);
                _tileMap.Add(new Vector2(
                    m.west + i * m.chunk + m.chunk * 0.5f,
                    m.north - j * m.chunk - m.chunk * 0.5f));
                _tileSize.Add(m.chunk);
            }

            _arrow = MakeText(panelGo.transform, "\u25B2", 22, Color.white, TextAnchor.MiddleCenter);
            _arrow.rectTransform.sizeDelta = new Vector2(30f, 30f);
            _arrow.rectTransform.anchoredPosition = Vector2.zero;

            _north = MakeText(panelGo.transform, "N", 13, Color.white, TextAnchor.MiddleCenter);
            _north.rectTransform.sizeDelta = new Vector2(22f, 22f);

            _waypoint = MakeText(panelGo.transform, "\u25C6", 17, new Color(1f, 0.85f, 0.2f), TextAnchor.MiddleCenter);
            _waypoint.rectTransform.sizeDelta = new Vector2(22f, 22f);
            _waypoint.enabled = false;
        }

        Text MakeText(Transform parent, string text, int size, Color color, TextAnchor align)
        {
            var go = new GameObject("RadarText");
            var rt = go.AddComponent<RectTransform>();
            rt.SetParent(parent, false);
            rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.pivot = new Vector2(0.5f, 0.5f);
            var t = go.AddComponent<Text>();
            t.text = text;
            t.fontSize = size;
            t.color = color;
            t.alignment = align;
            t.raycastTarget = false;
            t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (t.font == null) t.font = Font.CreateDynamicFontFromOSFont("Arial", size);
            return t;
        }

        void LateUpdate()
        {
            if (_canvas == null || _panel == null || main == null || manifest == null) return;
            bool visible = map == null || (!map.Hidden && !map.IsOpen);
            if (LeonidaStartMenu.InputLocked) visible = false;
            _canvas.enabled = visible;
            if (!visible) return;

            float w = _panel.sizeDelta.x, h = _panel.sizeDelta.y;
            Vector3 p = main.transform.position;
            Vector3 fwd = main.transform.forward;
            float heading = Mathf.Atan2(fwd.x, -fwd.z) * Mathf.Rad2Deg;
            float mpp = Mathf.Clamp(1.6f + Mathf.Max(0f, p.y) / 110f, 1.6f, 40f);
            float camNorth = -p.z;

            float mapAngle = (map != null && !map.RadarFlip) ? -heading : heading;
            _loadsThisFrame = 0;
            _mapRoot.localRotation = Quaternion.Euler(0f, 0f, mapAngle);
            _mapRoot.sizeDelta = new Vector2(w, h);

            for (int k = 0; k < _tiles.Count; k++)
            {
                Vector2 mapPos = _tileMap[k];
                float size = _tileSize[k] / mpp;
                var rt = _tiles[k].rectTransform;
                rt.sizeDelta = new Vector2(size, size);
                Vector2 anchored = new Vector2((mapPos.x - p.x) / mpp, (mapPos.y - camNorth) / mpp);
                rt.anchoredPosition = anchored;
                bool inView = Mathf.Abs(anchored.x) < w * 0.75f && Mathf.Abs(anchored.y) < h * 0.75f;
                if (inView && _tiles[k].texture == null && _loadsThisFrame < 1)
                {
                    _tiles[k].texture = Resources.Load<Texture2D>("Minimap/mm_" + _tileKeys[k]);
                    _loadsThisFrame++;
                }
                _tiles[k].enabled = _tiles[k].texture != null && size > 0.5f;
            }

            float hrad = mapAngle * Mathf.Deg2Rad;
            float nx = -Mathf.Sin(hrad), ny = Mathf.Cos(hrad);
            float halfW = w * 0.5f - 12f, halfH = h * 0.5f - 12f;
            float rim = Mathf.Min(Mathf.Abs(nx) > 1e-4f ? halfW / Mathf.Abs(nx) : float.PositiveInfinity,
                                  Mathf.Abs(ny) > 1e-4f ? halfH / Mathf.Abs(ny) : float.PositiveInfinity);
            _north.rectTransform.anchoredPosition = new Vector2(nx * rim, ny * rim);

            if (map != null && map.Waypoint.HasValue)
            {
                Vector2 wp = map.Waypoint.Value;
                Vector2 off = new Vector2((wp.x - p.x) / mpp, (wp.y - camNorth) / mpp);
                off = new Vector2(off.x * Mathf.Cos(hrad) - off.y * Mathf.Sin(hrad),
                                  off.x * Mathf.Sin(hrad) + off.y * Mathf.Cos(hrad));
                float max = Mathf.Min(halfW, halfH) - 6f;
                if (off.magnitude > max) off = off.normalized * max;
                _waypoint.enabled = true;
                _waypoint.rectTransform.anchoredPosition = off;
            }
            else _waypoint.enabled = false;
        }
    }
}
