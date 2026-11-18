#include "nova/nova_window.hpp"

namespace nova {

struct NativeWindow::Impl {};

NativeWindow::NativeWindow() = default;
NativeWindow::~NativeWindow() { close(); }

bool NativeWindow::open(const NativeWindowDesc&, std::string& error) {
    error = "La fenêtre native D3D12 est implémentée uniquement sous Windows dans cette version.";
    return false;
}

void NativeWindow::close() noexcept {
    delete impl_;
    impl_ = nullptr;
}

bool NativeWindow::isOpen() const noexcept { return false; }
bool NativeWindow::pump() { return false; }
NativeInput NativeWindow::takeInput() noexcept { return {}; }
int NativeWindow::width() const noexcept { return 0; }
int NativeWindow::height() const noexcept { return 0; }
bool NativeWindow::minimized() const noexcept { return true; }
bool NativeWindow::wireframe() const noexcept { return false; }
void NativeWindow::setWireframe(bool) noexcept {}
const std::string& NativeWindow::adapter() const noexcept {
    static const std::string empty;
    return empty;
}

bool NativeWindow::render(const GpuScene&, const CameraPose&, bool, std::vector<std::uint8_t>*,
                          GpuRenderStats&, std::string& error) {
    error = "La fenêtre native D3D12 est implémentée uniquement sous Windows dans cette version.";
    return false;
}

}  // namespace nova
