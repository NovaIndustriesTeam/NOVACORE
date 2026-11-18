#pragma once

#include "nova/nova_camera.hpp"
#include "nova/nova_gpu.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace nova {

struct NativeWindowDesc {
    int width{1280};
    int height{720};
    std::string title{"Nova Engine — Runtime D3D12"};
    bool visible{true};
};

// Input snapshot produced by the native window. Mouse deltas are relative to
// the cursor lock and are reset by takeInput().
struct NativeInput {
    bool forward{};
    bool back{};
    bool left{};
    bool right{};
    bool up{};
    bool down{};
    bool sprint{};
    bool mouseCaptured{};
    float mouseDeltaX{};
    float mouseDeltaY{};
};

// A real Win32 window presenting a Direct3D 12 flip-model swapchain. The
// offscreen renderer and this runtime share the same HLSL shaders and PBR
// pipelines; this class adds the event loop, cursor lock, resize handling and
// vsync presentation. Only Windows is implemented today; other platforms get a
// stub that refuses to open instead of pretending to work.
class NativeWindow {
public:
    NativeWindow();
    ~NativeWindow();
    NativeWindow(const NativeWindow&) = delete;
    NativeWindow& operator=(const NativeWindow&) = delete;

    [[nodiscard]] bool open(const NativeWindowDesc& desc, std::string& error);
    void close() noexcept;
    [[nodiscard]] bool isOpen() const noexcept;

    // Processes pending window messages. Returns false once the window has been
    // closed (WM_CLOSE, Escape or WM_QUIT).
    [[nodiscard]] bool pump();

    // Returns the current input and clears the accumulated mouse delta.
    [[nodiscard]] NativeInput takeInput() noexcept;

    [[nodiscard]] int width() const noexcept;
    [[nodiscard]] int height() const noexcept;
    [[nodiscard]] bool minimized() const noexcept;
    [[nodiscard]] bool wireframe() const noexcept;
    void setWireframe(bool enabled) noexcept;

    [[nodiscard]] const std::string& adapter() const noexcept;

    // Renders the scene from `camera`, presents it with vsync and optionally
    // reads the presented frame back as tightly packed top-left RGBA8.
    [[nodiscard]] bool render(const GpuScene& scene, const CameraPose& camera, bool wireframe,
                              std::vector<std::uint8_t>* capture, GpuRenderStats& stats,
                              std::string& error);

private:
    struct Impl;
    Impl* impl_{nullptr};
};

}  // namespace nova
