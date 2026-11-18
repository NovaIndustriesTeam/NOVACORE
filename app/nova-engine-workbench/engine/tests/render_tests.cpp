#include "nova/nova_render.hpp"

#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

namespace {

int fail(int code, const char* message) {
    std::cerr << message << '\n';
    return code;
}

nova::Scene makeScene() {
    nova::Scene scene;
    scene.setName("Render Test");

    const auto cameraId = scene.createEntity("Test Camera", "Camera");
    auto* camera = scene.findEntity(cameraId);
    camera->transform.position = {0.0F, 0.5F, 4.0F};

    const auto cubeId = scene.createEntity("Center Cube", "Mesh");
    auto* cube = scene.findEntity(cubeId);
    cube->transform.position = {0.0F, 0.5F, 0.0F};

    const auto lightId = scene.createEntity("Sun", "Light");
    auto* light = scene.findEntity(lightId);
    light->transform.position = {2.0F, 4.0F, 2.0F};
    light->transform.rotationDegrees = {-40.0F, 30.0F, 0.0F};
    light->components = {"Directional Light"};
    return scene;
}

std::uint32_t readBigEndian(const std::vector<std::uint8_t>& data, std::size_t offset) {
    return (static_cast<std::uint32_t>(data[offset]) << 24U) |
           (static_cast<std::uint32_t>(data[offset + 1]) << 16U) |
           (static_cast<std::uint32_t>(data[offset + 2]) << 8U) |
           static_cast<std::uint32_t>(data[offset + 3]);
}

bool differsFrom(const std::vector<std::uint8_t>& image, int width, int x, int y, const std::uint8_t* reference) {
    const std::size_t index = (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x)) * 4U;
    return image[index] != reference[0] || image[index + 1] != reference[1] || image[index + 2] != reference[2];
}

}  // namespace

