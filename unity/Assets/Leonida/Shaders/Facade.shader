// Leonida/Facade -- URP 17 (Unity 6) port of the web version's procedural building facade shader.
//
// Source of truth: Reference/js/materials.js -- FACADE_VERT_HEAD (95), FACADE_FRAG_HEAD (102) and
// FACADE_FRAG_COLOR (126). The web material is a patched THREE.MeshStandardMaterial: the GLSL block
// writes diffuseColor.rgb and the globals fRough / fMetal / fEmit, which the patch then feeds to
// roughnessFactor, metalnessFactor and totalEmissiveRadiance. Here the same block fills albedo /
// smoothness / metallic / emission of a URP SurfaceData.
//
// Vertex channel mapping is preserved exactly:
//   uv  (TEXCOORD0) -> vF : x = facade coordinate along the wall, y = 1 - height above ground
//   uv1 (TEXCOORD1) -> vS : x = style + seed, y = building height (1 - h)
//   uv2 (TEXCOORD2) -> vL : x = half length of the wall
//
// Notes:
//  * The two mutable GLSL globals (gAa, gSeed) become local/parameter values in HLSL; every helper
//    that used the seed gets it passed explicitly (math unchanged).
//  * LBOX / LRANGE / CUM stay macros and expand against the local gAa, exactly like the GLSL.
//  * nightAmount() is replaced by the material float _Night (0..1); fEmit is unaffected otherwise.
Shader "Leonida/Facade"
{
    Properties
    {
        _Night ("Night", Range(0, 1)) = 0.0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
            "UniversalMaterialType" = "Lit"
        }
        LOD 300

        // ------------------------------------------------------------------ forward lit
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Cull Back
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex FacadeVert
            #pragma fragment FacadeFrag

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float _Night;
            CBUFFER_END

            // ================================================================
            // Palettes (GLSL: const vec3 name[N] = vec3[N](...))
            // ================================================================
            static const float3 pastel[7] =
            {
                float3(0.98, 0.70, 0.73), float3(0.60, 0.89, 0.79), float3(0.99, 0.88, 0.56),
                float3(0.58, 0.81, 0.96), float3(0.84, 0.73, 0.94), float3(0.97, 0.95, 0.90),
                float3(0.99, 0.75, 0.57)
            };
            static const float3 accentP[5] =
            {
                float3(0.06, 0.60, 0.62), float3(0.95, 0.40, 0.44), float3(0.99, 0.77, 0.22),
                float3(0.18, 0.44, 0.86), float3(0.97, 0.97, 0.96)
            };
            static const float3 whites[5] =
            {
                float3(0.95, 0.94, 0.91), float3(0.94, 0.90, 0.81), float3(0.87, 0.88, 0.89),
                float3(0.86, 0.92, 0.92), float3(0.93, 0.87, 0.77)
            };
            static const float3 earth[6] =
            {
                float3(0.93, 0.85, 0.70), float3(0.96, 0.94, 0.89), float3(0.91, 0.71, 0.58),
                float3(0.97, 0.88, 0.62), float3(0.83, 0.79, 0.71), float3(0.80, 0.89, 0.80)
            };
            static const float3 greys[4] =
            {
                float3(0.71, 0.71, 0.69), float3(0.79, 0.75, 0.68), float3(0.63, 0.64, 0.67),
                float3(0.85, 0.84, 0.81)
            };
            static const float3 glassP[5] =
            {
                float3(0.13, 0.27, 0.31), float3(0.08, 0.16, 0.28), float3(0.18, 0.19, 0.21),
                float3(0.14, 0.24, 0.19), float3(0.24, 0.28, 0.34)
            };
            static const float3 metalP[5] =
            {
                float3(0.89, 0.90, 0.90), float3(0.77, 0.79, 0.81), float3(0.56, 0.66, 0.76),
                float3(0.83, 0.79, 0.69), float3(0.67, 0.73, 0.67)
            };
            static const float3 neonP[4] =
            {
                float3(1.00, 0.22, 0.72), float3(0.15, 0.95, 1.00), float3(0.62, 0.28, 1.00),
                float3(0.25, 0.55, 1.00)
            };

            // ================================================================
            // Distance-filtered box helpers. They expand against the local gAa
            // of FacadeColor(), exactly like the GLSL globals they replace.
            // ================================================================
            #define LBOX(x, h)        clamp(((h) - abs(x)) / gAa + 0.5, 0.0, 1.0)
            #define LRANGE(x, a, b)   (clamp(((x) - (a)) / gAa + 0.5, 0.0, 1.0) * clamp(((b) - (x)) / gAa + 0.5, 0.0, 1.0))
            #define CUM(x, P, a0, a1) (floor((x) / (P)) * ((a1) - (a0)) + clamp((x) - floor((x) / (P)) * (P) - (a0), 0.0, (a1) - (a0)))

            float LHASH(float a, float b, float seed)
            {
                return frac(sin(a * 12.9898 + b * 78.233 + seed * 37.719) * 43758.5453);
            }

            float vnoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = frac(sin(dot(i, float2(127.1, 311.7))) * 43758.5453);
                float b = frac(sin(dot(i + float2(1.0, 0.0), float2(127.1, 311.7))) * 43758.5453);
                float c = frac(sin(dot(i + float2(0.0, 1.0), float2(127.1, 311.7))) * 43758.5453);
                float d = frac(sin(dot(i + float2(1.0, 1.0), float2(127.1, 311.7))) * 43758.5453);
                return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
            }

            // ================================================================
            // The facade pattern (FACADE_FRAG_COLOR): writes albedo + fRough / fMetal / fEmit.
            // ================================================================
            void FacadeColor(float2 vF, float2 vS, float2 vL, float night,
                             out float3 albedoOut, out float roughOut, out float metalOut, out float3 emitOut)
            {
                float style = floor(vS.x);
                float gSeed = frac(vS.x);
                float seed = gSeed;
                float H = max(1.0 - vS.y, 3.0);
                float u = vF.x;
                float z = 1.0 - vF.y;
                float halfL = max(vL.x, 0.5);
                float gAa = max(max(abs(ddx(u)) + abs(ddy(u)), abs(ddx(z)) + abs(ddy(z))), 0.003);
                float aa = gAa;
                float r1 = frac(seed * 13.17);
                float r2 = frac(seed * 71.31);
                float r3 = frac(seed * 191.7);
                float3 wallC = whites[0];
                float3 glassC = glassP[0];
                float3 frameC = float3(0.85, 0.85, 0.83);
                float glass = 0.0, frame = 0.0, accent = 0.0, dark = 0.0, shade = 0.0, shop = 0.0;
                float glassMetal = 0.0, curtainOdds = 0.14;
                float3 accentC = accentP[(int)(r2 * 4.99)];
                float3 darkC = float3(0.06, 0.05, 0.05);
                float texAmt = 0.4, wallRough = 0.85, wallMetal = 0.0, floorH = 3.2, glassFrac = 0.4;
                float inner = 1.0, fi = 0.0, fz = 0.0, bi = 0.0, bx = 0.0, bayW = 3.0;
                int st = (int)style;

                if (st == 0)
                {
                    // glass curtain wall / office tower
                    floorH = 4.0; bayW = 1.5;
                    glassC = glassP[(int)(r1 * 4.99)];
                    frameC = lerp(float3(0.22, 0.24, 0.27), float3(0.75, 0.76, 0.78), r3);
                    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
                    float pane = LBOX(bx, bayW * 0.5 - 0.05) * LRANGE(fz, 0.12, floorH - 0.03);
                    float spandrel = pane * (1.0 - LRANGE(fz, 1.0, floorH + 1.0));
                    float lobby = 1.0 - clamp((z - 5.5) / aa + 0.5, 0.0, 1.0);
                    float cap = clamp((z - (H - 2.2)) / aa + 0.5, 0.0, 1.0);
                    glass = (pane - spandrel) * (1.0 - cap) + lobby * LBOX(bx, bayW * 0.5 - 0.06);
                    dark = spandrel * (1.0 - cap) * (1.0 - lobby); darkC = glassC * 0.55;
                    frame = 1.0 - glass - dark;
                    wallC = frameC; texAmt = 0.1; wallRough = 0.35; wallMetal = 0.8; glassFrac = 0.85;
                    glassMetal = 0.3; curtainOdds = 0.06;
                }
                else if (st == 1)
                {
                    // stucco apartment block with balconies
                    floorH = 3.2; bayW = 4.2;
                    wallC = whites[(int)(r1 * 4.99)]; glassC = glassP[(int)(r2 * 4.99)] * 0.6;
                    inner = LBOX(u, halfL - 1.2);
                    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
                    float body = LRANGE(z, 4.5, H - 1.2);
                    float balc = r3 > 0.3 ? 1.0 : 0.0;
                    float win = LBOX(bx, balc > 0.0 ? 1.75 : 1.1)
                              * LRANGE(fz, 0.3, floorH - (balc > 0.0 ? 0.25 : 0.7)) * inner * body;
                    float rail = LRANGE(fz, 0.3, 1.3) * inner * body * balc;
                    float slab = (1.0 - LRANGE(fz, 0.3, floorH + 1.0)) * body * inner * balc;
                    float lobby = (1.0 - clamp((z - 4.3) / aa + 0.5, 0.0, 1.0)) * LBOX(bx, 1.8) * inner
                                * LRANGE(z, 0.2, 9.0);
                    glass = clamp(win + lobby, 0.0, 1.0) * (1.0 - rail * 0.6);
                    frame = rail * 0.6; frameC = lerp(glassC * 2.2 + 0.18, float3(0.88, 0.92, 0.92), 0.45);
                    accent = slab; accentC = lerp(wallC, float3(0.98, 0.98, 0.97), 0.7);
                    shade = 0.5 * LRANGE(fz, floorH - 0.55, floorH + 1.0) * body * inner * balc;
                    shop = lobby; texAmt = 0.3; glassFrac = 0.55; curtainOdds = 0.3;
                }
                else if (st == 2)
                {
                    // pastel Deco block with fins, brows and awnings
                    floorH = 3.3; bayW = 3.2;
                    wallC = pastel[(int)(r1 * 6.99)]; glassC = float3(0.05, 0.08, 0.09);
                    inner = LBOX(u, halfL - 0.9);
                    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
                    float body = LRANGE(z, 3.6, H - 1.3);
                    float fin = LBOX(u, 0.75) * (halfL > 5.0 ? 1.0 : 0.0) * LRANGE(z, 3.6, H + 1.0);
                    float win = LBOX(bx, 0.65) * LRANGE(fz, 0.9, 2.5) * inner * body * (1.0 - fin);
                    float trim = LBOX(bx, 0.73) * LRANGE(fz, 0.82, 2.58) * inner * body * (1.0 - fin) - win;
                    float brow = LBOX(bx, 0.95) * LRANGE(fz, 2.68, 2.85) * inner * body * (1.0 - fin);
                    float browShade = LBOX(bx, 0.95) * LRANGE(fz, 2.2, 2.68) * inner * body * (1.0 - fin);
                    float store = LBOX(bx, 1.35) * LRANGE(z, 0.3, 3.0) * inner;
                    float awning = LRANGE(z, 3.0, 3.5) * inner;
                    float band = LRANGE(z, H - 1.05, H - 0.85);
                    float speed = (LRANGE(z, H - 2.05, H - 1.9) + LRANGE(z, H - 2.45, H - 2.3)
                                 + LRANGE(z, H - 2.85, H - 2.7)) * inner * (H > 7.0 ? 1.0 : 0.0);
                    float pilaster = (1.0 - LBOX(u, halfL - 0.55)) * LRANGE(z, 0.0, H - 0.85);
                    glass = win + store; shop = store;
                    frame = clamp(trim + pilaster, 0.0, 1.0); frameC = float3(0.97, 0.97, 0.95);
                    accent = clamp(fin + brow + awning * (0.5 + 0.5 * step(0.5, frac(u / 0.9)))
                                 + band + speed, 0.0, 1.0);
                    shade = 0.35 * browShade * (1.0 - smoothstep(2.2, 2.68, fz))
                          + 0.35 * LRANGE(z, 2.6, 3.0) * inner;
                    texAmt = 0.3; glassFrac = 0.25; curtainOdds = 0.25;
                }
                else if (st == 3)
                {
                    // earth-tone low-rise: punched windows, doors, cornice
                    floorH = 3.0; bayW = 3.8;
                    wallC = earth[(int)(r1 * 5.99)]; glassC = float3(0.05, 0.07, 0.08);
                    inner = LBOX(u, halfL - 1.0);
                    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
                    float colWin = step(0.28, LHASH(bi, 1.0, seed)); // GLSL: "float col"
                    float body = LRANGE(z, 0.0, H - 0.6);
                    float win = LBOX(bx, 0.55) * LRANGE(fz, 1.0, 2.3) * inner * body * colWin;
                    float trim = LBOX(bx, 0.63) * LRANGE(fz, 0.92, 2.38) * inner * body * colWin - win;
                    float door = LBOX(bx, 0.5) * LRANGE(z, 0.0, 2.2) * inner * (1.0 - colWin);
                    float cap = LRANGE(z, H - 0.45, H + 1.0);
                    glass = win; frame = clamp(trim + cap, 0.0, 1.0); frameC = float3(0.95, 0.95, 0.93);
                    dark = door; darkC = float3(0.18, 0.11, 0.07);
                    shade = 0.25 * LBOX(bx, 0.63) * LRANGE(fz, 2.3, 2.45) * inner * body * colWin;
                    texAmt = 0.4; glassFrac = 0.15; curtainOdds = 0.45;
                }
                else if (st == 4)
                {
                    // ribbed concrete with strip windows and shop fronts
                    floorH = 3.8; bayW = 1.6;
                    wallC = greys[(int)(r1 * 3.99)]; glassC = glassP[(int)(r2 * 4.99)];
                    inner = LBOX(u, halfL - 0.6);
                    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
                    float body = LRANGE(z, 4.5, H - 1.0);
                    float rib = LRANGE(fz, 1.0, 2.9) * inner * body;
                    float store = LRANGE(z, 0.2, 3.9) * inner;
                    float mull = 1.0 - LBOX(bx, bayW * 0.5 - 0.04);
                    float b2 = floor(u / (bayW * 2.0) + 0.5), x2 = u - b2 * bayW * 2.0;
                    float joint = (1.0 - LBOX(x2, bayW - 0.03)) * (1.0 - rib) * body;
                    glass = clamp(rib + store, 0.0, 1.0) * (1.0 - mull); shop = store * (1.0 - mull);
                    frame = clamp(rib + store, 0.0, 1.0) * mull; frameC = float3(0.3, 0.31, 0.32);
                    dark = joint * 0.5; darkC = wallC * 0.6;
                    shade = 0.3 * LRANGE(fz, 2.9, 3.15) * inner * body;
                    texAmt = 0.75; glassFrac = 0.4; curtainOdds = 0.1;
                }
                else
                {
                    // metal warehouse: ribs, roller door, clerestory, plinth
                    floorH = 6.0; bayW = 4.0;
                    wallC = metalP[(int)(r1 * 4.99)];
                    inner = LBOX(u, halfL - 2.0);
                    float rib = sin(u * 6.2832 / 0.2);
                    float ribFade = clamp(1.0 - aa / 0.08, 0.0, 1.0);
                    wallC *= 1.0 + 0.05 * rib * ribFade;
                    float bD = floor(u / 14.0 + 0.5), xD = u - bD * 14.0;
                    float door = LBOX(xD, 2.0) * LRANGE(z, 0.0, 4.2) * inner;
                    float slat = sin(z * 6.2832 / 0.15);
                    float b3 = floor(u / 3.0 + 0.5), x3 = u - b3 * 3.0;
                    float clere = LBOX(x3, 1.0) * LRANGE(z, H - 2.4, H - 1.4) * inner * (H > 7.0 ? 1.0 : 0.0);
                    float plinth = 1.0 - clamp((z - 1.0) / aa + 0.5, 0.0, 1.0);
                    dark = door; darkC = float3(0.32, 0.33, 0.34) * (1.0 + 0.12 * slat * ribFade);
                    frame = clere; frameC = float3(0.72, 0.78, 0.74);
                    accent = plinth * (1.0 - door); accentC = float3(0.45, 0.44, 0.42);
                    texAmt = 0.15; wallRough = 0.45; wallMetal = 0.55; glassFrac = 0.05;
                }

                // grain (procedural stand-in for the concrete scan), grime streaks, dirt at the foot
                float grainN = vnoise(float2(u, z) * 2.3) * 0.6 + vnoise(float2(u, z) * 9.0) * 0.4;
                float grainScalar = 0.82 + 0.36 * grainN;
                float3 grain = float3(grainScalar, grainScalar, grainScalar);
                float sx = u * 1.7, s0 = LHASH(floor(sx), 3.0, seed), s1 = LHASH(floor(sx) + 1.0, 3.0, seed);
                float streak = lerp(s0, s1, smoothstep(0.0, 1.0, frac(sx)));
                float grime = (1.0 - 0.10 * streak * clamp(1.0 - aa / 0.3, 0.0, 1.0))
                            * (1.0 - 0.15 * clamp(1.0 - z / 1.5, 0.0, 1.0));
                float3 wall = wallC * lerp(float3(1.0, 1.0, 1.0), grain, texAmt) * grime;
                float ph = LHASH(floor(u / max(bayW, 1.0) + 0.5), floor(z / floorH), seed);
                float3 paneC = glassC * (0.75 + 0.5 * ph);
                float curtain = step(1.0 - curtainOdds, ph);
                paneC = lerp(paneC, lerp(float3(0.62, 0.57, 0.48), float3(0.75, 0.75, 0.73), frac(ph * 7.0)) * 0.55,
                             curtain * 0.8);
                paneC = lerp(paneC, float3(0.55, 0.46, 0.33), clamp(shop, 0.0, 1.0) * 0.6);
                float3 col = wall;
                col = lerp(col, accentC, clamp(accent, 0.0, 1.0));
                col = lerp(col, frameC, clamp(frame, 0.0, 1.0));
                col = lerp(col, darkC, clamp(dark, 0.0, 1.0));
                col = lerp(col, paneC, clamp(glass, 0.0, 1.0));
                col *= 1.0 - clamp(shade, 0.0, 1.0);
                float g = clamp(glass, 0.0, 1.0);
                float paneRough = lerp(0.03 + 0.05 * ph, 0.85, clamp(curtain + shop, 0.0, 1.0));
                float fRough = lerp(lerp(wallRough, 0.5, clamp(frame + dark, 0.0, 1.0)), paneRough, g);
                float fMetal = lerp(wallMetal * (1.0 - clamp(accent, 0.0, 1.0)), glassMetal * (1.0 - curtain), g);

                // far: box-filtered window grid -> soft stripes -> the facade's mean
                float farMix = clamp((aa / floorH - 0.12) / 0.3, 0.0, 1.0);
                float zg0 = 0.3, zg1 = 2.95, gw = 3.2, colOdds = 1.0, bw = bayW;
                if (st == 0)      { zg0 = 1.0; zg1 = floorH - 0.03; gw = bayW - 0.1; }
                else if (st == 2) { zg0 = 0.9; zg1 = 2.5; gw = 1.3; }
                else if (st == 3) { zg0 = 1.0; zg1 = 2.3; gw = 1.1; colOdds = 0.72; }
                else if (st == 4) { zg0 = 1.0; zg1 = 2.9; gw = bayW - 0.08; }
                else if (st == 5) { zg0 = 0.0; zg1 = 0.0; gw = 0.0; bw = 4.0; }
                float hz = max(aa, 0.05) * 0.5;
                float covZ = (CUM(z + hz, floorH, zg0, zg1) - CUM(z - hz, floorH, zg0, zg1)) / (2.0 * hz);
                float ug = u + bw * 0.5, g0 = bw * 0.5 - gw * 0.5, g1 = bw * 0.5 + gw * 0.5;
                float covU = (CUM(ug + hz, bw, g0, g1) - CUM(ug - hz, bw, g0, g1)) / (2.0 * hz) * colOdds;
                float gcov = clamp(covZ * covU, 0.0, 1.0) * LRANGE(z, 4.0, H - 1.2) * LBOX(u, halfL - 0.8);
                float3 coarse = lerp(wallC, glassC * 1.1, gcov);
                col = lerp(col, coarse, farMix);
                fRough = lerp(fRough, lerp(wallRough, 0.12, glassFrac), farMix);
                fMetal = lerp(fMetal, lerp(wallMetal, glassMetal, glassFrac), farMix);

                // night: lit rooms, shop fronts, Deco neon, warehouse clerestories
                float3 fEmit = float3(0.0, 0.0, 0.0);
                float Night = saturate(night);
                if (Night > 0.001)
                {
                    float fiN = floor(z / floorH);
                    float biN = floor(u / max(bayW, 1.0) + 0.5);
                    float lh = LHASH(biN + 31.0, fiN + 17.0, seed);
                    float lh2 = frac(lh * 57.31);
                    bool work = (st == 0 || st == 4);
                    float lit = work ? step(0.45, LHASH(17.0, fiN + 3.0, seed)) * step(0.2, lh) : step(0.58, lh);
                    float3 warm = lerp(float3(1.0, 0.70, 0.40), float3(1.0, 0.85, 0.64), lh2);
                    float3 cool = lerp(float3(0.78, 0.88, 1.0), float3(0.95, 0.97, 1.0), lh2);
                    float3 roomC = work ? cool : (lh2 > 0.86 ? float3(0.45, 0.6, 1.0) : warm);
                    const float LEVEL = 0.65;
                    float3 emit = roomC * LEVEL * (0.6 + 0.8 * lh2) * (curtain > 0.5 ? 0.75 : 1.0) * lit * g;
                    emit += float3(1.0, 0.78, 0.52) * 1.6 * clamp(shop, 0.0, 1.0);
                    if (st == 2) emit += neonP[(int)(r3 * 3.99)] * 6.0 * clamp(accent, 0.0, 1.0) * (1.0 - g);
                    if (st == 5) emit += float3(1.0, 0.85, 0.6) * 1.2 * clamp(frame, 0.0, 1.0);
                    float lhc = LHASH(floor(biN / 2.0) + 71.0, fiN + 5.0, seed);
                    float share = clamp((lhc - 0.35) / 0.65, 0.0, 1.0); share *= share;
                    float3 roomCc = work ? float3(0.86, 0.92, 1.0)
                                         : lerp(float3(1.0, 0.72, 0.44), float3(1.0, 0.84, 0.62), frac(lhc * 31.7));
                    float bodyN = LRANGE(z, 4.0, H - 1.5);
                    float3 patchE = roomCc * LEVEL * share * glassFrac * bodyN;
                    float3 avgEmit = roomCc * LEVEL * 0.11 * glassFrac * bodyN;
                    emit = lerp(emit, patchE, clamp((aa / floorH - 0.3) / 0.3, 0.0, 1.0));
                    emit = lerp(emit, avgEmit, clamp((aa / floorH - 0.9) / 0.9, 0.0, 1.0));
                    fEmit = emit * Night * 2.5;
                }

                albedoOut = col;
                roughOut = fRough;
                metalOut = fMetal;
                emitOut = fEmit;
            }

            // ================================================================
            // Vertex / fragment
            // ================================================================
            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;   // vF
                float2 uv1        : TEXCOORD1;   // vS
                float2 uv2        : TEXCOORD2;   // vL
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float2 uvF        : TEXCOORD2;
                float2 uvS        : TEXCOORD3;
                float2 uvL        : TEXCOORD4;
                float  fogFactor  : TEXCOORD5;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            Varyings FacadeVert(Attributes input)
            {
                Varyings output = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);

                VertexPositionInputs positionInputs = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normalInputs = GetVertexNormalInputs(input.normalOS);

                output.positionCS = positionInputs.positionCS;
                output.positionWS = positionInputs.positionWS;
                output.normalWS = normalInputs.normalWS;
                output.uvF = input.uv;
                output.uvS = input.uv1;
                output.uvL = input.uv2;
                output.fogFactor = ComputeFogFactor(positionInputs.positionCS.z);
                return output;
            }

            half4 FacadeFrag(Varyings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);

                float3 positionWS = input.positionWS;
                half3 normalWS = normalize(input.normalWS);

                float3 albedo;
                float rough;
                float metal;
                float3 emission;
                FacadeColor(input.uvF, input.uvS, input.uvL, _Night, albedo, rough, metal, emission);

                SurfaceData surfaceData = (SurfaceData)0;
                surfaceData.albedo = albedo;
                surfaceData.specular = half3(0.0, 0.0, 0.0);
                surfaceData.metallic = metal;
                surfaceData.smoothness = 1.0 - saturate(rough);
                surfaceData.normalTS = float3(0.0, 0.0, 1.0);
                surfaceData.emission = emission;
                surfaceData.occlusion = 1.0;
                surfaceData.alpha = 1.0;
                surfaceData.clearCoatMask = 0.0;
                surfaceData.clearCoatSmoothness = 0.0;

                InputData inputData = (InputData)0;
                inputData.positionWS = positionWS;
                inputData.normalWS = normalWS;
                inputData.viewDirectionWS = GetWorldSpaceNormalizeViewDir(positionWS);
            #if defined(MAIN_LIGHT_CALCULATE_SHADOWS)
                inputData.shadowCoord = TransformWorldToShadowCoord(positionWS);
            #else
                inputData.shadowCoord = float4(0.0, 0.0, 0.0, 0.0);
            #endif
                inputData.fogCoord = input.fogFactor;
                inputData.vertexLighting = half3(0.0, 0.0, 0.0);
                inputData.bakedGI = SampleSH(normalWS);
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS.xy);
                inputData.shadowMask = half4(1.0, 1.0, 1.0, 1.0);

                half4 color = UniversalFragmentPBR(inputData, surfaceData);
                color.rgb = MixFog(color.rgb, inputData.fogCoord);
                color.a = 1.0;
                return color;
            }
            ENDHLSL
        }

        // ------------------------------------------------------------------ shadows
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }
            Cull Back
            ZWrite On
            ZTest LEqual
            ColorMask 0

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex FacadeShadowVert
            #pragma fragment FacadeShadowFrag

            #pragma multi_compile_instancing
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float _Night;
            CBUFFER_END

            float3 _LightDirection;
            float3 _LightPosition;

            struct ShadowAttributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct ShadowVaryings
            {
                float4 positionCS : SV_POSITION;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            float4 GetShadowPositionHClip(ShadowAttributes input)
            {
                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);

            #if defined(_CASTING_PUNCTUAL_LIGHT_SHADOW)
                float3 lightDirectionWS = normalize(_LightPosition - positionWS);
            #else
                float3 lightDirectionWS = _LightDirection;
            #endif

                float4 positionCS = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDirectionWS));

            #if UNITY_REVERSED_Z
                positionCS.z = min(positionCS.z, positionCS.w * UNITY_NEAR_CLIP_VALUE);
            #else
                positionCS.z = max(positionCS.z, positionCS.w * UNITY_NEAR_CLIP_VALUE);
            #endif
                return positionCS;
            }

            ShadowVaryings FacadeShadowVert(ShadowAttributes input)
            {
                ShadowVaryings output = (ShadowVaryings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                output.positionCS = GetShadowPositionHClip(input);
                return output;
            }

            half4 FacadeShadowFrag(ShadowVaryings input) : SV_Target
            {
                // opaque, no alpha clip
                return 0;
            }
            ENDHLSL
        }
    }

    FallBack "Universal Render Pipeline/Unlit"
}
