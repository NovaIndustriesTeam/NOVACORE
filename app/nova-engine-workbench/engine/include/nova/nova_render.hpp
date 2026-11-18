#pragma once

#include "nova/nova_core.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace nova {

// Options for the deterministic software rasterizer. It renders a Scene document
// without a GPU, a window or any third-party dependency.
struct RenderOptions {
    int width{960};
    int height{540};
    int supersample{2};  // 1..4, rendered internally then box-downsampled.
    std::string cameraId{};    // Empty: first visible Camera entity, else auto-framing.
    std::string selectedId{};  // Optional editor selection highlight.
    bool grid{true};
    bool shadows{true};
    bool wireframe{false};
    bool bloom{true};          // HDR bright-pass bloom in the post-process pass.
    float bloomIntensity{0.45F};
    float exposure{1.0F};
    int shadowResolution{1024};  // 128..2048 per shadow map (directional + spot).
    // Base directory used to resolve `Material::texture` relative paths. Empty
    // means the path is resolved from the process working directory.
    std::string assetRoot{};
};

struct RenderStats {
    int width{};
    int height{};
    int internalWidth{};
    int internalHeight{};
    int meshes{};
    int lights{};
    int triangles{};
    int shadowMaps{};
    int textures{};
    std::uint64_t meshPixels{};
    std::string cameraName{};
    double milliseconds{};
};

// Renders the scene into a tightly packed RGBA8 buffer (width * height * 4).
// The render is deterministic: identical scene + identical options produce
// byte-identical pixels.
[[nodiscard]] bool renderScene(const Scene& scene, const RenderOptions& options,
                               std::vector<std::uint8_t>& rgba, RenderStats& stats,
                               std::string& error);

// Minimal dependency-free PNG writer (RGBA8, filter 0, stored deflate blocks).
[[nodiscard]] std::vector<std::uint8_t> encodePngRgba(int width, int height,
                                                      const std::vector<std::uint8_t>& rgba);

[[nodiscard]] bool writePngFile(const std::string& path, int width, int height,
                                const std::vector<std::uint8_t>& rgba, std::string& error);

}  // namespace nova
