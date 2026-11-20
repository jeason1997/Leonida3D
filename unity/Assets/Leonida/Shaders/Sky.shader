// Faithful HLSL port of three.js examples/jsm/objects/Sky.js (Preetham daylight model),
// with the web build's SKY_CLOUDS function from Reference/js/sky.js layered on top.
Shader "Leonida/Sky"
{
    Properties
    {
        _Turbidity ("Turbidity", Float) = 3.2
        _Rayleigh ("Rayleigh", Float) = 1.4
        _MieCoefficient ("Mie Coefficient", Float) = 0.004
        _MieDirectionalG ("Mie Directional G", Float) = 0.8
        _SunDir ("Sun Position", Vector) = (0.4, 0.6, 0.2, 0)
        _Up ("Up", Vector) = (0, 1, 0, 0)
        _Gain ("Sky Gain", Float) = 0.55
        _CloudLit ("Cloud Lit", Color) = (1.45, 1.42, 1.40, 1)
        _CloudShade ("Cloud Shade", Color) = (0.48, 0.53, 0.62, 1)
        _CloudGlow ("Cloud Glow", Color) = (0, 0, 0, 1)
        _Warm ("Warm", Float) = 0
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
                float _Turbidity;
                float _Rayleigh;
                float _MieCoefficient;
                float _MieDirectionalG;
                float4 _SunDir;
                float4 _Up;
                float _Gain;
                float4 _CloudLit;
                float4 _CloudShade;
                float4 _CloudGlow;
                float _Warm;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 worldPosition : TEXCOORD0;
                float3 sunDirection : TEXCOORD1;
                float sunfade : TEXCOORD2;
                float3 betaR : TEXCOORD3;
                float3 betaM : TEXCOORD4;
                float sunE : TEXCOORD5;
            };

            static const float SKY_PI = 3.141592653589793238462643383279502884197169;
            static const float SKY_E = 2.71828182845904523536028747135266249775724709369995957;
            static const float3 totalRayleigh = float3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
            static const float3 K = float3(0.686, 0.678, 0.666);
            static const float3 MieConst = float3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
            static const float cutoffAngle = 1.6110731556870734;
            static const float steepness = 1.5;
            static const float EE = 1000.0;

            float SunIntensity(float zenithAngleCos)
            {
                zenithAngleCos = clamp(zenithAngleCos, -1.0, 1.0);
                return EE * max(0.0, 1.0 - pow(SKY_E, -((cutoffAngle - acos(zenithAngleCos)) / steepness)));
            }

            float3 TotalMie(float T)
            {
                float c = (0.2 * T) * 10E-18;
                return 0.434 * c * MieConst;
            }

            Varyings vert (Attributes v)
            {
                Varyings o;
                float4 worldPosition = mul(GetObjectToWorldMatrix(), float4(v.positionOS.xyz, 1.0));
                o.worldPosition = worldPosition.xyz;

                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
            #if UNITY_REVERSED_Z
                o.positionCS.z = 0.0;
            #else
                o.positionCS.z = o.positionCS.w;
            #endif

                o.sunDirection = normalize(_SunDir.xyz);
                o.sunE = SunIntensity(dot(o.sunDirection, normalize(_Up.xyz)));

                o.sunfade = 1.0 - clamp(1.0 - exp((_SunDir.y / 450000.0)), 0.0, 1.0);
                float rayleighCoefficient = _Rayleigh - (1.0 * (1.0 - o.sunfade));
                o.betaR = totalRayleigh * rayleighCoefficient;
                o.betaM = TotalMie(_Turbidity) * _MieCoefficient;
                return o;
            }

            float RayleighPhase(float cosTheta)
            {
                return 0.05968310365946075 * (1.0 + pow(cosTheta, 2.0));
            }

            float HGPhase(float cosTheta, float g)
            {
                float g2 = pow(g, 2.0);
                float inverse = 1.0 / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
                return 0.07957747154594767 * ((1.0 - g2) * inverse);
            }

            float CHash(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
            float CNoise(float2 p)
            {
                float2 i = floor(p), f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(CHash(i), CHash(i + float2(1, 0)), f.x),
                            lerp(CHash(i + float2(0, 1)), CHash(i + float2(1, 1)), f.x), f.y);
            }
            float CFbm(float2 p)
            {
                float s = 0.0, a = 0.5;
                for (int k = 0; k < 5; k++)
                {
                    s += a * CNoise(p);
                    p = p * 2.03 + float2(17.1, 9.2);
                    a *= 0.5;
                }
                return s;
            }

            // Reference/js/sky.js SKY_CLOUDS clouds()
            float3 Clouds(float3 d, float3 sky, float3 sd)
            {
                if (d.y <= 0.0) return sky;
                float toward = pow(max(dot(d, normalize(sd)), 0.0), 3.0);
                sky *= lerp(float3(1, 1, 1), float3(1.3, 0.86, 0.58),
                            _Warm * pow(1.0 - d.y, 3.0) * (0.45 + 0.55 * toward));
                float2 p = d.xz / (d.y + 0.08) * 1.4 + float2(_Time.y * 0.004, _Time.y * 0.0015);
                float n = CFbm(p);
                float cov = smoothstep(0.4, 0.64, n) * smoothstep(0.01, 0.12, d.y);
                float core = smoothstep(0.58, 0.9, n);
                float3 c = lerp(_CloudLit.rgb, _CloudShade.rgb, core * 0.9)
                         + _CloudGlow.rgb * toward * (1.0 - 0.6 * core);
                return lerp(sky, c, cov * 0.92);
            }

            half4 frag (Varyings i) : SV_Target
            {
                float3 direction = normalize(i.worldPosition - _WorldSpaceCameraPos);
                float3 up = normalize(_Up.xyz);

                float zenithAngle = acos(max(0.0, dot(up, direction)));
                float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / SKY_PI), -1.253));
                float sR = 8.4E3 * inverse;
                float sM = 1.25E3 * inverse;

                float3 Fex = exp(-(i.betaR * sR + i.betaM * sM));
                float cosTheta = dot(direction, i.sunDirection);
                float rPhase = RayleighPhase(cosTheta * 0.5 + 0.5);
                float3 betaRTheta = i.betaR * rPhase;
                float mPhase = HGPhase(cosTheta, _MieDirectionalG);
                float3 betaMTheta = i.betaM * mPhase;

                float3 Lin = pow(i.sunE * ((betaRTheta + betaMTheta) / (i.betaR + i.betaM)) * (1.0 - Fex), float3(1.5, 1.5, 1.5));
                Lin *= lerp(float3(1, 1, 1),
                            pow(i.sunE * ((betaRTheta + betaMTheta) / (i.betaR + i.betaM)) * Fex, float3(0.5, 0.5, 0.5)),
                            clamp(pow(1.0 - dot(up, i.sunDirection), 5.0), 0.0, 1.0));

                float3 L0 = float3(0.1, 0.1, 0.1) * Fex;
                float cosSun = 0.999956676946448443553574619906976478926848692873900859324;
                float sundisk = smoothstep(cosSun, cosSun + 0.00002, cosTheta);
                L0 += (i.sunE * 19000.0 * Fex) * sundisk;

                float3 texColor = (Lin + L0) * 0.04 + float3(0.0, 0.0003, 0.00075);
                float3 retColor = pow(texColor, float3(1.0 / (1.2 + 1.2 * i.sunfade),
                                                      1.0 / (1.2 + 1.2 * i.sunfade),
                                                      1.0 / (1.2 + 1.2 * i.sunfade)));

                retColor *= _Gain;
                retColor = Clouds(direction, retColor, i.sunDirection);
                return half4(retColor, 1.0);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
