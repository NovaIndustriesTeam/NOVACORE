#include "nova/nova_gpu.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

namespace {

int fail(int code, const std::string& message) {
    std::cerr << message << '\n';
    return code;
}

nova::Scene makeScene() {
    nova::Scene scene;
    scene.setName("GPU Test");

    const auto cameraId = scene.createEntity("Test Camera", "Camera");
    auto* camera = scene.findEntity(cameraId);
    camera->transform.position = {0.0F, 0.5F, 4.0F};

    const auto cubeId = scene.createEntity("Center Cube", "Mesh");
    auto* cube = scene.findEntity(cubeId);
    cube->transform.position = {0.0F, 0.5F, 0.0F};
    cube->transform.rotationDegrees = {0.0F, 24.0F, 0.0F};

    const auto lightId = scene.createEntity("Sun", "Light");
    auto* light = scene.findEntity(lightId);
    light->transform.position = {2.0F, 4.0F, 2.0F};
    light->transform.rotationDegrees = {-40.0F, 30.0F, 0.0F};
    light->components = {"Directional Light"};
    return scene;
}

std::size_t pixelOffset(int width, int x, int y) {
    return (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x)) * 4U;
}

std::size_t differingPixels(const std::vector<std::uint8_t>& a, const std::vector<std::uint8_t>& b) {
    const std::size_t count = std::min(a.size(), b.size()) / 4U;
    std::size_t differing = 0;
    for (std::size_t index = 0; index < count; ++index) {
        const std::size_t offset = index * 4U;
        if (a[offset] != b[offset] || a[offset + 1U] != b[offset + 1U] ||
            a[offset + 2U] != b[offset + 2U]) {
            ++differing;
        }
    }
    return differing;
}

}  // namespace

