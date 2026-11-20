// First-pass Leonida facade shader. Deliberately small and robust:
// procedural window grid from the facade UVs + Lambert lighting + optional night windows.
// The full six-style web port lives in git history; this gets the city readable first.
Shader "Leonida/Facade"
{
    Properties
    {
        _BaseColor ("Wall Color", Color) = (0.78, 0.74, 0.66, 1)
        _GlassColor ("Glass Color", Color) = (0.10, 0.18, 0.22, 1)
        _Night ("Night", Range(0, 1)) = 0
        _FloorHeight ("Floor Height", Float) = 3.2
        _BayWidth ("Bay Width", Float) = 3.0
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "Queue"="Geometry" }
        LOD 200

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }
            Cull Off
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _GlassColor;
                float _Night;
                float _FloorHeight;
                float _BayWidth;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
                float2 uv1        : TEXCOORD1;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float2 uvF        : TEXCOORD2;
                float2 uvS        : TEXCOORD3;
                float  fogFactor  : TEXCOORD4;
            };

            Varyings vert (Attributes v)
            {
                Varyings o;
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uvF = v.uv;
                o.uvS = v.uv1;
                o.fogFactor = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            float Hash21(float2 p)
            {
                return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
            }

            half4 frag (Varyings i) : SV_Target
            {
                float u = i.uvF.x;
                float z = 1.0 - i.uvF.y;
                float seed = frac(i.uvS.x);
                float style = floor(i.uvS.x);

                float floorH = max(_FloorHeight, 1.0);
                float bayW = max(_BayWidth, 1.0);
                float2 cell = float2(u / bayW, z / floorH);
                float2 f = frac(cell);

                float win = step(0.24, f.x) * (1.0 - step(0.76, f.x))
                          * step(0.30, f.y) * (1.0 - step(0.80, f.y));
                float frame = step(0.16, f.x) * (1.0 - step(0.84, f.x))
                            * step(0.24, f.y) * (1.0 - step(0.86, f.y)) - win;

                float3 baseCol = _BaseColor.rgb * (0.88 + 0.18 * frac(seed * 13.17));
                float3 glassCol = _GlassColor.rgb * (0.75 + 0.35 * frac(seed * 31.7));

                float3 albedo = baseCol;
                albedo = lerp(albedo, float3(0.82, 0.82, 0.80), saturate(frame));
                albedo = lerp(albedo, glassCol, saturate(win));

                // ground-floor shopfront / darker base
                float lobby = 1.0 - smoothstep(3.8, 4.6, z);
                albedo = lerp(albedo, baseCol * 0.55, lobby * 0.55);

                // simplistic style variation: style 0 is glassier; style 4/5 lighter bands
                if (style >= 0.5 && style < 1.5) albedo = lerp(albedo, albedo * 1.10, win);
                else if (style >= 3.5) albedo = lerp(albedo, baseCol * 1.08, saturate(win));

                float3 N = normalize(i.normalWS);
                float4 shadowCoord = TransformWorldToShadowCoord(i.positionWS);
                Light mainLight = GetMainLight(shadowCoord);
                float ndl = saturate(dot(N, mainLight.direction));
                float shadow = max(mainLight.shadowAttenuation, 0.5);
                float3 ambient = max(SampleSH(N), float3(0.42, 0.45, 0.50));
                float3 lit = albedo * (ambient + mainLight.color * (ndl * 0.65 + 0.20) * shadow);

                // night: random rooms light up
                float2 id = floor(cell);
                float rnd = Hash21(id);
                float litWin = win * step(0.72, rnd) * _Night;
                lit += float3(1.0, 0.78, 0.52) * litWin * 1.5;

                lit = MixFog(lit, i.fogFactor);
                return half4(lit, 1.0);
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode"="ShadowCaster" }
            Cull Off
            ZWrite On
            ZTest LEqual
            ColorMask 0

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex vertShadow
            #pragma fragment fragShadow
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _GlassColor;
                float _Night;
                float _FloorHeight;
                float _BayWidth;
            CBUFFER_END

            float3 _LightDirection;
            float3 _LightPosition;

            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct V { float4 positionCS : SV_POSITION; };

            V vertShadow (A v)
            {
                V o;
                float3 positionWS = TransformObjectToWorld(v.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(v.normalOS);
            #if defined(_CASTING_PUNCTUAL_LIGHT_SHADOW)
                float3 L = normalize(_LightPosition - positionWS);
            #else
                float3 L = _LightDirection;
            #endif
                o.positionCS = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, L));
            #if UNITY_REVERSED_Z
                o.positionCS.z = min(o.positionCS.z, o.positionCS.w * UNITY_NEAR_CLIP_VALUE);
            #else
                o.positionCS.z = max(o.positionCS.z, o.positionCS.w * UNITY_NEAR_CLIP_VALUE);
            #endif
                return o;
            }

            half4 fragShadow (V i) : SV_Target { return 0; }
            ENDHLSL
        }
    }
    FallBack "Universal Render Pipeline/Unlit"
}
