// Faithful URP port of the web roof material (Reference/js/materials.js: ROOF_FRAG_COLOR).
// Roof kinds 0..4: membrane/gravel/tar/clay tile/metal, with AC-unit specs on flat roofs.
Shader "Leonida/Roof"
{
    Properties
    {
        _Night ("Night", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "Queue"="Geometry" }
        LOD 300

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

            half4 frag (Varyings input) : SV_Target
            {
                float st = floor(input.uvS.x);
                float seed = frac(input.uvS.x);
                float r1 = frac(seed * 13.17);
                float r2 = frac(seed * 71.31);
                float r3 = frac(seed * 191.7);
                float2 w = float2(input.uvF.x, 1.0 - input.uvF.y);
                float aa = max(max(abs(ddx(w.x)) + abs(ddy(w.x)), abs(ddx(w.y)) + abs(ddy(w.y))), 0.004);

                int kind = r1 < 0.45 ? 0 : (r1 < 0.75 ? 1 : 2);
                if (st == 0.0 || st == 1.0) kind = r1 < 0.65 ? 0 : 1;
                if (st == 2.0 || st == 3.0) kind = r2 < 0.4 ? 3 : (r1 < 0.6 ? 0 : 1);
                if (st == 5.0) kind = r1 < 0.65 ? 4 : 0;

                float3 col;
                float rough = 0.85;
                float metal = 0.0;
                float n = frac(sin(dot(floor(w * 3.0), float2(12.9898, 78.233)) + seed * 37.7) * 43758.5);

                if (kind == 0)
                {
                    col = lerp(float3(0.86, 0.87, 0.86), float3(0.74, 0.75, 0.74), r3);
                    float d = abs(frac(w.x / 1.8 + 0.5) - 0.5) * 1.8;
                    col *= 1.0 - 0.12 * clamp((0.04 - d) / aa + 0.5, 0.0, 1.0);
                    rough = 0.7;
                }
                else if (kind == 1)
                {
                    col = lerp(float3(0.60, 0.58, 0.54), float3(0.70, 0.68, 0.62), r3) * (0.9 + 0.2 * n);
                    rough = 0.95;
                }
                else if (kind == 2)
                {
                    col = lerp(float3(0.17, 0.17, 0.18), float3(0.25, 0.24, 0.23), r3);
                    rough = 0.7;
                }
                else if (kind == 3)
                {
                    float row = floor(w.y / 0.33);
                    float tile = frac(sin((floor(w.x / 0.28 + row * 0.5)) * 12.9898 + row * 78.233 + seed * 37.719) * 43758.5453);
                    col = lerp(float3(0.72, 0.36, 0.22), float3(0.80, 0.50, 0.32), tile * 0.8 + r3 * 0.2);
                    float gap = abs(frac(w.y / 0.33) - 0.5) * 0.33;
                    col *= 1.0 - 0.35 * clamp((0.03 - (0.165 - gap)) / aa + 0.5, 0.0, 1.0);
                    rough = 0.75;
                }
                else
                {
                    col = lerp(float3(0.80, 0.82, 0.83), float3(0.66, 0.70, 0.72), r3);
                    col *= 1.0 + 0.06 * sin(w.x * 6.2832 / 0.3) * clamp(1.0 - aa / 0.1, 0.0, 1.0);
                    rough = 0.4;
                    metal = 0.6;
                }

                // AC units / roof clutter: dark specks on flat roofs
                float cell = frac(sin(dot(floor(w / 7.0), float2(41.3, 289.1)) + seed) * 9871.3);
                float2 cf = frac(w / 7.0) - 0.5;
                if (kind != 3 && cell > 0.8 && max(abs(cf.x), abs(cf.y)) < 0.12) col *= 0.55;

                SurfaceData surfaceData = (SurfaceData)0;
                surfaceData.albedo = col;
                surfaceData.specular = half3(0.0, 0.0, 0.0);
                surfaceData.metallic = metal;
                surfaceData.smoothness = 1.0 - saturate(rough);
                surfaceData.normalTS = float3(0.0, 0.0, 1.0);
                surfaceData.emission = 0.0;
                surfaceData.occlusion = 1.0;
                surfaceData.alpha = 1.0;

                InputData inputData = (InputData)0;
                inputData.positionWS = input.positionWS;
                inputData.normalWS = normalize(input.normalWS);
                inputData.viewDirectionWS = GetWorldSpaceNormalizeViewDir(input.positionWS);
                inputData.shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                inputData.fogCoord = input.fogFactor;
                inputData.bakedGI = SampleSH(inputData.normalWS);
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS.xy);
                inputData.shadowMask = half4(1.0, 1.0, 1.0, 1.0);

                half4 color = UniversalFragmentPBR(inputData, surfaceData);
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
