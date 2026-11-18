#include "nova/nova_gpu.hpp"

namespace nova {

const char* gpuBackendName(GpuBackend backend) noexcept {
    switch (backend) {
        case GpuBackend::Auto: return "auto";
        case GpuBackend::D3D12: return "D3D12";
        case GpuBackend::Metal: return "Metal";
        case GpuBackend::Vulkan: return "Vulkan";
        case GpuBackend::Software: return "Software";
    }
    return "inconnu";
}

bool parseGpuBackend(std::string_view name, GpuBackend& backend) noexcept {
    if (name == "auto") { backend = GpuBackend::Auto; return true; }
    if (name == "d3d12" || name == "dx12" || name == "directx12") { backend = GpuBackend::D3D12; return true; }
    if (name == "metal") { backend = GpuBackend::Metal; return true; }
    if (name == "vulkan" || name == "vk") { backend = GpuBackend::Vulkan; return true; }
    if (name == "software" || name == "cpu" || name == "soft") { backend = GpuBackend::Software; return true; }
    return false;
}

}  // namespace nova
