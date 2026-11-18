// NovaEngine — Direct3D 12 backend.
//
// This is a real GPU path: a D3D12 device is created, a root signature and
// pipelines (shadow depth-only, sky, PBR solid/wire, bloom and composite) are
// compiled at runtime, geometry is uploaded to the GPU, the scene is rasterized
// into an HDR target with a depth buffer, post-processed (bright pass, blur,
// ACES, sRGB) and read back to CPU memory to be encoded as PNG by the engine's
// own writer. The native window runtime lives in nova_d3d12_window.cpp and
// shares the same shaders, pipelines and frame resources through
// nova_d3d12_common.hpp.
//
// Multi-light shading, PNG/JPEG textures, directional + spot shadow maps with
// PCF and HDR bloom are implemented in this path. Deliberately absent from this
// offscreen path (never claimed as done):
//   - MSAA, compute passes, ray tracing
//   - point-light shadow maps (only directional and spot cast shadows)
#include "nova/nova_gpu.hpp"
#include "nova_d3d12_common.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace nova {
using d3d12::check;
using d3d12::createAdapterDevice;
using d3d12::createBuffer;
using d3d12::createPipelines;
using d3d12::createRootSignature;
using d3d12::createTexture2D;
using d3d12::ensureFrameResources;
using d3d12::frameConstants;
using d3d12::hresultText;
using d3d12::recordFrame;
using d3d12::transition;
using d3d12::wideToUtf8;
namespace {

using Microsoft::WRL::ComPtr;

}  // namespace

GpuInfo queryGpuInfo() {
    GpuInfo info;
    info.backend = "D3D12";

    ComPtr<IDXGIFactory4> factory;
    const HRESULT result = CreateDXGIFactory1(IID_PPV_ARGS(factory.GetAddressOf()));
    if (FAILED(result)) {
        info.error = "DXGI indisponible (" + hresultText(result) + ").";
        return info;
    }

    std::vector<std::string> seen;
    for (UINT index = 0;; ++index) {
        ComPtr<IDXGIAdapter1> adapter;
        if (factory->EnumAdapters1(index, adapter.GetAddressOf()) == DXGI_ERROR_NOT_FOUND) break;
        DXGI_ADAPTER_DESC1 desc{};
        if (FAILED(adapter->GetDesc1(&desc))) continue;
        // DXGI can expose the same physical adapter more than once (one entry
        // per output or per LUID alias). Deduplicate so callers see real
        // devices only.
        const std::string signature = wideToUtf8(desc.Description) + "#" +
                                      std::to_string(desc.VendorId) + "#" +
                                      std::to_string(desc.DeviceId) + "#" +
                                      std::to_string(desc.DedicatedVideoMemory);
        if (std::find(seen.begin(), seen.end(), signature) != seen.end()) continue;
        seen.push_back(signature);
        GpuAdapterInfo entry;
        entry.name = wideToUtf8(desc.Description);
        entry.backend = "D3D12";
        entry.vendorId = desc.VendorId;
        entry.deviceId = desc.DeviceId;
        entry.dedicatedMemory = static_cast<std::uint64_t>(desc.DedicatedVideoMemory);
        entry.hardware = (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) == 0;
        info.adapters.push_back(entry);
    }

    info.available = !info.adapters.empty();
    if (!info.available) info.error = "Aucun adaptateur DXGI détecté.";
    return info;
}

