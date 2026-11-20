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

            half4 frag (Varyings i) : SV_Target
            {
                float2 uv1 = i.positionWS.xz * _WaveScale + _Time.y * _Speed;
                float2 uv2 = i.positionWS.xz * (_WaveScale * 2.7) - _Time.y * (_Speed * 1.4);
                float3 n1 = SampleNormal(uv1);
                float3 n2 = SampleNormal(uv2);

                float2 slope = (n1.xy + n2.xy) * _NormalStrength;
                float3 N = normalize(float3(slope.x, 1.0, slope.y));

                float3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                float fresnel = pow(1.0 - saturate(dot(N, V)), 4.0);

                float3 baseCol = lerp(_DeepColor.rgb, _ShallowColor.rgb, saturate(0.55 - N.y * 0.1 + fresnel * 0.35));
                float3 ambient = SampleSH(N);

                float4 shadowCoord = TransformWorldToShadowCoord(i.positionWS);
                Light mainLight = GetMainLight(shadowCoord);
                float3 L = normalize(mainLight.direction);
                float3 H = normalize(L + V);
                float spec = pow(saturate(dot(N, H)), _SpecPower) * _SpecStrength;
                float ndl = saturate(dot(N, L)) * 0.35 + 0.65;

                float3 col = baseCol * (ambient + mainLight.color * ndl * mainLight.shadowAttenuation);
                col += mainLight.color * spec * mainLight.shadowAttenuation;
                col = lerp(col, _DeepColor.rgb + ambient * 0.35, fresnel * 0.65);
                col = MixFog(col, i.fogFactor);

                return half4(col, 1.0);
            }
            ENDHLSL
        }
    }
    FallBack "Universal Render Pipeline/Unlit"
}