int main() {
    const auto engine = nova::info();
    if (engine.version != "0.8.0") return fail(1, "Engine version must be 0.8.0");
    if (engine.apiVersion != 6) return fail(65, "Engine API version must be 6");
    if (!nova::isSupportedApiVersion(engine.apiVersion)) return fail(2, "Renderer API version is not supported");

    const nova::Scene scene = makeScene();
    nova::RenderOptions options;
    options.width = 240;
    options.height = 135;
    options.supersample = 1;

    std::vector<std::uint8_t> first;
    nova::RenderStats stats;
    std::string error;
    if (!nova::renderScene(scene, options, first, stats, error)) return fail(3, error.c_str());
    if (first.size() != static_cast<std::size_t>(options.width) * options.height * 4U) return fail(4, "Unexpected RGBA buffer size");
    if (stats.width != 240 || stats.height != 135) return fail(5, "Unexpected output dimensions");
    if (stats.meshes != 1) return fail(6, "Exactly one mesh must be rendered");
    if (stats.lights != 1) return fail(7, "Exactly one light must be reported");
    if (stats.triangles < 12) return fail(8, "Cube must submit at least 12 triangles");
    if (stats.meshPixels < 500) return fail(9, "Cube must cover a meaningful number of pixels");
    if (stats.cameraName != "Test Camera") return fail(10, "Explicit camera must be selected");

    // The default directional light casts a shadow map.
    if (stats.shadowMaps != 1) return fail(66, "Default directional light must produce one shadow map");
    if (stats.textures != 0) return fail(67, "No image texture must be reported without a material texture");

    const std::size_t center = (static_cast<std::size_t>(67) * 240U + 120U) * 4U;
    if (first[center + 3] != 255U) return fail(11, "Rendered pixels must be opaque");
    const std::uint8_t corner[3] = {first[0], first[1], first[2]};
    if (!differsFrom(first, 240, 120, 67, corner)) return fail(12, "Center of the frame must contain the cube, not the sky");
    if (first[center] == 0U && first[center + 1] == 0U && first[center + 2] == 0U) return fail(13, "Center pixel must be shaded");

    // Same scene and options must produce byte-identical pixels.
    std::vector<std::uint8_t> second;
    nova::RenderStats secondStats;
    if (!nova::renderScene(scene, options, second, secondStats, error)) return fail(14, error.c_str());
    if (first != second) return fail(15, "Renderer must be deterministic");

    // PNG container: signature, IHDR dimensions and stable bytes.
    const auto png = nova::encodePngRgba(240, 135, first);
    if (png.size() < 8U + 25U + 12U) return fail(16, "PNG output is too small");
    static constexpr std::uint8_t signature[8] = {0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
    for (int index = 0; index < 8; ++index) {
        if (png[static_cast<std::size_t>(index)] != signature[index]) return fail(17, "Invalid PNG signature");
    }
    if (readBigEndian(png, 16) != 240U || readBigEndian(png, 20) != 135U) return fail(18, "Invalid PNG dimensions");
    const auto secondPng = nova::encodePngRgba(240, 135, second);
    if (png != secondPng) return fail(19, "PNG encoding must be deterministic");
    if (!nova::encodePngRgba(0, 10, {}).empty()) return fail(20, "Invalid PNG request must fail cleanly");

    // Hidden meshes must not submit geometry.
    nova::Scene hidden = makeScene();
    hidden.findEntity("entity-2")->visible = false;
    std::vector<std::uint8_t> hiddenImage;
    nova::RenderStats hiddenStats;
    if (!nova::renderScene(hidden, options, hiddenImage, hiddenStats, error)) return fail(21, error.c_str());
    if (hiddenStats.triangles != 0 || hiddenStats.meshPixels != 0) return fail(22, "Hidden mesh must not be rasterized");
    if (hiddenImage == first) return fail(23, "Hiding the cube must change the frame");

    // A camera rotated away from the scene must not cover the center pixel.
    nova::Scene reversed = makeScene();
    reversed.findEntity("entity-1")->transform.rotationDegrees = {0.0F, 180.0F, 0.0F};
    std::vector<std::uint8_t> reversedImage;
    nova::RenderStats reversedStats;
    if (!nova::renderScene(reversed, options, reversedImage, reversedStats, error)) return fail(24, error.c_str());
    if (reversedStats.meshPixels != 0) return fail(25, "Camera facing away must not rasterize the cube");

    // Explicit camera selection, including an unknown identifier fallback.
    options.cameraId = "entity-1";
    options.selectedId = "entity-2";
    std::vector<std::uint8_t> selectedImage;
    nova::RenderStats selectedStats;
    if (!nova::renderScene(scene, options, selectedImage, selectedStats, error)) return fail(26, error.c_str());
    if (selectedImage == first) return fail(27, "Selection highlight must alter the frame");

    // Explicit materials: checker pattern, roughness and metallic must change
    // the shaded pixels while staying deterministic.
    nova::RenderOptions materialOptions;
    materialOptions.width = 240;
    materialOptions.height = 135;
    materialOptions.supersample = 1;
    nova::Scene patterned = makeScene();
    patterned.findEntity("entity-2")->material = nova::Material{{0.92F, 0.92F, 0.92F}, 0.0F, 0.65F, 6.0F, nova::SurfacePattern::Checker, false};
    std::vector<std::uint8_t> checkerImage;
    nova::RenderStats checkerStats;
    if (!nova::renderScene(patterned, materialOptions, checkerImage, checkerStats, error)) return fail(31, error.c_str());
    if (checkerImage == first) return fail(32, "Checker material must alter the frame");
    std::vector<std::uint8_t> checkerAgain;
    nova::RenderStats checkerAgainStats;
    if (!nova::renderScene(patterned, materialOptions, checkerAgain, checkerAgainStats, error)) return fail(33, error.c_str());
    if (checkerImage != checkerAgain) return fail(34, "Material rendering must be deterministic");

    patterned.findEntity("entity-2")->material->pattern = nova::SurfacePattern::Grid;
    std::vector<std::uint8_t> gridImage;
    nova::RenderStats gridStats;
    if (!nova::renderScene(patterned, materialOptions, gridImage, gridStats, error)) return fail(35, error.c_str());
    if (gridImage == checkerImage) return fail(36, "Grid and checker patterns must differ");

    nova::Scene glossy = makeScene();
    glossy.findEntity("entity-2")->material = nova::Material{{0.85F, 0.30F, 0.22F}, 0.9F, 0.08F, 1.0F, nova::SurfacePattern::None, false};
    std::vector<std::uint8_t> glossyImage;
    nova::RenderStats glossyStats;
    if (!nova::renderScene(glossy, materialOptions, glossyImage, glossyStats, error)) return fail(37, error.c_str());
    if (glossyImage == first) return fail(38, "Metallic material must alter the frame");

    // Primitive meshes: an explicit sphere must submit a different silhouette
    // from the default cube and stay deterministic.
    nova::Scene primitives = makeScene();
    auto* sphere = primitives.findEntity("entity-2");
    sphere->primitive = nova::Primitive::Sphere;
    sphere->primitiveExplicit = true;
    std::vector<std::uint8_t> sphereImage;
    nova::RenderStats sphereStats;
    if (!nova::renderScene(primitives, materialOptions, sphereImage, sphereStats, error)) return fail(68, error.c_str());
    if (sphereStats.triangles < 12) return fail(69, "Sphere must submit triangles");
    if (sphereImage == first) return fail(70, "Sphere primitive must alter the silhouette");

    // Image textures: a real PNG is written to disk, decoded through stb_image
    // and sampled by the software rasterizer. The stats must report it.
    const std::filesystem::path temp = std::filesystem::temp_directory_path();
    const std::string textureName = "nova-render-test-texture.png";
    const std::filesystem::path texturePath = temp / textureName;
    std::vector<std::uint8_t> texturePixels(8U * 8U * 4U, 255U);
    for (int y = 0; y < 8; ++y) {
        for (int x = 0; x < 8; ++x) {
            const std::size_t index = (static_cast<std::size_t>(y) * 8U + static_cast<std::size_t>(x)) * 4U;
            const bool bright = ((x + y) & 1) == 0;
            texturePixels[index] = bright ? 255U : 10U;
            texturePixels[index + 1U] = bright ? 40U : 200U;
            texturePixels[index + 2U] = bright ? 180U : 20U;
        }
    }
    if (!nova::writePngFile(texturePath.string(), 8, 8, texturePixels, error)) return fail(71, "Test texture write failed");

    nova::RenderOptions textureOptions = materialOptions;
    textureOptions.assetRoot = temp.string();
    nova::Scene textured = makeScene();
    textured.findEntity("entity-2")->material =
        nova::Material{{0.95F, 0.95F, 0.95F}, 0.0F, 0.6F, 2.0F, nova::SurfacePattern::None, false, textureName};
    std::vector<std::uint8_t> texturedImage;
    nova::RenderStats texturedStats;
    if (!nova::renderScene(textured, textureOptions, texturedImage, texturedStats, error)) return fail(72, error.c_str());
    if (texturedStats.textures != 1) return fail(73, "Loaded image texture must be reported");
    if (texturedImage == first) return fail(74, "Image texture must alter the frame");
    std::filesystem::remove(texturePath);

    // Shadows: a directional light over a ground plane + cube must darken the
    // ground when enabled and change the frame when disabled.
    nova::Scene shadowScene = makeScene();
    shadowScene.findEntity("entity-1")->transform.position = {0.0F, 2.6F, 7.0F};
    shadowScene.findEntity("entity-1")->transform.rotationDegrees = {-22.0F, 0.0F, 0.0F};
    auto* shadowCube = shadowScene.findEntity("entity-2");
    shadowCube->transform.position = {0.0F, 1.0F, 0.0F};
    const auto groundId = shadowScene.createEntity("Ground", "Mesh");
    auto* ground = shadowScene.findEntity(groundId);
    ground->primitive = nova::Primitive::Plane;
    ground->primitiveExplicit = true;
    ground->transform.position = {0.0F, -0.5F, 0.0F};
    ground->transform.scale = {8.0F, 1.0F, 8.0F};
    ground->material = nova::Material{{0.78F, 0.78F, 0.80F}, 0.0F, 0.9F, 1.0F, nova::SurfacePattern::None, false};

    nova::RenderOptions shadowOptions;
    shadowOptions.width = 240;
    shadowOptions.height = 135;
    shadowOptions.supersample = 1;
    shadowOptions.shadowResolution = 512;
    shadowOptions.shadows = true;
    std::vector<std::uint8_t> shadowImage;
    nova::RenderStats shadowStats;
    if (!nova::renderScene(shadowScene, shadowOptions, shadowImage, shadowStats, error)) return fail(75, error.c_str());
    if (shadowStats.shadowMaps != 1) return fail(76, "Shadow-casting scene must build one shadow map");

    shadowOptions.shadows = false;
    std::vector<std::uint8_t> unshadowedImage;
    nova::RenderStats unshadowedStats;
    if (!nova::renderScene(shadowScene, shadowOptions, unshadowedImage, unshadowedStats, error)) return fail(77, error.c_str());
    if (unshadowedStats.shadowMaps != 0) return fail(78, "Disabled shadows must not build shadow maps");
    if (shadowImage == unshadowedImage) return fail(79, "Shadow maps must visibly change the frame");

    // Bloom: an emissive cube at high exposure must produce a different frame
    // with bloom enabled, and the effect must stay deterministic.
    nova::Scene glow = makeScene();
    glow.findEntity("entity-2")->material =
        nova::Material{{1.0F, 1.0F, 1.0F}, 0.0F, 0.5F, 1.0F, nova::SurfacePattern::None, true};
    nova::RenderOptions bloomOptions = materialOptions;
    bloomOptions.exposure = 3.0F;
    bloomOptions.bloom = true;
    bloomOptions.bloomIntensity = 0.9F;
    std::vector<std::uint8_t> bloomImage;
    nova::RenderStats bloomStats;
    if (!nova::renderScene(glow, bloomOptions, bloomImage, bloomStats, error)) return fail(80, error.c_str());
    bloomOptions.bloom = false;
    std::vector<std::uint8_t> noBloomImage;
    nova::RenderStats noBloomStats;
    if (!nova::renderScene(glow, bloomOptions, noBloomImage, noBloomStats, error)) return fail(81, error.c_str());
    if (bloomImage == noBloomImage) return fail(82, "Bloom must visibly change the frame");
    bloomOptions.bloom = true;
    std::vector<std::uint8_t> bloomAgain;
    nova::RenderStats bloomAgainStats;
    if (!nova::renderScene(glow, bloomOptions, bloomAgain, bloomAgainStats, error)) return fail(83, error.c_str());
    if (bloomImage != bloomAgain) return fail(84, "Bloom rendering must be deterministic");

    // Supersampling and wireframe paths.
    options = {};
    options.width = 160;
    options.height = 90;
    options.supersample = 2;
    options.wireframe = true;
    std::vector<std::uint8_t> wireframe;
    nova::RenderStats wireStats;
    if (!nova::renderScene(scene, options, wireframe, wireStats, error)) return fail(28, error.c_str());
    if (wireStats.internalWidth != 320 || wireStats.internalHeight != 180) return fail(29, "Supersampling must increase the internal buffer");
    if (wireStats.triangles < 12) return fail(30, "Wireframe still submits triangles");

    std::cout << "NovaRenderTests passed: " << stats.triangles << " triangles, "
              << stats.meshPixels << " shaded pixels, " << stats.shadowMaps << " shadow map, "
              << png.size() << " PNG bytes\n";
    return 0;
}
