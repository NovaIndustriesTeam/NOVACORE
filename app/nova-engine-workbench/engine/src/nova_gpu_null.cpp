// Fallback RHI implementation for platforms without a compiled GPU backend.
// It reports the truth instead of pretending to render: Metal (macOS) and
// Vulkan backends are future work, and the software rasterizer remains the
// supported path until they land.
#include "nova/nova_gpu.hpp"

namespace nova {

GpuInfo queryGpuInfo() {
    GpuInfo info;
    info.available = false;
    info.error = "Aucun backend GPU n'est compilé pour cette plateforme (Metal/Vulkan à venir).";
    return info;
}

bool renderSceneGpu(const GpuScene&, int, int, bool, std::vector<std::uint8_t>& rgba,
                    GpuRenderStats& stats, std::string& error) {
    rgba.clear();
    stats = GpuRenderStats{};
    error = "Rendu GPU indisponible : aucun backend compilé (Metal/Vulkan à venir).";
    return false;
}

}  // namespace nova
