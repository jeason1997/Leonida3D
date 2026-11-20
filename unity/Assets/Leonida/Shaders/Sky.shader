Shader "Leonida/Sky"
{
    Properties
    {
        _ZenithColor ("Zenith Color", Color) = (0.08, 0.22, 0.50, 1)
        _HorizonColor ("Horizon Color", Color) = (0.72, 0.82, 0.92, 1)
        _GroundColor ("Ground Color", Color) = (0.18, 0.21, 0.22, 1)
        _SunDir ("Sun Direction", Vector) = (0.4, 0.6, 0.2, 0)
        _SunColor ("Sun Color", Color) = (1.0, 0.92, 0.75, 1)
        _SunSize ("Sun Size", Range(0.0005, 0.05)) = 0.012
        _SunGlow ("Sun Glow", Range(0, 2)) = 0.35
        _CloudColor ("Cloud Color", Color) = (0.92, 0.94, 0.97, 1)
        _CloudCoverage ("Cloud Coverage", Range(0, 1)) = 0.55
        _CloudSpeed ("Cloud Speed", Float) = 0.004
    }

    SubShader
    {
        Tags { "Queue"="Background" "RenderType"="Background" "PreviewType"="Skybox" "RenderPipeline"="UniversalPipeline" }
        Cull Off
        ZWrite Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _ZenithColor;
                float4 _HorizonColor;
                float4 _GroundColor;
                float4 _SunDir;
                float4 _SunColor;
                float _SunSize;
                float _SunGlow;
                float4 _CloudColor;
                float _CloudCoverage;
                float _CloudSpeed;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 direction  : TEXCOORD0;
            };

            Varyings vert (Attributes v)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.direction = v.positionOS.xyz;
                return o;
            }

            float Hash21(float2 p)
            {
                return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
            }

            float Noise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = Hash21(i);
                float b = Hash21(i + float2(1, 0));
                float c = Hash21(i + float2(0, 1));
                float d = Hash21(i + float2(1, 1));
                return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
            }

            float Fbm(float2 p)
            {
                float v = 0.0;
                float a = 0.5;
                for (int k = 0; k < 4; k++)
                {
                    v += a * Noise(p);
                    p *= 2.03;
                    a *= 0.5;
                }
                return v;
            }

            half4 frag (Varyings i) : SV_Target
            {
                float3 dir = normalize(i.direction);
                float h = saturate(dir.y);
                float3 col = lerp(_HorizonColor.rgb, _ZenithColor.rgb, pow(h, 0.55));

                float below = saturate(-dir.y * 4.0);
                col = lerp(col, _GroundColor.rgb, below);

                float3 sunDir = normalize(_SunDir.xyz);
                float sd = saturate(dot(dir, sunDir));
                float disk = smoothstep(1.0 - _SunSize * 2.0, 1.0 - _SunSize, sd);
                float glow = pow(sd, 24.0) * _SunGlow;
                col += _SunColor.rgb * (disk * 3.0 + glow);

                // flat-ish cloud deck projected onto the sky dome
                float2 cuv = dir.xz / max(dir.y + 0.16, 0.06) * 0.55;
                float clouds = Fbm(cuv * 2.0 + _Time.y * _CloudSpeed * 10.0);
                float mask = smoothstep(1.0 - _CloudCoverage, 1.0 - _CloudCoverage + 0.22, clouds)
                           * smoothstep(0.0, 0.16, dir.y);
                col = lerp(col, _CloudColor.rgb, saturate(mask) * 0.82);

                return half4(col, 1.0);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
