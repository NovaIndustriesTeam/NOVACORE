#pragma once

#include "nova/nova_core.hpp"
#include "nova/nova_render.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace nova {

// Graphics backends known to the RHI. Only D3D12 is implemented and tested on
// Windows today; Software is the deterministic CPU rasterizer. Metal and Vulkan
// are declared so the interface does not need to change when they land.
enum class GpuBackend {
    Auto,
    D3D12,
    Metal,
    Vulkan,
    Software,
};

[[nodiscard]] const char* gpuBackendName(GpuBackend backend) noexcept;
[[nodiscard]] bool parseGpuBackend(std::string_view name, GpuBackend& backend) noexcept;

struct GpuAdapterInfo {
    std::string name;
    std::string backend{"D3D12"};
    std::uint32_t vendorId{};
    std::uint32_t deviceId{};
    std::uint64_t dedicatedMemory{};
    bool hardware{};
};

struct GpuInfo {
    bool available{};
    std::string backend;
    std::string error;
    std::vector<GpuAdapterInfo> adapters;
};

// Enumerates graphics adapters without creating a rendering device.
[[nodiscard]] GpuInfo queryGpuInfo();

// Backend-agnostic vertex stream consumed by GPU backends. `color` is a linear
// albedo; `uv` + `material` (roughness, metallic, patternId, tiling) feed the
// procedural materials. `textureIndex` selects a layer in `GpuScene::textures`
// (-1 keeps the procedural pattern). Layout is 17 floats (68 bytes) and must
// match the D3D12 input layout.
struct GpuVertex {
    float position[3]{};
    float normal[3]{};
    float color[3]{};
    float uv[2]{};
    float material[4]{};  // x = roughness, y = metallic, z = pattern id, w = tiling.
    float selected{};
    float textureIndex{-1.0F};
};

// One scene light, ready for upload to a GPU constant buffer.
struct GpuLight {
    int type{};  // 0 = directional, 1 = point, 2 = spot.
    float position[3]{};
    float direction[3]{};  // Direction the light travels.
    float color[3]{};      // Linear colour.
    float intensity{1.0F};
    float range{8.0F};
    float cosOuter{-1.0F};
    float cosInner{1.0F};
    int shadowIndex{-1};  // Index into GpuScene::shadowMaps, -1 when unshadowed.
};

// Light-space matrix for a shadow-casting light. The GPU backend rasterizes the
// depth map itself (1024x1024, D32_FLOAT) using this matrix.
struct GpuShadowMap {
    int size{1024};
    float viewProjection[16]{};  // Row-major, clip-space z in [0, 1].
};

// RGBA8 sRGB texture layer. The D3D12 backend uploads them as one
// Texture2DArray and samples them with a hardware sRGB view.
struct GpuTexture {
    int width{};
    int height{};
    std::vector<std::uint8_t> rgba;
};

struct GpuScene {
    std::vector<GpuVertex> vertices;
    std::vector<std::uint32_t> indices;
    std::vector<GpuLight> lights;           // Up to eight.
    std::vector<GpuShadowMap> shadowMaps;   // Up to two.
    std::vector<GpuTexture> textures;       // 512x512 layers.
    float viewProjection[16]{};  // Row-major, clip-space z in [0, 1].
    float cameraPosition[3]{};
    float backgroundTop[3]{};
    float backgroundBottom[3]{};
    float ambientSky[3]{};
    float ambientGround[3]{};
    float exposure{1.0F};
    bool bloom{true};
    float bloomIntensity{0.45F};
    int meshCount{};
    int lightCount{};
    int triangleCount{};
    int textureWidth{512};
    int textureHeight{512};
    std::string cameraName;
};

// Reuses the engine's scene geometry, hierarchy, camera and lighting so the GPU
// and software paths render the same document. Implemented in nova_render.cpp.
[[nodiscard]] bool buildGpuScene(const Scene& scene, const RenderOptions& options,
                                 GpuScene& out, std::string& error);

struct GpuRenderStats {
    int width{};
    int height{};
    int meshes{};
    int lights{};
    int triangles{};
    int drawCalls{};
    std::string backend;
    std::string adapter;
    double milliseconds{};
};

// Renders offscreen on the GPU into a tightly packed RGBA8 buffer
// (width * height * 4, top-left origin, sRGB encoded).
[[nodiscard]] bool renderSceneGpu(const GpuScene& scene, int width, int height, bool wireframe,
                                  std::vector<std::uint8_t>& rgba, GpuRenderStats& stats,
                                  std::string& error);

}  // namespace nova
