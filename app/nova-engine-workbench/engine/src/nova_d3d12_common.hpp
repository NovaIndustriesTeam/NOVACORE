#pragma once

// Private Direct3D 12 helpers shared by the offscreen renderer and the native
// window runtime. Not part of the public NovaCore API.

#include "nova/nova_gpu.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>

#include <d3d12.h>
#include <d3dcompiler.h>
#include <dxgi1_6.h>
#include <wrl/client.h>

#include <cstdint>
#include <string>

namespace nova::d3d12 {

using Microsoft::WRL::ComPtr;

// Must match the HLSL `Frame` cbuffer byte for byte (16-byte aligned fields).
//   lightData[i] = { position.xyz, type }
//                  { direction.xyz, range }
//                  { colour.xyz, intensity }
//                  { cosOuter, cosInner, shadowIndex, unused }
struct FrameConstants {
    float viewProjection[16]{};
    float cameraPosition[4]{};
    float shadowViewProjection[2][16]{};  // Row-major light-space matrices.
    float lightData[8][16]{};             // Up to eight scene lights.
    float ambientSky[4]{};
    float ambientGround[4]{};
    float backgroundTop[4]{};
    float backgroundBottom[4]{};
    float params[4]{};   // x = exposure, y = selection boost, z = lights, w = shadows.
    float params2[4]{};  // x = bloom intensity, y = bloom enabled, z = shadow resolution, w = unused.
};
static_assert(sizeof(FrameConstants) % 16 == 0, "FrameConstants must stay 16-byte aligned");

inline constexpr const char* kShaderSource = R"HLSL(
cbuffer Frame : register(b0)
{
    row_major float4x4 uViewProjection;
    float4 uCameraPosition;
    row_major float4x4 uShadowViewProjection[2];
    float4 uLights[8][4];
    float4 uAmbientSky;
    float4 uAmbientGround;
    float4 uBackgroundTop;
    float4 uBackgroundBottom;
    float4 uParams;
    float4 uParams2;
};

// Light-space matrix for the shadow map currently being rasterized. Bound as
// 16 root constants (register b1) so each shadow pass gets its own matrix
// without rewriting a shared constant buffer.
cbuffer ShadowFrame : register(b1)
{
    row_major float4x4 uShadowCurrentViewProjection;
};

Texture2DArray uTextures : register(t0);
Texture2D uSceneColor : register(t1);
Texture2D uBloomA : register(t2);
Texture2D uBloomB : register(t3);
Texture2DArray uShadowMaps : register(t4);
SamplerState uSampler : register(s0);

struct SceneVertexIn
{
    float3 position : POSITION;
    float3 normal   : NORMAL;
    float3 color    : COLOR;
    float2 uv       : TEXCOORD0;
    float4 material : TEXCOORD1;  // roughness, metallic, pattern id, tiling
    float  selected : TEXCOORD2;
    float  textureIndex : TEXCOORD3;
};

struct SceneVertexOut
{
    float4 clipPosition : SV_POSITION;
    float3 worldPosition : TEXCOORD1;
    float3 normal : TEXCOORD2;
    float3 albedo : TEXCOORD3;
    float2 uv : TEXCOORD4;
    float4 material : TEXCOORD5;
    float selected : TEXCOORD6;
    float textureIndex : TEXCOORD7;
};

SceneVertexOut VSScene(SceneVertexIn input)
{
    SceneVertexOut output;
    float4 world = float4(input.position, 1.0);
    output.clipPosition = mul(uViewProjection, world);
    output.worldPosition = input.position;
    output.normal = input.normal;
    output.albedo = input.color;
    output.uv = input.uv;
    output.material = input.material;
    output.selected = input.selected;
    output.textureIndex = input.textureIndex;
    return output;
}

struct ShadowVertexIn
{
    float3 position : POSITION;
};

struct ShadowVertexOut
{
    float4 clipPosition : SV_POSITION;
};

ShadowVertexOut VSShadow(ShadowVertexIn input)
{
    ShadowVertexOut output;
    output.clipPosition = mul(uShadowCurrentViewProjection, float4(input.position, 1.0));
    return output;
}

struct FullscreenOut
{
    float4 clipPosition : SV_POSITION;
    float2 uv : TEXCOORD0;
};

FullscreenOut VSFullscreen(uint vertexId : SV_VertexID)
{
    FullscreenOut output;
    float2 uv = float2((vertexId << 1) & 2, vertexId & 2);
    output.clipPosition = float4(uv * 2.0 - 1.0, 0.0, 1.0);
    output.uv = uv;
    return output;
}

static const float PI = 3.14159265359;

float3 linearToSrgb(float3 value)
{
    value = saturate(value);
    return value <= 0.0031308 ? value * 12.92 : 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

float3 acesFilm(float3 x)
{
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}

float3 PSSkyValue(float2 uv)
{
    float t = saturate(uv.y);
    return lerp(uBackgroundBottom.rgb, uBackgroundTop.rgb, smoothstep(0.0, 1.0, t));
}

struct SkyOut
{
    float4 clipPosition : SV_POSITION;
    float2 uv : TEXCOORD0;
};

SkyOut VSSky(uint vertexId : SV_VertexID)
{
    SkyOut output;
    float2 uv = float2((vertexId << 1) & 2, vertexId & 2);
    output.clipPosition = float4(uv * 2.0 - 1.0, 1.0, 1.0);
    output.uv = uv;
    return output;
}

// The scene pass writes linear HDR radiance. Exposure, bloom, ACES and the
// sRGB transfer function are applied by the composite pass, exactly like the
// software rasterizer and the WebGL2 viewport.
float4 PSSky(SkyOut input) : SV_Target
{
    return float4(PSSkyValue(input.uv), 1.0);
}

// Procedural patterns shared with the software rasterizer and the WebGL2
// viewport: id 0 = none, 1 = checker, 2 = grid.
float3 applySurfacePattern(float3 albedo, float2 uv, float4 material)
{
    int pattern = (int)round(material.z);
    float scale = clamp(material.w, 1.0, 64.0);
    float2 p = uv * scale;
    if (pattern == 1)
    {
        float2 cell = floor(p);
        float parity = fmod(abs(cell.x + cell.y), 2.0);
        return parity < 0.5 ? albedo : albedo * 0.45;
    }
    if (pattern == 2)
    {
        float2 edgeDistance = abs(frac(p) - 0.5);
        float edge = max(edgeDistance.x, edgeDistance.y);
        return edge > 0.44 ? saturate(albedo * 1.35 + 0.06) : albedo * 0.62;
    }
    return albedo;
}

float distributionGGX(float3 n, float3 h, float roughness)
{
    float a = roughness * roughness;
    float a2 = a * a;
    float noH = saturate(dot(n, h));
    float denominator = noH * noH * (a2 - 1.0) + 1.0;
    return a2 / max(PI * denominator * denominator, 1e-5);
}

float geometrySmith(float noV, float noL, float roughness)
{
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    float gv = noV / (noV * (1.0 - k) + k);
    float gl = noL / (noL * (1.0 - k) + k);
    return gv * gl;
}

// 3x3 percentage-closer filtering against the light's shadow slice. The map is
// stored as R32_FLOAT depth in a Texture2DArray (one layer per shadow light).
float shadowVisibility(int shadowIndex, float3 position, float3 normal, float noL)
{
    int shadowCount = (int)round(uParams.w);
    if (shadowIndex < 0 || shadowIndex >= shadowCount) return 1.0;

    float4 clip = mul(uShadowViewProjection[shadowIndex], float4(position + normal * 0.035, 1.0));
    if (clip.w <= 1e-5) return 1.0;
    float2 uv = float2(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
    float depth = clip.z / clip.w;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || depth < 0.0 || depth > 1.0) {
        return 1.0;
    }

    float resolution = max(uParams2.z, 1.0);
    float texel = 1.0 / resolution;
    float bias = max(0.0008, 0.0038 * (1.0 - saturate(noL)));
    float lit = 0.0;
    [unroll] for (int y = -1; y <= 1; ++y)
    {
        [unroll] for (int x = -1; x <= 1; ++x)
        {
            float2 clampedUv = saturate(uv + float2(x, y) * texel);
            float stored = uShadowMaps.SampleLevel(uSampler, float3(clampedUv, (float)shadowIndex), 0).r;
            lit += (depth <= stored + bias) ? 1.0 : 0.0;
        }
    }
    return lit / 9.0;
}

float4 PSScene(SceneVertexOut input) : SV_Target
{
    float3 n = normalize(input.normal);
    float3 v = normalize(uCameraPosition.xyz - input.worldPosition);
    if (dot(n, v) < 0.0) n = -n;

    float roughness = clamp(input.material.x, 0.04, 1.0);
    float metallic = saturate(input.material.y);
    int textureLayer = (int)round(input.textureIndex);
    float3 albedo = input.albedo;
    if (textureLayer >= 0)
    {
        float scale = clamp(input.material.w, 1.0, 64.0);
        albedo *= uTextures.Sample(uSampler, float3(input.uv * scale, (float)textureLayer)).rgb;
    }
    else
    {
        albedo = applySurfacePattern(input.albedo, input.uv, input.material);
    }

    float noV = max(saturate(dot(n, v)), 1e-4);
    float3 f0 = lerp(float3(0.04, 0.04, 0.04), albedo, metallic);
    float3 diffuse = albedo * (1.0 - metallic) / PI;

    float3 color = lerp(uAmbientGround.rgb, uAmbientSky.rgb, 0.5 + 0.5 * n.y) * albedo;

    int lightCount = (int)round(uParams.z);
    [loop] for (int i = 0; i < 8; ++i)
    {
        if (i >= lightCount) break;
        float4 lightPosition = uLights[i][0];
        float4 lightDirection = uLights[i][1];
        float4 lightColor = uLights[i][2];
        float4 lightExtra = uLights[i][3];
        int type = (int)round(lightPosition.w);

        float3 directionToLight;
        float attenuation = 1.0;
        if (type == 0)
        {
            directionToLight = normalize(-lightDirection.xyz);
        }
        else
        {
            float3 delta = lightPosition.xyz - input.worldPosition;
            float distanceSquared = dot(delta, delta);
            float range = max(lightDirection.w, 0.001);
            if (distanceSquared > range * range) continue;
            float distance = sqrt(distanceSquared);
            directionToLight = delta / max(distance, 1e-5);
            attenuation = pow(max(0.0, 1.0 - distanceSquared / (range * range)), 2.0) /
                          (1.0 + distanceSquared * 0.18);
            if (type == 2)
            {
                float cosAngle = dot(-directionToLight, normalize(lightDirection.xyz));
                if (cosAngle <= lightExtra.x) continue;
                float cone = saturate((cosAngle - lightExtra.x) /
                                      max(lightExtra.y - lightExtra.x, 1e-4));
                attenuation *= cone * cone;
            }
        }

        float noL = saturate(dot(n, directionToLight));
        if (noL <= 0.0 || attenuation <= 0.0) continue;
        float visibility = shadowVisibility((int)round(lightExtra.z), input.worldPosition, n, noL);
        if (visibility <= 0.0) continue;

        float3 h = normalize(directionToLight + v);
        float noH = saturate(dot(n, h));
        float voH = saturate(dot(v, h));
        float d = distributionGGX(n, h, roughness);
        float g = geometrySmith(noV, noL, roughness);
        float3 fresnel = f0 + (1.0 - f0) * pow(1.0 - voH, 5.0);
        float3 specular = (d * g * fresnel) / max(4.0 * noV * noL, 1e-4);

        color += (diffuse + specular) * lightColor.rgb * lightColor.w * attenuation * visibility * noL;
    }

    float rim = pow(1.0 - saturate(dot(n, v)), 3.0);
    if (input.selected > 0.5)
    {
        color += float3(0.16, 0.62, 0.95) * rim * uParams.y;
    }
    return float4(color, 1.0);
}

float4 PSBright(FullscreenOut input) : SV_Target
{
    float3 color = uSceneColor.Sample(uSampler, input.uv).rgb * uParams.x;
    float luminance = dot(color, float3(0.2126, 0.7152, 0.0722));
    float amount = max(0.0, luminance - 0.82) / max(luminance, 1e-4);
    return float4(color * amount, 1.0);
}

// Single-pass separable approximation: five taps on each axis, centred on the
// half-resolution bright pass. Cheap, deterministic and close to the software
// two-pass bloom for the sizes the engine targets.
float4 PSBlur(FullscreenOut input) : SV_Target
{
    uint width, height;
    uBloomA.GetDimensions(width, height);
    float2 texel = float2(1.0 / max((float)width, 1.0), 1.0 / max((float)height, 1.0));
    static const float weights[5] = {0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216};
    float3 sum = uBloomA.Sample(uSampler, input.uv).rgb * weights[0];
    [unroll] for (int i = 1; i < 5; ++i)
    {
        float2 offset = texel * (float)i * 1.5;
        sum += uBloomA.Sample(uSampler, input.uv + float2(offset.x, 0.0)).rgb * weights[i];
        sum += uBloomA.Sample(uSampler, input.uv - float2(offset.x, 0.0)).rgb * weights[i];
        sum += uBloomA.Sample(uSampler, input.uv + float2(0.0, offset.y)).rgb * weights[i];
        sum += uBloomA.Sample(uSampler, input.uv - float2(0.0, offset.y)).rgb * weights[i];
    }
    return float4(sum, 1.0);
}

float4 PSComposite(FullscreenOut input) : SV_Target
{
    float3 color = uSceneColor.Sample(uSampler, input.uv).rgb * uParams.x;
    if (uParams2.y > 0.5)
    {
        color += uBloomB.Sample(uSampler, input.uv).rgb * uParams2.x;
    }
    return float4(linearToSrgb(acesFilm(color)), 1.0);
}
)HLSL";

[[nodiscard]] std::string wideToUtf8(const wchar_t* value);
[[nodiscard]] std::string hresultText(HRESULT result);
[[nodiscard]] bool check(HRESULT result, const char* what, std::string& error);
[[nodiscard]] ComPtr<ID3DBlob> compileShader(const char* source, const char* entry,
                                             const char* target, std::string& error);

[[nodiscard]] ComPtr<ID3D12Resource> createBuffer(ID3D12Device* device, UINT64 size,
                                                  D3D12_HEAP_TYPE heapType);
[[nodiscard]] ComPtr<ID3D12Resource> createTexture2D(ID3D12Device* device, int width, int height,
                                                     DXGI_FORMAT format, D3D12_RESOURCE_FLAGS flags,
                                                     D3D12_RESOURCE_STATES state);
[[nodiscard]] ComPtr<ID3D12Resource> createTexture2DArray(ID3D12Device* device, int width, int height,
                                                          int arraySize, DXGI_FORMAT format,
                                                          D3D12_RESOURCE_FLAGS flags,
                                                          D3D12_RESOURCE_STATES state);
[[nodiscard]] D3D12_RESOURCE_BARRIER transition(ID3D12Resource* resource,
                                                D3D12_RESOURCE_STATES before,
                                                D3D12_RESOURCE_STATES after);

[[nodiscard]] bool createAdapterDevice(ComPtr<ID3D12Device>& device, std::string& adapterName,
                                       std::string& error);
[[nodiscard]] bool createRootSignature(ID3D12Device* device,
                                       ComPtr<ID3D12RootSignature>& rootSignature,
                                       std::string& error);

struct Pipelines {
    ComPtr<ID3D12PipelineState> sky;
    ComPtr<ID3D12PipelineState> solid;
    ComPtr<ID3D12PipelineState> wire;
    ComPtr<ID3D12PipelineState> shadow;
    ComPtr<ID3D12PipelineState> bright;
    ComPtr<ID3D12PipelineState> blur;
    ComPtr<ID3D12PipelineState> composite;
};

[[nodiscard]] bool createPipelines(ID3D12Device* device, ID3D12RootSignature* rootSignature,
                                   DXGI_FORMAT hdrFormat, DXGI_FORMAT finalFormat,
                                   Pipelines& pipelines, std::string& error);

[[nodiscard]] FrameConstants frameConstants(const GpuScene& scene) noexcept;

// Resources shared by the offscreen and window render paths: HDR scene target,
// half-resolution bloom pair, depth buffer, shadow map array and the optional
// texture array. `ensureFrameResources` recreates them only when the required
// size or layer count changes.
struct FrameResources {
    ComPtr<ID3D12Resource> hdr;
    ComPtr<ID3D12Resource> bloomA;
    ComPtr<ID3D12Resource> bloomB;
    ComPtr<ID3D12Resource> depth;
    ComPtr<ID3D12Resource> shadowMaps;
    ComPtr<ID3D12Resource> textures;
    ComPtr<ID3D12Resource> textureUpload;
    ComPtr<ID3D12DescriptorHeap> rtvHeap;
    ComPtr<ID3D12DescriptorHeap> dsvHeap;
    ComPtr<ID3D12DescriptorHeap> srvHeap;
    int width{};
    int height{};
    int shadowSize{};
    int shadowLayers{};
    int textureLayers{};
    bool texturesReady{false};
    D3D12_RESOURCE_STATES hdrState{D3D12_RESOURCE_STATE_COMMON};
    D3D12_RESOURCE_STATES bloomAState{D3D12_RESOURCE_STATE_COMMON};
    D3D12_RESOURCE_STATES bloomBState{D3D12_RESOURCE_STATE_COMMON};
    D3D12_RESOURCE_STATES depthState{D3D12_RESOURCE_STATE_COMMON};
    D3D12_RESOURCE_STATES shadowState{D3D12_RESOURCE_STATE_DEPTH_WRITE};
    D3D12_CPU_DESCRIPTOR_HANDLE hdrRtv{};
    D3D12_CPU_DESCRIPTOR_HANDLE bloomARtv{};
    D3D12_CPU_DESCRIPTOR_HANDLE bloomBRtv{};
    D3D12_CPU_DESCRIPTOR_HANDLE depthDsv{};
    D3D12_CPU_DESCRIPTOR_HANDLE shadowDsv[2]{};
};

[[nodiscard]] bool ensureFrameResources(ID3D12Device* device, FrameResources& resources,
                                        int width, int height, const GpuScene& scene,
                                        std::string& error);

// Records the whole frame: texture upload (first frame only), shadow passes,
// HDR scene pass, bright/blur bloom passes and the ACES composite into
// `finalRtv`. The final target must already be in RENDER_TARGET state; the
// caller owns the subsequent transition and readback.
void recordFrame(ID3D12GraphicsCommandList* list, ID3D12RootSignature* rootSignature,
                 const Pipelines& pipelines, FrameResources& resources, const GpuScene& scene,
                 D3D12_GPU_VIRTUAL_ADDRESS frameConstantsAddress,
                 const D3D12_VERTEX_BUFFER_VIEW& vertexView,
                 const D3D12_INDEX_BUFFER_VIEW& triangleIndexView, UINT triangleIndexCount,
                 const D3D12_INDEX_BUFFER_VIEW& drawIndexView, UINT drawIndexCount,
                 bool lineTopology, D3D12_CPU_DESCRIPTOR_HANDLE finalRtv, int& drawCalls);

}  // namespace nova::d3d12
