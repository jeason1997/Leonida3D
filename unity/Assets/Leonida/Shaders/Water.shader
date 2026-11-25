Shader "Leonida/Water"
{
    Properties
    {
        _ShallowColor ("Shallow Color", Color) = (0.10, 0.42, 0.52, 1)
        _DeepColor ("Deep Color", Color) = (0.015, 0.10, 0.20, 1)
        _NormalMap ("Normal Map", 2D) = "bump" {}
        _NormalStrength ("Normal Strength", Range(0, 2)) = 0.55
        _WaveScale ("Wave Scale", Float) = 0.012
        _Speed ("Scroll Speed", Float) = 0.035
        _Smoothness ("Smoothness", Range(0, 1)) = 0.94
        _SpecPower ("Specular Power", Range(8, 512)) = 220
        _SpecStrength ("Specular Strength", Range(0, 4)) = 1.4
        _WaveAmp ("Wave Amplitude", Range(0, 2)) = 1
        _WaveR ("Wave Radius", Float) = 3000
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "Queue"="Geometry" }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_NormalMap);
            SAMPLER(sampler_NormalMap);
            TEXTURE2D(_HeightTex);
            SAMPLER(sampler_HeightTex);
            float4 _HMap;

            CBUFFER_START(UnityPerMaterial)
                float4 _ShallowColor;
                float4 _DeepColor;
                float4 _NormalMap_ST;
                float _NormalStrength;
                float _WaveScale;
                float _Speed;
                float _Smoothness;
                float _SpecPower;
                float _SpecStrength;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float2 uv         : TEXCOORD2;
                float  fogFactor  : TEXCOORD3;
            };

            Varyings vert (Attributes v)
            {
                Varyings o;
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uv = v.uv;
                o.fogFactor = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            float3 SampleNormal(float2 uv)
            {
                float3 n = SAMPLE_TEXTURE2D(_NormalMap, sampler_NormalMap, uv).rgb * 2.0 - 1.0;
                return n;
            }

            float GroundAt(float2 mp, float mapNorth)
            {
                float2 uv = float2((mp.x - _HMap.x) / _HMap.z, 1.0 - (_HMap.y - mapNorth) / _HMap.w);
                return SAMPLE_TEXTURE2D(_HeightTex, sampler_HeightTex, saturate(uv)).r * 200.0 - 100.0;
            }

            half4 frag (Varyings i) : SV_Target
            {
                float2 mp = i.positionWS.xz;
                float2 huv = float2((mp.x - _HMap.x) / _HMap.z, 1.0 - (_HMap.y - mp.y) / _HMap.w);
                float ground = SAMPLE_TEXTURE2D(_HeightTex, sampler_HeightTex, saturate(huv)).r * 200.0 - 100.0;
                float depth = max(0.05 - ground, 0.0);

                float2 uv1 = i.positionWS.xz * _WaveScale + _Time.y * _Speed;
                float2 uv2 = i.positionWS.xz * (_WaveScale * 2.7) - _Time.y * (_Speed * 1.4);
                float3 n1 = SampleNormal(uv1);
                float3 n2 = SampleNormal(uv2);

                float wdist = length(_WorldSpaceCameraPos - i.positionWS);
                float2 slope = (n1.xy + n2.xy) * _NormalStrength * (1.0 - 0.75 * smoothstep(400.0, 3000.0, wdist));
                float3 N = normalize(i.normalWS + float3(slope.x, 0.0, slope.y));

                float3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                float fresnel = pow(1.0 - saturate(dot(N, V)), 4.0);

                float3 baseCol = lerp(_DeepColor.rgb, _ShallowColor.rgb,
                    saturate(0.35 + (1.0 - saturate(depth / 9.0)) * 0.55 + fresnel * 0.2));
                float3 ambient = SampleSH(N);

                float4 shadowCoord = TransformWorldToShadowCoord(i.positionWS);
                Light mainLight = GetMainLight(shadowCoord);
                float3 L = normalize(mainLight.direction);
                float3 H = normalize(L + V);
                float spec = pow(saturate(dot(N, H)), _SpecPower) * _SpecStrength;
                float ndl = saturate(dot(N, L)) * 0.35 + 0.65;

                float3 col = baseCol * (ambient + mainLight.color * ndl * mainLight.shadowAttenuation);
                col += mainLight.color * spec * mainLight.shadowAttenuation * (1.0 - smoothstep(150.0, 1200.0, wdist));
                col = lerp(col, _DeepColor.rgb + ambient * 0.35, fresnel * 0.65);

                // shore foam: only the shallow band, using the original height map
                float2 fuv = i.positionWS.xz * 0.03 + _Time.y * float2(0.010, 0.007);
                float fn = SAMPLE_TEXTURE2D(_NormalMap, sampler_NormalMap, fuv).x;
                float2 fuv2 = i.positionWS.xz * 0.11 - _Time.y * float2(0.014, 0.010);
                float fn2 = SAMPLE_TEXTURE2D(_NormalMap, sampler_NormalMap, fuv2).y;
                float shore = (1.0 - smoothstep(0.0, 1.5, depth)) * step(ground, 0.05);
                float foam = shore * smoothstep(0.42, 0.72, fn * 0.6 + fn2 * 0.6);
                foam *= step(ground, 0.05);
                col = lerp(col, float3(0.93, 0.97, 0.98), foam * 0.55);

                col = MixFog(col, i.fogFactor);

                return half4(col, 1.0);
            }
            ENDHLSL
        }
    }
    FallBack "Universal Render Pipeline/Unlit"
}
