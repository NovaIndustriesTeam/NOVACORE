#include "nova/nova_camera.hpp"
#include "nova/nova_gpu.hpp"
#include "nova/nova_render.hpp"
#include "nova/nova_window.hpp"

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
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
    scene.setName("Window Test");

    const auto cameraId = scene.createEntity("Test Camera", "Camera");
    auto* camera = scene.findEntity(cameraId);
    camera->transform.position = {0.0F, 0.8F, 4.5F};
    camera->transform.rotationDegrees = {-10.0F, 0.0F, 0.0F};

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

std::size_t differingPixels(const std::vector<std::uint8_t>& a,
                            const std::vector<std::uint8_t>& b) {
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

std::size_t uniqueColours(const std::vector<std::uint8_t>& rgba) {
    std::vector<std::uint32_t> colours;
    colours.reserve(std::min<std::size_t>(rgba.size() / 4U, 4096U));
    for (std::size_t index = 0; index + 3U < rgba.size(); index += 4U) {
        const std::uint32_t colour = (static_cast<std::uint32_t>(rgba[index]) << 16U) |
                                     (static_cast<std::uint32_t>(rgba[index + 1U]) << 8U) |
                                     static_cast<std::uint32_t>(rgba[index + 2U]);
        if (std::find(colours.begin(), colours.end(), colour) == colours.end()) {
            colours.push_back(colour);
            if (colours.size() >= 512U) break;
        }
    }
    return colours.size();
}

bool pngSignature(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    unsigned char signature[4]{};
    file.read(reinterpret_cast<char*>(signature), 4);
    return file.gcount() == 4 && signature[0] == 0x89 && signature[1] == 'P' &&
           signature[2] == 'N' && signature[3] == 'G';
}

}  // namespace

int main() {
    const auto engine = nova::info();
    if (engine.version != "0.8.0") return fail(1, "Engine version must be 0.8.0");
    if (engine.apiVersion != 6) return fail(2, "Engine API version must be 6");
    if (!nova::isSupportedApiVersion(6)) return fail(3, "API 6 must be supported");

    const nova::Scene scene = makeScene();
    nova::RenderOptions options;
    options.width = 320;
    options.height = 240;
    options.supersample = 1;

    nova::GpuScene gpuScene;
    std::string error;
    if (!nova::buildGpuScene(scene, options, gpuScene, error)) {
        return fail(4, "buildGpuScene failed: " + error);
    }
    if (gpuScene.triangleCount != 12) return fail(5, "Cube must produce 12 triangles");
    if (gpuScene.shadowMaps.size() != 1) return fail(32, "Window scene must export one shadow map");

    nova::NativeWindow window;
    nova::NativeWindowDesc desc;
    desc.width = 320;
    desc.height = 240;
    desc.visible = false;
    desc.title = "Nova Engine — test fenêtre cachée";
    if (!window.open(desc, error)) return fail(6, "NativeWindow::open failed: " + error);
    if (!window.isOpen()) return fail(7, "Window must report itself open");
    if (window.width() != 320 || window.height() != 240) {
        return fail(8, "Window client size must be 320x240");
    }
    if (window.adapter().empty()) return fail(9, "Window must report its D3D12 adapter");
    if (!window.pump()) return fail(10, "Window pump must keep a fresh window alive");

    nova::CameraPose poseA;
    poseA.position[0] = 0.0F;
    poseA.position[1] = 0.8F;
    poseA.position[2] = 4.5F;
    poseA.yawDegrees = 0.0F;
    poseA.pitchDegrees = -10.0F;

    nova::CameraPose poseB;
    poseB.position[0] = 1.8F;
    poseB.position[1] = 1.4F;
    poseB.position[2] = 4.0F;
    poseB.yawDegrees = 28.0F;
    poseB.pitchDegrees = -12.0F;

    std::vector<std::uint8_t> captureA;
    nova::GpuRenderStats statsA;
    if (!window.render(gpuScene, poseA, false, &captureA, statsA, error)) {
        return fail(11, "First native frame failed: " + error);
    }
    if (statsA.backend != "D3D12") return fail(12, "Native frame must report D3D12");
    if (statsA.width != 320 || statsA.height != 240) return fail(13, "Native frame has wrong size");
    if (statsA.triangles != 12) return fail(14, "Native frame must draw 12 triangles");
    if (statsA.drawCalls != 6) return fail(15, "Native frame must issue six draw calls (shadow, sky, scene, bloom, composite)");
    if (statsA.milliseconds <= 0.0) return fail(16, "Native frame timing must be positive");
    if (captureA.size() != 320U * 240U * 4U) return fail(17, "Capture A has the wrong size");
    if (uniqueColours(captureA) < 32U) return fail(18, "Capture A is too flat to be shaded");

    if (!window.pump()) return fail(19, "Window pump must survive the first presented frame");

    std::vector<std::uint8_t> captureB;
    nova::GpuRenderStats statsB;
    if (!window.render(gpuScene, poseB, false, &captureB, statsB, error)) {
        return fail(20, "Second native frame failed: " + error);
    }
    if (captureB.size() != captureA.size()) return fail(21, "Capture B has the wrong size");
    const std::size_t differing = differingPixels(captureA, captureB);
    if (differing < 1000U) {
        return fail(22, "Two different camera poses produced nearly identical frames");
    }

    // Wireframe must genuinely change the pixels on the native path too.
    std::vector<std::uint8_t> wire;
    nova::GpuRenderStats wireStats;
    if (!window.render(gpuScene, poseA, true, &wire, wireStats, error)) {
        return fail(23, "Wireframe native frame failed: " + error);
    }
    if (differingPixels(captureA, wire) < 500U) {
        return fail(24, "Wireframe native frame is too close to the solid frame");
    }

    if (!window.pump()) return fail(25, "Window pump must survive wireframe presentation");

    const std::filesystem::path temp = std::filesystem::temp_directory_path();
    const std::string pathA = (temp / "nova-window-capture-a.png").string();
    const std::string pathB = (temp / "nova-window-capture-b.png").string();
    if (!nova::writePngFile(pathA, statsA.width, statsA.height, captureA, error)) {
        return fail(26, "PNG write A failed: " + error);
    }
    if (!nova::writePngFile(pathB, statsB.width, statsB.height, captureB, error)) {
        return fail(27, "PNG write B failed: " + error);
    }
    const auto bytesA = std::filesystem::file_size(pathA);
    const auto bytesB = std::filesystem::file_size(pathB);
    if (bytesA < 1000U || bytesB < 1000U) return fail(28, "Captured PNG is suspiciously small");
    if (!pngSignature(pathA) || !pngSignature(pathB)) return fail(29, "PNG signature missing");
    std::filesystem::remove(pathA);
    std::filesystem::remove(pathB);

    window.close();
    if (window.isOpen()) return fail(30, "Window must be closed");
    if (window.width() != 0 || window.height() != 0) return fail(31, "Closed window must report 0x0");

    std::cout << "Native window tests passed: D3D12 on " << statsA.adapter << ", " << statsA.width
              << "x" << statsA.height << ", " << statsA.triangles << " triangles, " << differing
              << " pixels changed between camera poses, PNG A " << bytesA << " bytes, PNG B "
              << bytesB << " bytes\n";
    return 0;
}
