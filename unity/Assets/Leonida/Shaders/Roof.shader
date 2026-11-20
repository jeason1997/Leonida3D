// Procedural Leonida roof: varied membrane/gravel/tar colours per building block,
// fine grain, Lambert lighting. Keeps the aerial view from reading as one grey mass.
Shader "Leonida/Roof"
{
    Properties
    {
        _BaseColor ("Base Color", Color) = (0.62, 0.60, 0.55, 1)
        _Night ("Night", Range(0, 1)) = 0
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
                float _Night;
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
                float2 uv         : TEXCOORD2;
                float2 uv1        : TEXCOORD3;
                float  fogFactor  : TEXCOORD4;
            };

            Varyings vert (Attributes v)
            {
                Varyings o;
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uv = v.uv;
                o.uv1 = v.uv1;
                o.fogFactor = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            float Hash21(float2 p)
            {
                return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
            }

            half4 frag (Varyings i) : SV_Target
            {
                float seed = frac(i.uv1.x);
                float style = floor(i.uv1.x);

                float3 tar    = lerp(float3(0.31, 0.31, 0.30), float3(0.43, 0.42, 0.39), frac(seed * 7.1));
                float3 gravel = lerp(float3(0.62, 0.59, 0.52), float3(0.48, 0.46, 0.42), frac(seed * 13.7));
                float3 white  = lerp(float3(0.78, 0.77, 0.72), float3(0.68, 0.67, 0.62), frac(seed * 21.3));
                float3 tile   = lerp(float3(0.66, 0.45, 0.34), float3(0.55, 0.38, 0.30), frac(seed * 5.3));

                // Per-building block: 18 m cells, so roofs vary over the skyline.
                float2 block = floor(i.positionWS.xz / 18.0);
                float r = Hash21(block);
                float3 c = gravel;
                if (r < 0.28) c = tar;
                else if (r < 0.62) c = white;
                else if (r < 0.72) c = tile;
                c = lerp(c, gravel, 0.25);

                // fine roof grain and drainage streaks
                float grain = Hash21(floor(i.positionWS.xz * 0.45));
                c *= 0.88 + 0.22 * grain;
                float streak = Hash21(float2(floor(i.positionWS.x * 1.3), 3.0));
                c *= 1.0 - 0.05 * streak;

                float3 N = normalize(i.normalWS);
                float4 shadowCoord = TransformWorldToShadowCoord(i.positionWS);
                Light mainLight = GetMainLight(shadowCoord);
                float ndl = saturate(dot(N, mainLight.direction));
                float shadow = max(mainLight.shadowAttenuation, 0.5);
                float3 ambient = max(SampleSH(N), float3(0.44, 0.46, 0.50));
                float3 lit = c * (ambient + mainLight.color * (ndl * 0.65 + 0.20) * shadow);
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
                float _Night;
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
