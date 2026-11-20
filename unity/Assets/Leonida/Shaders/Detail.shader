// Faithful URP port of Reference/js/materials.js DETAIL_FRAG_HEAD + DETAIL_FRAG_COLOR.
// Vertex-coloured rooftop details, flat-shaded from derivatives; clay house roofs get tile
// courses, barrels, mottling and mildew streaks. No invented palette.
Shader "Leonida/Detail"
{
    Properties
    {
        _BaseColor ("Base Color", Color) = (1, 1, 1, 1)
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "Queue"="Geometry" }
        LOD 250

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

            TEXTURE2D(_AOTex); SAMPLER(sampler_AOTex);
            float4 _AORect;
            float AoAt(float2 mp)
            {
                float2 uv = float2((mp.x - _AORect.x) / _AORect.z, 1.0 - (_AORect.y - mp.y) / _AORect.w);
                if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
                return pow(SAMPLE_TEXTURE2D(_AOTex, sampler_AOTex, uv).r, 1.5);
            }

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float4 color      : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float4 color      : TEXCOORD2;
                float  fogFactor  : TEXCOORD3;
            };

            Varyings vert (Attributes v)
            {
                Varyings o;
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.color = v.color;
                o.fogFactor = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            float DHash(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
            float DNoise(float2 p)
            {
                float2 i = floor(p), f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(DHash(i), DHash(i + float2(1, 0)), f.x),
                            lerp(DHash(i + float2(0, 1)), DHash(i + float2(1, 1)), f.x), f.y);
            }

            half4 frag (Varyings i) : SV_Target
            {
                float3 wp = i.positionWS;
                float3 c = i.color.rgb * _BaseColor.rgb;
                c *= 0.94 + 0.08 * DHash(floor(wp.xz * 2.0));

                float3 fn = normalize(cross(ddx(wp), ddy(wp)));
                float ny = abs(fn.y);
                float slope = smoothstep(0.55, 0.7, ny) * (1.0 - smoothstep(0.95, 0.985, ny));
                float2 e = float2(-fn.z, fn.x) / max(length(fn.xz), 1e-4);
                float a = dot(wp.xz, e), b = wp.y;

                float clay = smoothstep(0.38, 0.5, (c.r - c.b) / max(c.r, 1e-3));
                float mott = DNoise(float2(a, b * 2.0) * 0.8) * 0.6 + DNoise(float2(a, b * 2.0) * 3.1) * 0.4;
                c *= 0.86 + 0.26 * mott;
                float streak = DNoise(float2(a * 1.4, b * 0.35 + 17.0));
                c = lerp(c, c * float3(0.66, 0.68, 0.64), smoothstep(0.55, 0.9, streak) * 0.55);

                float tb = b / 0.17, ta = a / 0.26;
                float fine = 1.0 - smoothstep(0.12, 0.35, max(fwidth(tb), fwidth(ta) * clay));
                float lip = 1.0 - smoothstep(0.0, 0.25, frac(tb));
                c *= 1.0 - 0.25 * lip * fine;
                c *= 1.0 - 0.2 * clay * fine * smoothstep(0.5, 1.0, abs(frac(ta) - 0.5) * 2.0);
                float h = DHash(float2(floor(ta), floor(tb)));
                c *= 1.0 + (h - 0.5) * 2.0 * lerp(0.06, 0.16, clay) * fine;
                c = lerp(i.color.rgb * _BaseColor.rgb, c, slope);

                SurfaceData surfaceData = (SurfaceData)0;
                surfaceData.albedo = c;
                surfaceData.metallic = 0.0;
                surfaceData.smoothness = 0.18;   // roughness 0.82 in the web material
                surfaceData.normalTS = float3(0.0, 0.0, 1.0);
                surfaceData.emission = 0.0;
                float ao = AoAt(float2(wp.x, -wp.z));
                ao = lerp(1.0, ao, 0.5);
                surfaceData.occlusion = ao;
                surfaceData.alpha = 1.0;

                InputData inputData = (InputData)0;
                inputData.positionWS = wp;
                float3 N = normalize(fn);
                if (N.y < 0.0) N = -N;
                inputData.normalWS = N;
                inputData.viewDirectionWS = GetWorldSpaceNormalizeViewDir(wp);
                inputData.shadowCoord = TransformWorldToShadowCoord(wp);
                inputData.fogCoord = i.fogFactor;
                inputData.bakedGI = SampleSH(N);
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(i.positionCS.xy);
                inputData.shadowMask = half4(1.0, 1.0, 1.0, 1.0);

                half4 color = UniversalFragmentPBR(inputData, surfaceData);
                color.rgb *= lerp(1.0, ao, 0.7);
                color.rgb = MixFog(color.rgb, inputData.fogCoord);
                return color;
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