bool renderSceneGpu(const GpuScene& scene, int width, int height, bool wireframe,
                    std::vector<std::uint8_t>& rgba, GpuRenderStats& stats, std::string& error) {
    rgba.clear();
    stats = GpuRenderStats{};
    if (width < 16 || height < 16 || width > 4096 || height > 4096) {
        error = "Dimensions GPU invalides (16..4096).";
        return false;
    }
    if (scene.vertices.empty() || scene.indices.empty()) {
        error = "Aucune géométrie à rendre sur le GPU.";
        return false;
    }

    const auto start = std::chrono::steady_clock::now();

    ComPtr<ID3D12Device> device;
    std::string adapterName;
    if (!createAdapterDevice(device, adapterName, error)) return false;

    ComPtr<ID3D12CommandQueue> queue;
    D3D12_COMMAND_QUEUE_DESC queueDesc{};
    queueDesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
    queueDesc.Flags = D3D12_COMMAND_QUEUE_FLAG_NONE;
    if (!check(device->CreateCommandQueue(&queueDesc, IID_PPV_ARGS(queue.GetAddressOf())),
               "Création de la file de commandes impossible", error)) {
        return false;
    }

    ComPtr<ID3D12CommandAllocator> allocator;
    if (!check(device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT,
                                              IID_PPV_ARGS(allocator.GetAddressOf())),
               "Création de l'allocateur de commandes impossible", error)) {
        return false;
    }

    ComPtr<ID3D12GraphicsCommandList> commandList;
    if (!check(device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, allocator.Get(), nullptr,
                                         IID_PPV_ARGS(commandList.GetAddressOf())),
               "Création de la liste de commandes impossible", error)) {
        return false;
    }
    // A freshly created command list is already recording and owns its
    // allocator, so it must be closed before the allocator can be reset.
    if (!check(commandList->Close(), "Clôture initiale de la liste de commandes impossible", error)) {
        return false;
    }

    ComPtr<ID3D12RootSignature> rootSignature;
    if (!createRootSignature(device.Get(), rootSignature, error)) return false;

    d3d12::Pipelines pipelines;
    if (!createPipelines(device.Get(), rootSignature.Get(), DXGI_FORMAT_R16G16B16A16_FLOAT,
                         DXGI_FORMAT_R8G8B8A8_UNORM, pipelines, error)) {
        return false;
    }

    d3d12::FrameResources frameResources;
    if (!ensureFrameResources(device.Get(), frameResources, width, height, scene, error)) {
        return false;
    }

    ComPtr<ID3D12Resource> color = createTexture2D(device.Get(), width, height,
                                                   DXGI_FORMAT_R8G8B8A8_UNORM,
                                                   D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,
                                                   D3D12_RESOURCE_STATE_COMMON);
    if (!color) {
        error = "Création de la cible de rendu GPU finale impossible.";
        return false;
    }

    D3D12_DESCRIPTOR_HEAP_DESC rtvHeapDesc{};
    rtvHeapDesc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
    rtvHeapDesc.NumDescriptors = 1;
    rtvHeapDesc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_NONE;
    ComPtr<ID3D12DescriptorHeap> rtvHeap;
    if (!check(device->CreateDescriptorHeap(&rtvHeapDesc, IID_PPV_ARGS(rtvHeap.GetAddressOf())),
               "Création du tas RTV impossible", error)) {
        return false;
    }

    const D3D12_CPU_DESCRIPTOR_HANDLE rtvHandle = rtvHeap->GetCPUDescriptorHandleForHeapStart();
    device->CreateRenderTargetView(color.Get(), nullptr, rtvHandle);

    const UINT64 vertexBytes = static_cast<UINT64>(scene.vertices.size()) * sizeof(GpuVertex);
    const UINT64 indexBytes = static_cast<UINT64>(scene.indices.size()) * sizeof(std::uint32_t);

    // Wireframe is drawn as an explicit line list rather than with the driver's
    // wireframe fill mode: fill mode is optional in D3D12 and is silently
    // ignored by some drivers, whereas a line list is guaranteed and testable.
    std::vector<std::uint32_t> lineIndices;
    if (wireframe) {
        lineIndices.reserve(scene.indices.size() * 2U);
        for (std::size_t index = 0; index + 2U < scene.indices.size(); index += 3U) {
            const std::uint32_t a = scene.indices[index];
            const std::uint32_t b = scene.indices[index + 1U];
            const std::uint32_t c = scene.indices[index + 2U];
            lineIndices.insert(lineIndices.end(), {a, b, b, c, c, a});
        }
    }
    const UINT64 lineBytes = static_cast<UINT64>(lineIndices.size()) * sizeof(std::uint32_t);

    ComPtr<ID3D12Resource> vertexBuffer = createBuffer(device.Get(), vertexBytes, D3D12_HEAP_TYPE_UPLOAD);
    ComPtr<ID3D12Resource> indexBuffer = createBuffer(device.Get(), indexBytes, D3D12_HEAP_TYPE_UPLOAD);
    ComPtr<ID3D12Resource> lineBuffer;
    if (wireframe) lineBuffer = createBuffer(device.Get(), lineBytes, D3D12_HEAP_TYPE_UPLOAD);
    ComPtr<ID3D12Resource> constantBuffer = createBuffer(device.Get(), sizeof(d3d12::FrameConstants), D3D12_HEAP_TYPE_UPLOAD);
    if (!vertexBuffer || !indexBuffer || !constantBuffer || (wireframe && !lineBuffer)) {
        error = "Allocation des buffers GPU impossible.";
        return false;
    }

    void* mapped = nullptr;
    if (FAILED(vertexBuffer->Map(0, nullptr, &mapped))) {
        error = "Mappage du vertex buffer GPU impossible.";
        return false;
    }
    std::memcpy(mapped, scene.vertices.data(), static_cast<std::size_t>(vertexBytes));
    vertexBuffer->Unmap(0, nullptr);

    mapped = nullptr;
    if (FAILED(indexBuffer->Map(0, nullptr, &mapped))) {
        error = "Mappage de l'index buffer GPU impossible.";
        return false;
    }
    std::memcpy(mapped, scene.indices.data(), static_cast<std::size_t>(indexBytes));
    indexBuffer->Unmap(0, nullptr);

    if (wireframe) {
        mapped = nullptr;
        if (FAILED(lineBuffer->Map(0, nullptr, &mapped))) {
            error = "Mappage du buffer filaire GPU impossible.";
            return false;
        }
        std::memcpy(mapped, lineIndices.data(), static_cast<std::size_t>(lineBytes));
        lineBuffer->Unmap(0, nullptr);
    }

    const d3d12::FrameConstants constants = frameConstants(scene);

    mapped = nullptr;
    if (FAILED(constantBuffer->Map(0, nullptr, &mapped))) {
        error = "Mappage du constant buffer GPU impossible.";
        return false;
    }
    std::memcpy(mapped, &constants, sizeof(constants));
    constantBuffer->Unmap(0, nullptr);

    const UINT alignedRowPitch = (static_cast<UINT>(width) * 4U + D3D12_TEXTURE_DATA_PITCH_ALIGNMENT - 1U) &
                                 ~(D3D12_TEXTURE_DATA_PITCH_ALIGNMENT - 1U);
    ComPtr<ID3D12Resource> readback =
        createBuffer(device.Get(), static_cast<UINT64>(alignedRowPitch) * static_cast<UINT64>(height),
                     D3D12_HEAP_TYPE_READBACK);
    if (!readback) {
        error = "Création du buffer de lecture GPU impossible.";
        return false;
    }

    if (!check(allocator->Reset(), "Réinitialisation de l'allocateur impossible", error)) return false;
    if (!check(commandList->Reset(allocator.Get(), nullptr),
               "Réinitialisation de la liste de commandes impossible", error)) {
        return false;
    }

    auto* list = commandList.Get();
    const D3D12_RESOURCE_BARRIER toTarget =
        transition(color.Get(), D3D12_RESOURCE_STATE_COMMON, D3D12_RESOURCE_STATE_RENDER_TARGET);
    list->ResourceBarrier(1, &toTarget);

    D3D12_VERTEX_BUFFER_VIEW vertexView{};
    vertexView.BufferLocation = vertexBuffer->GetGPUVirtualAddress();
    vertexView.SizeInBytes = static_cast<UINT>(vertexBytes);
    vertexView.StrideInBytes = sizeof(GpuVertex);

    D3D12_INDEX_BUFFER_VIEW triangleIndexView{};
    triangleIndexView.BufferLocation = indexBuffer->GetGPUVirtualAddress();
    triangleIndexView.SizeInBytes = static_cast<UINT>(indexBytes);
    triangleIndexView.Format = DXGI_FORMAT_R32_UINT;

    D3D12_INDEX_BUFFER_VIEW drawIndexView = triangleIndexView;
    if (wireframe) {
        drawIndexView.BufferLocation = lineBuffer->GetGPUVirtualAddress();
        drawIndexView.SizeInBytes = static_cast<UINT>(lineBytes);
    }
    const UINT drawIndexCount = static_cast<UINT>(wireframe ? lineIndices.size() : scene.indices.size());

    int drawCalls = 0;
    recordFrame(list, rootSignature.Get(), pipelines, frameResources, scene,
                constantBuffer->GetGPUVirtualAddress(), vertexView, triangleIndexView,
                static_cast<UINT>(scene.indices.size()), drawIndexView, drawIndexCount,
                wireframe, rtvHandle, drawCalls);

    D3D12_RESOURCE_BARRIER toCopy =
        transition(color.Get(), D3D12_RESOURCE_STATE_RENDER_TARGET, D3D12_RESOURCE_STATE_COPY_SOURCE);
    list->ResourceBarrier(1, &toCopy);

    D3D12_TEXTURE_COPY_LOCATION destination{};
    destination.pResource = readback.Get();
    destination.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;
    destination.PlacedFootprint.Offset = 0;
    destination.PlacedFootprint.Footprint.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    destination.PlacedFootprint.Footprint.Width = static_cast<UINT>(width);
    destination.PlacedFootprint.Footprint.Height = static_cast<UINT>(height);
    destination.PlacedFootprint.Footprint.Depth = 1;
    destination.PlacedFootprint.Footprint.RowPitch = alignedRowPitch;

    D3D12_TEXTURE_COPY_LOCATION source{};
    source.pResource = color.Get();
    source.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
    source.SubresourceIndex = 0;

    list->CopyTextureRegion(&destination, 0, 0, 0, &source, nullptr);

    if (!check(commandList->Close(), "Clôture de la liste de commandes impossible", error)) return false;

    ID3D12CommandList* const lists[] = {commandList.Get()};
    queue->ExecuteCommandLists(1, lists);

    ComPtr<ID3D12Fence> fence;
    if (!check(device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(fence.GetAddressOf())),
               "Création de la fence GPU impossible", error)) {
        return false;
    }
    HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!event) {
        error = "Création de l'événement de synchronisation GPU impossible.";
        return false;
    }
    if (!check(queue->Signal(fence.Get(), 1), "Signal de la fence GPU impossible", error)) {
        CloseHandle(event);
        return false;
    }
    if (!check(fence->SetEventOnCompletion(1, event), "Attente de la fence GPU impossible", error)) {
        CloseHandle(event);
        return false;
    }
    const DWORD wait = WaitForSingleObject(event, 15000);
    CloseHandle(event);
    if (wait != WAIT_OBJECT_0) {
        error = "Le GPU n'a pas terminé le rendu dans le délai imparti.";
        return false;
    }
    if (FAILED(device->GetDeviceRemovedReason())) {
        error = "Le périphérique GPU a été retiré pendant le rendu.";
        return false;
    }

    mapped = nullptr;
    D3D12_RANGE readRange{0, static_cast<SIZE_T>(alignedRowPitch) * static_cast<SIZE_T>(height)};
    if (FAILED(readback->Map(0, &readRange, &mapped))) {
        error = "Lecture du résultat GPU impossible.";
        return false;
    }
    rgba.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4U);
    const auto* bytes = static_cast<const std::uint8_t*>(mapped);
    for (int row = 0; row < height; ++row) {
        std::memcpy(rgba.data() + static_cast<std::size_t>(row) * static_cast<std::size_t>(width) * 4U,
                    bytes + static_cast<std::size_t>(row) * static_cast<std::size_t>(alignedRowPitch),
                    static_cast<std::size_t>(width) * 4U);
    }
    D3D12_RANGE writeRange{0, 0};
    readback->Unmap(0, &writeRange);

    const auto end = std::chrono::steady_clock::now();
    stats.width = width;
    stats.height = height;
    stats.meshes = scene.meshCount;
    stats.lights = scene.lightCount;
    stats.triangles = scene.triangleCount;
    stats.drawCalls = drawCalls;
    stats.backend = "D3D12";
    stats.adapter = adapterName;
    stats.milliseconds = std::chrono::duration<double, std::milli>(end - start).count();
    return true;
}

}  // namespace nova