int main() {
    const auto engine = nova::info();
    if (engine.version != "0.8.0") return fail(1, "Engine version must be 0.8.0");
    if (engine.apiVersion != 6) return fail(32, "Engine API version must be 6");
    if (!nova::isSupportedApiVersion(engine.apiVersion)) return fail(2, "API version is not supported");

    const nova::GpuInfo info = nova::queryGpuInfo();
    if (!info.available) return fail(3, "No GPU adapter detected: " + info.error);

    bool hasHardware = false;
    std::string adapterName;
    std::uint64_t adapterMemory = 0;
    for (const auto& adapter : info.adapters) {
        if (!adapter.hardware) continue;
        if (adapter.dedicatedMemory >= adapterMemory) {
            adapterMemory = adapter.dedicatedMemory;
            adapterName = adapter.name;
            hasHardware = true;
        }
    }
    if (!hasHardware) return fail(4, "No hardware GPU adapter detected");
    if (adapterMemory < 512ULL * 1024ULL * 1024ULL) return fail(5, "GPU memory below 512 MiB");

    const nova::Scene scene = makeScene();
    nova::RenderOptions options;
    options.width = 320;
    options.height = 180;
    options.supersample = 1;

    nova::GpuScene gpuScene;
    std::string error;
    if (!nova::buildGpuScene(scene, options, gpuScene, error)) return fail(6, "buildGpuScene failed: " + error);
    if (gpuScene.meshCount != 1) return fail(7, "GPU scene must contain one mesh");
    if (gpuScene.triangleCount != 12) return fail(8, "Cube must produce 12 triangles");
    if (gpuScene.vertices.size() != 24) return fail(9, "Cube must produce 24 vertices");
    if (gpuScene.indices.size() != 36) return fail(10, "Cube must produce 36 indices");
    if (gpuScene.cameraName != "Test Camera") return fail(11, "Camera selection failed");
    if (std::abs(gpuScene.vertices[0].material[0] - 0.42F) > 0.001F) return fail(25, "Default roughness must reach the GPU vertex");
    if (std::abs(gpuScene.vertices[0].material[1] - 0.05F) > 0.001F) return fail(26, "Default metallic must reach the GPU vertex");
    if (gpuScene.vertices[0].material[2] != 0.0F) return fail(27, "Default pattern must be none");
    if (gpuScene.vertices[0].textureIndex != -1.0F) return fail(33, "Untextured vertices must keep texture layer -1");
    if (gpuScene.vertices[0].uv[0] < 0.0F || gpuScene.vertices[0].uv[0] > 1.0F ||
        gpuScene.vertices[0].uv[1] < 0.0F || gpuScene.vertices[0].uv[1] > 1.0F) {
        return fail(28, "Cube UVs must stay in [0,1]");
    }

    // One directional shadow-casting light must produce exactly one shadow map
    // and one GPU light entry.
    if (gpuScene.lights.size() != 1) return fail(34, "GPU scene must export one light");
    if (gpuScene.shadowMaps.size() != 1) return fail(35, "Directional light must export one shadow map");
    if (gpuScene.shadowMaps[0].size < 128 || gpuScene.shadowMaps[0].size > 2048) {
        return fail(36, "Shadow map resolution must stay in 128..2048");
    }

    nova::Scene patternedScene = makeScene();
    patternedScene.findEntity("entity-2")->material = nova::Material{{0.8F, 0.7F, 0.2F}, 0.6F, 0.2F, 8.0F, nova::SurfacePattern::Checker, false};
    nova::GpuScene patternedGpu;
    if (!nova::buildGpuScene(patternedScene, options, patternedGpu, error)) return fail(29, "Patterned GPU scene failed: " + error);
    if (patternedGpu.vertices[0].material[2] != 1.0F) return fail(30, "Checker pattern id must reach the GPU vertex");
    if (std::abs(patternedGpu.vertices[0].material[3] - 8.0F) > 0.001F) return fail(31, "Tiling must reach the GPU vertex");

    std::vector<std::uint8_t> solid;
    nova::GpuRenderStats stats;
    if (!nova::renderSceneGpu(gpuScene, options.width, options.height, false, solid, stats, error)) {
        return fail(12, "D3D12 render failed: " + error);
    }
    if (stats.backend != "D3D12") return fail(13, "Backend must report D3D12");
    if (stats.adapter.empty()) return fail(14, "Adapter name must not be empty");
    if (stats.triangles != 12) return fail(15, "Stats must report 12 triangles");
    // 1 shadow + sky + scene + bright + blur + composite.
    if (stats.drawCalls != 6) return fail(16, "Full pipeline must issue six draw calls");
    if (solid.size() != static_cast<std::size_t>(options.width) * static_cast<std::size_t>(options.height) * 4U) {
        return fail(17, "RGBA buffer has the wrong size");
    }
    if (stats.milliseconds <= 0.0) return fail(18, "GPU timing must be positive");

    const std::size_t cornerIndex = pixelOffset(options.width, 4, 4);
    const std::size_t centerIndex = pixelOffset(options.width, options.width / 2, options.height / 2);
    if (solid[centerIndex] == solid[cornerIndex] && solid[centerIndex + 1] == solid[cornerIndex + 1] &&
        solid[centerIndex + 2] == solid[cornerIndex + 2]) {
        return fail(19, "Center pixel must differ from the sky");
    }

    std::vector<std::uint32_t> colours;
    colours.reserve(solid.size() / 4U);
    for (std::size_t index = 0; index < solid.size(); index += 4U) {
        const std::uint32_t colour = (static_cast<std::uint32_t>(solid[index]) << 16U) |
                                     (static_cast<std::uint32_t>(solid[index + 1]) << 8U) |
                                     static_cast<std::uint32_t>(solid[index + 2]);
        if (std::find(colours.begin(), colours.end(), colour) == colours.end()) colours.push_back(colour);
        if (colours.size() > 256) break;
    }
    if (colours.size() < 32) return fail(20, "GPU render is too flat to be shaded");

    // Image texture: written to disk, decoded by the engine and uploaded as a
    // Texture2DArray layer. The textured twin scene must render differently.
    const std::filesystem::path temp = std::filesystem::temp_directory_path();
    const std::string textureName = "nova-gpu-test-texture.png";
    const std::filesystem::path texturePath = temp / textureName;
    std::vector<std::uint8_t> texturePixels(8U * 8U * 4U, 255U);
    for (int y = 0; y < 8; ++y) {
        for (int x = 0; x < 8; ++x) {
            const std::size_t index = (static_cast<std::size_t>(y) * 8U + static_cast<std::size_t>(x)) * 4U;
            const bool bright = ((x + y) & 1) == 0;
            texturePixels[index] = bright ? 240U : 20U;
            texturePixels[index + 1U] = bright ? 20U : 220U;
            texturePixels[index + 2U] = bright ? 60U : 30U;
        }
    }
    if (!nova::writePngFile(texturePath.string(), 8, 8, texturePixels, error)) return fail(37, "GPU test texture write failed");

    nova::RenderOptions textureOptions = options;
    textureOptions.assetRoot = temp.string();
    nova::Scene texturedScene = makeScene();
    texturedScene.findEntity("entity-2")->material =
        nova::Material{{0.95F, 0.95F, 0.95F}, 0.0F, 0.6F, 2.0F, nova::SurfacePattern::None, false, textureName};
    nova::GpuScene texturedGpu;
    if (!nova::buildGpuScene(texturedScene, textureOptions, texturedGpu, error)) return fail(38, "Textured GPU scene failed: " + error);
    if (texturedGpu.textures.size() != 1) return fail(39, "Textured GPU scene must upload one texture layer");
    if (texturedGpu.vertices[0].textureIndex != 0.0F) return fail(40, "Textured vertices must reference layer 0");

    std::vector<std::uint8_t> texturedImage;
    nova::GpuRenderStats texturedStats;
    if (!nova::renderSceneGpu(texturedGpu, options.width, options.height, false, texturedImage,
                              texturedStats, error)) {
        return fail(41, "Textured D3D12 render failed: " + error);
    }
    nova::Scene untexturedScene = makeScene();
    untexturedScene.findEntity("entity-2")->material =
        nova::Material{{0.95F, 0.95F, 0.95F}, 0.0F, 0.6F, 2.0F, nova::SurfacePattern::None, false};
    nova::GpuScene untexturedGpu;
    if (!nova::buildGpuScene(untexturedScene, textureOptions, untexturedGpu, error)) return fail(42, "Untextured GPU scene failed: " + error);
    std::vector<std::uint8_t> untexturedImage;
    nova::GpuRenderStats untexturedStats;
    if (!nova::renderSceneGpu(untexturedGpu, options.width, options.height, false, untexturedImage,
                              untexturedStats, error)) {
        return fail(43, "Untextured D3D12 render failed: " + error);
    }
    if (differingPixels(texturedImage, untexturedImage) < 200U) {
        return fail(44, "Texture sampling must visibly change the GPU frame");
    }
    std::filesystem::remove(texturePath);

    // Shadows on the GPU path: the same scene without shadow maps must differ.
    nova::Scene shadowScene = makeScene();
    shadowScene.findEntity("entity-1")->transform.position = {0.0F, 2.6F, 7.0F};
    shadowScene.findEntity("entity-1")->transform.rotationDegrees = {-22.0F, 0.0F, 0.0F};
    shadowScene.findEntity("entity-2")->transform.position = {0.0F, 1.0F, 0.0F};
    const auto groundId = shadowScene.createEntity("Ground", "Mesh");
    auto* ground = shadowScene.findEntity(groundId);
    ground->primitive = nova::Primitive::Plane;
    ground->primitiveExplicit = true;
    ground->transform.position = {0.0F, -0.5F, 0.0F};
    ground->transform.scale = {8.0F, 1.0F, 8.0F};
    ground->material = nova::Material{{0.78F, 0.78F, 0.80F}, 0.0F, 0.9F, 1.0F, nova::SurfacePattern::None, false};

    nova::GpuScene shadowGpu;
    if (!nova::buildGpuScene(shadowScene, options, shadowGpu, error)) return fail(45, "Shadow GPU scene failed: " + error);
    if (shadowGpu.shadowMaps.size() != 1) return fail(46, "Shadow scene must export one shadow map");
    std::vector<std::uint8_t> shadowImage;
    nova::GpuRenderStats shadowStats;
    if (!nova::renderSceneGpu(shadowGpu, options.width, options.height, false, shadowImage, shadowStats, error)) {
        return fail(47, "Shadow D3D12 render failed: " + error);
    }
    if (shadowStats.drawCalls != 6) return fail(48, "Shadowed frame must issue six draw calls");
    nova::GpuScene noShadowGpu = shadowGpu;
    noShadowGpu.shadowMaps.clear();
    for (auto& light : noShadowGpu.lights) light.shadowIndex = -1;
    std::vector<std::uint8_t> noShadowImage;
    nova::GpuRenderStats noShadowStats;
    if (!nova::renderSceneGpu(noShadowGpu, options.width, options.height, false, noShadowImage,
                              noShadowStats, error)) {
        return fail(49, "Unshadowed D3D12 render failed: " + error);
    }
    if (noShadowStats.drawCalls != 5) return fail(50, "Unshadowed frame must skip the shadow pass");
    const std::size_t shadowDelta = differingPixels(shadowImage, noShadowImage);
    if (shadowDelta < 100U) {
        return fail(51, "Shadow maps must visibly darken the GPU frame (delta " +
                            std::to_string(shadowDelta) + ")");
    }

    // Bloom: high exposure with bloom enabled must differ from the same frame
    // with bloom disabled.
    nova::GpuScene bloomGpu = gpuScene;
    bloomGpu.exposure = 3.0F;
    bloomGpu.bloom = true;
    bloomGpu.bloomIntensity = 0.9F;
    // A bright sky guarantees the bright pass exceeds its luminance threshold.
    bloomGpu.backgroundTop[0] = bloomGpu.backgroundTop[1] = bloomGpu.backgroundTop[2] = 3.2F;
    bloomGpu.backgroundBottom[0] = bloomGpu.backgroundBottom[1] = bloomGpu.backgroundBottom[2] = 2.4F;
    std::vector<std::uint8_t> bloomImage;
    nova::GpuRenderStats bloomStats;
    if (!nova::renderSceneGpu(bloomGpu, options.width, options.height, false, bloomImage, bloomStats, error)) {
        return fail(52, "Bloom D3D12 render failed: " + error);
    }
    bloomGpu.bloom = false;
    std::vector<std::uint8_t> noBloomImage;
    nova::GpuRenderStats noBloomStats;
    if (!nova::renderSceneGpu(bloomGpu, options.width, options.height, false, noBloomImage,
                              noBloomStats, error)) {
        return fail(53, "No-bloom D3D12 render failed: " + error);
    }
    const std::size_t bloomDelta = differingPixels(bloomImage, noBloomImage);
    if (bloomDelta < 100U) {
        return fail(54, "Bloom must visibly change the GPU frame (delta " +
                            std::to_string(bloomDelta) + ")");
    }

    std::vector<std::uint8_t> wireframe;
    nova::GpuRenderStats wireStats;
    if (!nova::renderSceneGpu(gpuScene, options.width, options.height, true, wireframe, wireStats, error)) {
        return fail(21, "Wireframe render failed: " + error);
    }
    std::size_t differing = 0;
    for (std::size_t index = 0; index < solid.size(); index += 4U) {
        if (solid[index] != wireframe[index] || solid[index + 1] != wireframe[index + 1] ||
            solid[index + 2] != wireframe[index + 2]) {
            ++differing;
        }
    }
    if (differing < 200) return fail(22, "Wireframe output is too close to the solid render");

    const auto png = nova::encodePngRgba(options.width, options.height, solid);
    if (png.size() < 1024) return fail(23, "Encoded PNG is suspiciously small");
    if (png[0] != 0x89 || png[1] != 'P' || png[2] != 'N' || png[3] != 'G') return fail(24, "PNG signature missing");

    std::cout << "GPU tests passed: " << stats.backend << " on " << stats.adapter << ", " << stats.triangles
              << " triangles, " << stats.drawCalls << " draw calls, " << solid.size() << " RGBA bytes, "
              << colours.size() << " sampled colours, " << stats.milliseconds << " ms, PNG "
              << png.size() << " bytes, wireframe delta " << differing << " pixels, shadows "
              << differingPixels(shadowImage, noShadowImage) << " px, bloom "
              << differingPixels(bloomImage, noBloomImage) << " px\n";
    return 0;
}
