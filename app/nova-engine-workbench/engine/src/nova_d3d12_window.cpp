// NovaEngine — native Win32 runtime window with a Direct3D 12 flip-model
// swapchain.
//
// This is a real presentation path, not a mock: a Win32 window is created, a
// DXGI swapchain is attached to its HWND, the exact same HLSL shaders and PBR
// pipelines as the offscreen backend (nova_d3d12_common.hpp) are executed on the
// GPU every frame, and the presented back buffer can be copied back to CPU
// memory for a deterministic PNG capture.
//
// Deliberately absent from this iteration (never claimed as done): Metal,
// Vulkan, MSAA, ray tracing, audio and Vulkan-style multithreaded command
// recording. PNG/JPEG textures, multi-light shading, directional + spot shadow
// maps with PCF, HDR bloom and ACES tonemapping are implemented and shared with
// the offscreen backend.

#include "nova/nova_window.hpp"

#include "nova/nova_camera.hpp"
#include "nova_d3d12_common.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>

#include <d3d12.h>
#include <dxgi1_6.h>
#include <wrl/client.h>

#include <algorithm>
#include <chrono>
#include <cstring>
#include <string>
#include <vector>

namespace nova {
namespace {

using Microsoft::WRL::ComPtr;

constexpr UINT kFrameCount = 3;
constexpr DWORD kFenceTimeoutMs = 15000;
constexpr wchar_t kWindowClass[] = L"NovaEngineRuntimeWindow";

std::wstring utf8ToWide(const std::string& value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
    if (size <= 1) return {};
    std::wstring result(static_cast<std::size_t>(size - 1), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, result.data(), size);
    return result;
}

int mouseX(LPARAM value) noexcept { return static_cast<int>(static_cast<short>(LOWORD(value))); }
int mouseY(LPARAM value) noexcept { return static_cast<int>(static_cast<short>(HIWORD(value))); }

}  // namespace

struct NativeWindow::Impl {
    HINSTANCE instance{};
    HWND hwnd{};
    int width{};
    int height{};
    bool visible{true};
    bool running{false};
    bool minimizedFlag{false};
    bool wireframeFlag{false};
    bool mouseCaptured{false};
    bool keys[256]{};
    float mouseDeltaX{};
    float mouseDeltaY{};
    bool resizePending{false};
    int pendingWidth{};
    int pendingHeight{};
    std::string adapterName;

    ComPtr<ID3D12Device> device;
    ComPtr<IDXGISwapChain3> swapchain;
    ComPtr<ID3D12CommandQueue> queue;
    ComPtr<ID3D12CommandAllocator> allocator;
    ComPtr<ID3D12GraphicsCommandList> list;
    ComPtr<ID3D12RootSignature> rootSignature;
    d3d12::Pipelines pipelines;
    d3d12::FrameResources frameResources;
    ComPtr<ID3D12DescriptorHeap> rtvHeap;
    ComPtr<ID3D12Resource> renderTargets[kFrameCount];
    D3D12_CPU_DESCRIPTOR_HANDLE rtvHandles[kFrameCount]{};
    UINT rtvDescriptorSize{};
    DXGI_FORMAT format{DXGI_FORMAT_R8G8B8A8_UNORM};
    ComPtr<ID3D12Fence> fence;
    HANDLE fenceEvent{};
    UINT64 fenceValue{};
    bool buffersReady{false};

    ComPtr<ID3D12Resource> vertexBuffer;
    ComPtr<ID3D12Resource> indexBuffer;
    ComPtr<ID3D12Resource> lineBuffer;
    ComPtr<ID3D12Resource> constantBuffer;
    UINT64 vertexCapacity{};
    UINT64 indexCapacity{};
    UINT64 lineCapacity{};

    ComPtr<ID3D12Resource> readback;
    UINT readbackPitch{};
    int readbackHeight{};

    static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);

    bool initialize(HWND window, HINSTANCE hinst, int clientWidth, int clientHeight,
                    std::string& error);
    bool createSwapchain(std::string& error);
    bool createDescriptorHeaps(std::string& error);
    bool createRenderTargets(std::string& error);
    void releaseRenderTargets();
    bool waitForGpu(std::string& error);
    bool applyResize(std::string& error);
    bool ensureUpload(ComPtr<ID3D12Resource>& buffer, UINT64& capacity, UINT64 size,
                      const char* what, std::string& error);
    void centerCursor() const;
    void setMouseCapture(bool enabled);
    void resetInput();
    void releaseGpu();
};

LRESULT CALLBACK NativeWindow::Impl::windowProc(HWND hwnd, UINT message, WPARAM wParam,
                                                LPARAM lParam) {
    auto* impl = reinterpret_cast<Impl*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lParam);
        impl = static_cast<Impl*>(create->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(impl));
        if (impl) impl->hwnd = hwnd;
    }
    if (!impl) return DefWindowProcW(hwnd, message, wParam, lParam);

    switch (message) {
        case WM_CLOSE:
            DestroyWindow(hwnd);
            return 0;
        case WM_DESTROY:
            impl->running = false;
            impl->hwnd = nullptr;
            PostQuitMessage(0);
            return 0;
        case WM_SIZE:
            if (wParam == SIZE_MINIMIZED) {
                impl->minimizedFlag = true;
            } else {
                impl->minimizedFlag = false;
                const int nextWidth = static_cast<int>(LOWORD(lParam));
                const int nextHeight = static_cast<int>(HIWORD(lParam));
                if (nextWidth > 0 && nextHeight > 0) {
                    impl->pendingWidth = nextWidth;
                    impl->pendingHeight = nextHeight;
                    impl->resizePending = nextWidth != impl->width || nextHeight != impl->height;
                }
            }
            return 0;
        case WM_KEYDOWN:
        case WM_SYSKEYDOWN:
            if (wParam == VK_ESCAPE) {
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
                return 0;
            }
            if (wParam == VK_F1 && (lParam & (1LL << 30)) == 0) {
                impl->wireframeFlag = !impl->wireframeFlag;
            }
            if (wParam < 256) impl->keys[wParam] = true;
            return 0;
        case WM_KEYUP:
        case WM_SYSKEYUP:
            if (wParam < 256) impl->keys[wParam] = false;
            return 0;
        case WM_KILLFOCUS:
            impl->resetInput();
            return 0;
        case WM_RBUTTONDOWN:
            impl->setMouseCapture(true);
            return 0;
        case WM_RBUTTONUP:
            impl->setMouseCapture(false);
            return 0;
        case WM_MOUSEMOVE:
            if (impl->mouseCaptured) {
                RECT client{};
                GetClientRect(hwnd, &client);
                const int centerX = (client.right - client.left) / 2;
                const int centerY = (client.bottom - client.top) / 2;
                const int x = mouseX(lParam);
                const int y = mouseY(lParam);
                if (x != centerX || y != centerY) {
                    impl->mouseDeltaX += static_cast<float>(x - centerX);
                    impl->mouseDeltaY += static_cast<float>(y - centerY);
                    POINT center{centerX, centerY};
                    ClientToScreen(hwnd, &center);
                    SetCursorPos(center.x, center.y);
                }
            }
            return 0;
        case WM_SETCURSOR:
            if (impl->mouseCaptured) {
                SetCursor(nullptr);
                return TRUE;
            }
            break;
        default:
            break;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

bool NativeWindow::Impl::initialize(HWND window, HINSTANCE hinst, int clientWidth,
                                    int clientHeight, std::string& error) {
    hwnd = window;
    instance = hinst;
    width = clientWidth;
    height = clientHeight;

    if (!d3d12::createAdapterDevice(device, adapterName, error)) return false;

    D3D12_COMMAND_QUEUE_DESC queueDesc{};
    queueDesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
    queueDesc.Flags = D3D12_COMMAND_QUEUE_FLAG_NONE;
    if (!d3d12::check(device->CreateCommandQueue(&queueDesc, IID_PPV_ARGS(queue.GetAddressOf())),
                      "Création de la file de commandes fenêtrée impossible", error)) {
        return false;
    }
    if (!d3d12::check(device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT,
                                                     IID_PPV_ARGS(allocator.GetAddressOf())),
                      "Création de l'allocateur de commandes fenêtré impossible", error)) {
        return false;
    }
    if (!d3d12::check(device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT,
                                                allocator.Get(), nullptr,
                                                IID_PPV_ARGS(list.GetAddressOf())),
                      "Création de la liste de commandes fenêtrée impossible", error)) {
        return false;
    }
    if (!d3d12::check(list->Close(), "Clôture initiale de la liste fenêtrée impossible", error)) {
        return false;
    }

    if (!d3d12::createRootSignature(device.Get(), rootSignature, error)) return false;
    if (!d3d12::createPipelines(device.Get(), rootSignature.Get(), DXGI_FORMAT_R16G16B16A16_FLOAT,
                                format, pipelines, error)) {
        return false;
    }

    if (!d3d12::check(device->CreateFence(0, D3D12_FENCE_FLAG_NONE,
                                          IID_PPV_ARGS(fence.GetAddressOf())),
                      "Création de la fence fenêtrée impossible", error)) {
        return false;
    }
    fenceEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!fenceEvent) {
        error = "Création de l'événement de synchronisation fenêtré impossible.";
        return false;
    }

    if (!createSwapchain(error)) return false;
    if (!createDescriptorHeaps(error)) return false;
    if (!createRenderTargets(error)) return false;

    resizePending = false;
    return true;
}

bool NativeWindow::Impl::createSwapchain(std::string& error) {
    ComPtr<IDXGIFactory4> factory;
    if (!d3d12::check(CreateDXGIFactory1(IID_PPV_ARGS(factory.GetAddressOf())),
                      "DXGI indisponible pour la fenêtre native", error)) {
        return false;
    }

    DXGI_SWAP_CHAIN_DESC1 desc{};
    desc.Width = static_cast<UINT>(width);
    desc.Height = static_cast<UINT>(height);
    desc.Format = format;
    desc.Stereo = FALSE;
    desc.SampleDesc.Count = 1;
    desc.SampleDesc.Quality = 0;
    desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.BufferCount = kFrameCount;
    desc.Scaling = DXGI_SCALING_STRETCH;
    desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
    desc.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
    desc.Flags = 0;

    ComPtr<IDXGISwapChain1> created;
    if (!d3d12::check(factory->CreateSwapChainForHwnd(queue.Get(), hwnd, &desc, nullptr, nullptr,
                                                      created.GetAddressOf()),
                      "Création du swapchain D3D12 impossible", error)) {
        return false;
    }
    // Alt+Enter is deliberately disabled: fullscreen transitions are not part of
    // this lot and must never be silently triggered by the window manager.
    factory->MakeWindowAssociation(hwnd, DXGI_MWA_NO_ALT_ENTER);
    if (!d3d12::check(created.As(&swapchain), "Récupération du swapchain D3D12 impossible",
                      error)) {
        return false;
    }
    return true;
}

bool NativeWindow::Impl::createDescriptorHeaps(std::string& error) {
    D3D12_DESCRIPTOR_HEAP_DESC rtvDesc{};
    rtvDesc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
    rtvDesc.NumDescriptors = kFrameCount;
    rtvDesc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_NONE;
    if (!d3d12::check(device->CreateDescriptorHeap(&rtvDesc, IID_PPV_ARGS(rtvHeap.GetAddressOf())),
                      "Création du tas RTV fenêtré impossible", error)) {
        return false;
    }

    rtvDescriptorSize = device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
    D3D12_CPU_DESCRIPTOR_HANDLE handle = rtvHeap->GetCPUDescriptorHandleForHeapStart();
    for (UINT index = 0; index < kFrameCount; ++index) {
        rtvHandles[index] = handle;
        handle.ptr += rtvDescriptorSize;
    }
    return true;
}

bool NativeWindow::Impl::createRenderTargets(std::string& error) {
    for (UINT index = 0; index < kFrameCount; ++index) {
        if (!d3d12::check(swapchain->GetBuffer(index, IID_PPV_ARGS(renderTargets[index].GetAddressOf())),
                          "Récupération d'un back buffer impossible", error)) {
            return false;
        }
        device->CreateRenderTargetView(renderTargets[index].Get(), nullptr, rtvHandles[index]);
    }

    readback.Reset();
    readbackPitch = 0;
    readbackHeight = 0;
    // Intermediate HDR/bloom/depth/shadow resources depend on the window size.
    // Drop them so the next frame recreates them at the new resolution.
    frameResources = d3d12::FrameResources{};
    buffersReady = false;
    return true;
}

void NativeWindow::Impl::releaseRenderTargets() {
    readback.Reset();
    readbackPitch = 0;
    readbackHeight = 0;
    for (auto& target : renderTargets) target.Reset();
    frameResources = d3d12::FrameResources{};
    buffersReady = false;
}

bool NativeWindow::Impl::waitForGpu(std::string& error) {
    if (!fence || fenceValue == 0) return true;
    if (fence->GetCompletedValue() < fenceValue) {
        if (!fenceEvent) {
            error = "Événement de synchronisation GPU absent.";
            return false;
        }
        if (!d3d12::check(fence->SetEventOnCompletion(fenceValue, fenceEvent),
                          "Attente de la fence fenêtrée impossible", error)) {
            return false;
        }
        if (WaitForSingleObject(fenceEvent, kFenceTimeoutMs) != WAIT_OBJECT_0) {
            error = "Le GPU n'a pas terminé la frame dans le délai imparti.";
            return false;
        }
    }
    if (FAILED(device->GetDeviceRemovedReason())) {
        error = "Le périphérique GPU a été retiré pendant l'exécution.";
        return false;
    }
    return true;
}

bool NativeWindow::Impl::applyResize(std::string& error) {
    if (!resizePending) return true;
    resizePending = false;
    if (pendingWidth < 16 || pendingHeight < 16) return true;
    if (pendingWidth == width && pendingHeight == height) return true;
    if (!waitForGpu(error)) return false;

    releaseRenderTargets();
    if (!d3d12::check(swapchain->ResizeBuffers(kFrameCount, static_cast<UINT>(pendingWidth),
                                               static_cast<UINT>(pendingHeight), format, 0),
                      "Redimensionnement du swapchain impossible", error)) {
        return false;
    }
    width = pendingWidth;
    height = pendingHeight;
    return createRenderTargets(error);
}

bool NativeWindow::Impl::ensureUpload(ComPtr<ID3D12Resource>& buffer, UINT64& capacity,
                                      UINT64 size, const char* what, std::string& error) {
    if (buffer && capacity >= size) return true;
    buffer.Reset();
    buffer = d3d12::createBuffer(device.Get(), std::max<UINT64>(size, 256), D3D12_HEAP_TYPE_UPLOAD);
    if (!buffer) {
        error = std::string("Allocation du buffer ") + what + " impossible.";
        capacity = 0;
        return false;
    }
    capacity = std::max<UINT64>(size, 256);
    return true;
}

void NativeWindow::Impl::centerCursor() const {
    if (!hwnd) return;
    RECT client{};
    GetClientRect(hwnd, &client);
    POINT center{(client.right - client.left) / 2, (client.bottom - client.top) / 2};
    ClientToScreen(hwnd, &center);
    SetCursorPos(center.x, center.y);
}

void NativeWindow::Impl::setMouseCapture(bool enabled) {
    if (enabled == mouseCaptured) return;
    mouseCaptured = enabled;
    if (enabled) {
        SetCapture(hwnd);
        ShowCursor(FALSE);
        centerCursor();
        mouseDeltaX = 0.0F;
        mouseDeltaY = 0.0F;
    } else {
        ReleaseCapture();
        ShowCursor(TRUE);
    }
}

void NativeWindow::Impl::resetInput() {
    std::fill(std::begin(keys), std::end(keys), false);
    mouseDeltaX = 0.0F;
    mouseDeltaY = 0.0F;
    setMouseCapture(false);
}

void NativeWindow::Impl::releaseGpu() {
    releaseRenderTargets();
    readback.Reset();
    vertexBuffer.Reset();
    indexBuffer.Reset();
    lineBuffer.Reset();
    constantBuffer.Reset();
    vertexCapacity = indexCapacity = lineCapacity = 0;
    if (fenceEvent) {
        CloseHandle(fenceEvent);
        fenceEvent = nullptr;
    }
    fence.Reset();
    pipelines = {};
    rootSignature.Reset();
    list.Reset();
    allocator.Reset();
    queue.Reset();
    swapchain.Reset();
    device.Reset();
}

NativeWindow::NativeWindow() = default;
NativeWindow::~NativeWindow() { close(); }

bool NativeWindow::open(const NativeWindowDesc& desc, std::string& error) {
    close();
    if (desc.width < 16 || desc.height < 16 || desc.width > 4096 || desc.height > 4096) {
        error = "Dimensions de fenêtre invalides (16..4096).";
        return false;
    }

    auto* impl = new Impl();
    impl->visible = desc.visible;
    impl_ = impl;

    impl->instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW windowClass{};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.style = CS_HREDRAW | CS_VREDRAW;
    windowClass.lpfnWndProc = &Impl::windowProc;
    windowClass.hInstance = impl->instance;
    windowClass.hCursor = LoadCursorW(nullptr, reinterpret_cast<LPCWSTR>(IDC_ARROW));
    windowClass.hbrBackground = nullptr;
    windowClass.lpszClassName = kWindowClass;
    if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
        error = "Enregistrement de la classe de fenêtre Win32 impossible.";
        close();
        return false;
    }

    DWORD style = WS_OVERLAPPEDWINDOW;
    if (!desc.visible) style &= ~WS_VISIBLE;
    RECT rect{0, 0, desc.width, desc.height};
    AdjustWindowRectEx(&rect, style, FALSE, 0);
    const std::wstring title = utf8ToWide(desc.title);
    HWND hwnd = CreateWindowExW(0, kWindowClass, title.c_str(), style, CW_USEDEFAULT,
                                CW_USEDEFAULT, rect.right - rect.left, rect.bottom - rect.top,
                                nullptr, nullptr, impl->instance, impl);
    if (!hwnd) {
        error = "Création de la fenêtre Win32 impossible.";
        close();
        return false;
    }
    impl->hwnd = hwnd;
    if (desc.visible) {
        ShowWindow(hwnd, SW_SHOW);
        UpdateWindow(hwnd);
        SetForegroundWindow(hwnd);
    }
    impl->running = true;

    if (!impl->initialize(hwnd, impl->instance, desc.width, desc.height, error)) {
        close();
        return false;
    }
    return true;
}

void NativeWindow::close() noexcept {
    if (!impl_) return;
    if (impl_->hwnd) {
        std::string ignored;
        (void)impl_->waitForGpu(ignored);
        impl_->releaseGpu();
        DestroyWindow(impl_->hwnd);
    } else {
        impl_->releaseGpu();
    }
    delete impl_;
    impl_ = nullptr;
}

bool NativeWindow::isOpen() const noexcept { return impl_ && impl_->hwnd && impl_->running; }

bool NativeWindow::pump() {
    if (!impl_ || !impl_->hwnd) return false;
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
        if (message.message == WM_QUIT) {
            impl_->running = false;
            continue;
        }
        TranslateMessage(&message);
        DispatchMessageW(&message);
        if (!impl_ || !impl_->hwnd) break;
    }
    return isOpen();
}

NativeInput NativeWindow::takeInput() noexcept {
    NativeInput input;
    if (!impl_) return input;
    input.forward = impl_->keys['W'] || impl_->keys['Z'];
    input.back = impl_->keys['S'];
    input.left = impl_->keys['A'] || impl_->keys['Q'];
    input.right = impl_->keys['D'];
    input.up = impl_->keys['E'];
    input.down = impl_->keys['C'];
    input.sprint = impl_->keys[VK_SHIFT] || impl_->keys[VK_LSHIFT] || impl_->keys[VK_RSHIFT];
    input.mouseCaptured = impl_->mouseCaptured;
    input.mouseDeltaX = impl_->mouseDeltaX;
    input.mouseDeltaY = impl_->mouseDeltaY;
    impl_->mouseDeltaX = 0.0F;
    impl_->mouseDeltaY = 0.0F;
    return input;
}

int NativeWindow::width() const noexcept { return impl_ ? impl_->width : 0; }
int NativeWindow::height() const noexcept { return impl_ ? impl_->height : 0; }
bool NativeWindow::minimized() const noexcept { return !impl_ || impl_->minimizedFlag; }
bool NativeWindow::wireframe() const noexcept { return impl_ && impl_->wireframeFlag; }

void NativeWindow::setWireframe(bool enabled) noexcept {
    if (impl_) impl_->wireframeFlag = enabled;
}

const std::string& NativeWindow::adapter() const noexcept {
    static const std::string empty;
    return impl_ ? impl_->adapterName : empty;
}

bool NativeWindow::render(const GpuScene& scene, const CameraPose& camera, bool wireframe,
                          std::vector<std::uint8_t>* capture, GpuRenderStats& stats,
                          std::string& error) {
    if (!impl_ || !impl_->hwnd) {
        error = "La fenêtre native n'est pas ouverte.";
        return false;
    }
    Impl& state = *impl_;
    if (state.minimizedFlag) {
        error = "Fenêtre réduite : le rendu est suspendu.";
        return false;
    }
    if (scene.vertices.empty() || scene.indices.empty()) {
        error = "Aucune géométrie à rendre dans la fenêtre native.";
        return false;
    }

    const auto start = std::chrono::steady_clock::now();
    if (!state.waitForGpu(error)) return false;
    if (!state.applyResize(error)) return false;
    if (state.width < 16 || state.height < 16) {
        error = "Dimensions de fenêtre invalides pour le rendu.";
        return false;
    }

    const UINT width = static_cast<UINT>(state.width);
    const UINT height = static_cast<UINT>(state.height);

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

    const UINT64 vertexBytes = static_cast<UINT64>(scene.vertices.size()) * sizeof(GpuVertex);
    const UINT64 indexBytes = static_cast<UINT64>(scene.indices.size()) * sizeof(std::uint32_t);
    const UINT64 lineBytes = static_cast<UINT64>(lineIndices.size()) * sizeof(std::uint32_t);

    if (!state.ensureUpload(state.vertexBuffer, state.vertexCapacity, vertexBytes, "de sommets",
                            error)) {
        return false;
    }
    if (!state.ensureUpload(state.indexBuffer, state.indexCapacity, indexBytes, "d'indices",
                            error)) {
        return false;
    }
    if (wireframe &&
        !state.ensureUpload(state.lineBuffer, state.lineCapacity, lineBytes, "filaire", error)) {
        return false;
    }
    if (!state.constantBuffer) {
        state.constantBuffer = d3d12::createBuffer(state.device.Get(), 256,
                                                   D3D12_HEAP_TYPE_UPLOAD);
        if (!state.constantBuffer) {
            error = "Allocation du constant buffer fenêtré impossible.";
            return false;
        }
    }

    void* mapped = nullptr;
    if (FAILED(state.vertexBuffer->Map(0, nullptr, &mapped))) {
        error = "Mappage du vertex buffer fenêtré impossible.";
        return false;
    }
    std::memcpy(mapped, scene.vertices.data(), static_cast<std::size_t>(vertexBytes));
    state.vertexBuffer->Unmap(0, nullptr);

    mapped = nullptr;
    if (FAILED(state.indexBuffer->Map(0, nullptr, &mapped))) {
        error = "Mappage de l'index buffer fenêtré impossible.";
        return false;
    }
    std::memcpy(mapped, scene.indices.data(), static_cast<std::size_t>(indexBytes));
    state.indexBuffer->Unmap(0, nullptr);

    if (wireframe) {
        mapped = nullptr;
        if (FAILED(state.lineBuffer->Map(0, nullptr, &mapped))) {
            error = "Mappage du buffer filaire fenêtré impossible.";
            return false;
        }
        std::memcpy(mapped, lineIndices.data(), static_cast<std::size_t>(lineBytes));
        state.lineBuffer->Unmap(0, nullptr);
    }

    d3d12::FrameConstants constants = d3d12::frameConstants(scene);
    float viewProjection[16]{};
    if (!cameraViewProjection(camera, static_cast<int>(width), static_cast<int>(height),
                              viewProjection)) {
        error = "Matrice de caméra invalide.";
        return false;
    }
    std::memcpy(constants.viewProjection, viewProjection, sizeof(viewProjection));
    constants.cameraPosition[0] = camera.position[0];
    constants.cameraPosition[1] = camera.position[1];
    constants.cameraPosition[2] = camera.position[2];
    constants.cameraPosition[3] = 1.0F;

    mapped = nullptr;
    if (FAILED(state.constantBuffer->Map(0, nullptr, &mapped))) {
        error = "Mappage du constant buffer fenêtré impossible.";
        return false;
    }
    std::memcpy(mapped, &constants, sizeof(constants));
    state.constantBuffer->Unmap(0, nullptr);

    if (capture) {
        const UINT pitch = (width * 4U + D3D12_TEXTURE_DATA_PITCH_ALIGNMENT - 1U) &
                           ~(D3D12_TEXTURE_DATA_PITCH_ALIGNMENT - 1U);
        if (!state.readback || state.readbackPitch != pitch ||
            state.readbackHeight != static_cast<int>(height)) {
            state.readback.Reset();
            state.readback = d3d12::createBuffer(
                state.device.Get(), static_cast<UINT64>(pitch) * static_cast<UINT64>(height),
                D3D12_HEAP_TYPE_READBACK);
            if (!state.readback) {
                error = "Création du buffer de capture fenêtré impossible.";
                return false;
            }
            state.readbackPitch = pitch;
            state.readbackHeight = static_cast<int>(height);
        }
    }

    if (!d3d12::check(state.allocator->Reset(),
                      "Réinitialisation de l'allocateur fenêtré impossible", error)) {
        return false;
    }
    if (!d3d12::check(state.list->Reset(state.allocator.Get(), nullptr),
                      "Réinitialisation de la liste fenêtrée impossible", error)) {
        return false;
    }

    auto* list = state.list.Get();
    const UINT backBufferIndex = state.swapchain->GetCurrentBackBufferIndex();
    ID3D12Resource* backBuffer = state.renderTargets[backBufferIndex].Get();

    if (!d3d12::ensureFrameResources(state.device.Get(), state.frameResources,
                                     static_cast<int>(width), static_cast<int>(height), scene,
                                     error)) {
        return false;
    }

    const D3D12_RESOURCE_BARRIER beginBarrier =
        d3d12::transition(backBuffer, state.buffersReady ? D3D12_RESOURCE_STATE_PRESENT
                                                         : D3D12_RESOURCE_STATE_COMMON,
                          D3D12_RESOURCE_STATE_RENDER_TARGET);
    list->ResourceBarrier(1, &beginBarrier);

    D3D12_VERTEX_BUFFER_VIEW vertexView{};
    vertexView.BufferLocation = state.vertexBuffer->GetGPUVirtualAddress();
    vertexView.SizeInBytes = static_cast<UINT>(vertexBytes);
    vertexView.StrideInBytes = sizeof(GpuVertex);

    D3D12_INDEX_BUFFER_VIEW triangleIndexView{};
    triangleIndexView.BufferLocation = state.indexBuffer->GetGPUVirtualAddress();
    triangleIndexView.SizeInBytes = static_cast<UINT>(indexBytes);
    triangleIndexView.Format = DXGI_FORMAT_R32_UINT;

    ID3D12Resource* drawnIndexBuffer = wireframe ? state.lineBuffer.Get() : state.indexBuffer.Get();
    const UINT drawnIndexCount =
        static_cast<UINT>(wireframe ? lineIndices.size() : scene.indices.size());
    D3D12_INDEX_BUFFER_VIEW drawIndexView{};
    drawIndexView.BufferLocation = drawnIndexBuffer->GetGPUVirtualAddress();
    drawIndexView.SizeInBytes = static_cast<UINT>(wireframe ? lineBytes : indexBytes);
    drawIndexView.Format = DXGI_FORMAT_R32_UINT;

    int drawCalls = 0;
    d3d12::recordFrame(list, state.rootSignature.Get(), state.pipelines, state.frameResources,
                       scene, state.constantBuffer->GetGPUVirtualAddress(), vertexView,
                       triangleIndexView, static_cast<UINT>(scene.indices.size()), drawIndexView,
                       drawnIndexCount, wireframe, state.rtvHandles[backBufferIndex], drawCalls);

    if (capture) {
        D3D12_RESOURCE_BARRIER toCopy = d3d12::transition(
            backBuffer, D3D12_RESOURCE_STATE_RENDER_TARGET, D3D12_RESOURCE_STATE_COPY_SOURCE);
        list->ResourceBarrier(1, &toCopy);

        D3D12_TEXTURE_COPY_LOCATION destination{};
        destination.pResource = state.readback.Get();
        destination.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;
        destination.PlacedFootprint.Offset = 0;
        destination.PlacedFootprint.Footprint.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        destination.PlacedFootprint.Footprint.Width = width;
        destination.PlacedFootprint.Footprint.Height = height;
        destination.PlacedFootprint.Footprint.Depth = 1;
        destination.PlacedFootprint.Footprint.RowPitch = state.readbackPitch;

        D3D12_TEXTURE_COPY_LOCATION source{};
        source.pResource = backBuffer;
        source.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
        source.SubresourceIndex = 0;

        list->CopyTextureRegion(&destination, 0, 0, 0, &source, nullptr);
    }

    D3D12_RESOURCE_BARRIER toPresent = d3d12::transition(
        backBuffer,
        capture ? D3D12_RESOURCE_STATE_COPY_SOURCE : D3D12_RESOURCE_STATE_RENDER_TARGET,
        D3D12_RESOURCE_STATE_PRESENT);
    list->ResourceBarrier(1, &toPresent);
    state.buffersReady = true;

    if (!d3d12::check(state.list->Close(), "Clôture de la liste fenêtrée impossible", error)) {
        return false;
    }
    ID3D12CommandList* const lists[] = {state.list.Get()};
    state.queue->ExecuteCommandLists(1, lists);

    const HRESULT present = state.swapchain->Present(state.visible ? 1U : 0U, 0);
    if (FAILED(present)) {
        error = "Présentation du swapchain impossible (HRESULT " +
                d3d12::hresultText(present) + ").";
        return false;
    }

    ++state.fenceValue;
    if (!d3d12::check(state.queue->Signal(state.fence.Get(), state.fenceValue),
                      "Signal de la fence fenêtrée impossible", error)) {
        return false;
    }

    if (capture) {
        if (!state.waitForGpu(error)) return false;
        mapped = nullptr;
        const D3D12_RANGE readRange{
            0, static_cast<SIZE_T>(state.readbackPitch) * static_cast<SIZE_T>(height)};
        if (FAILED(state.readback->Map(0, &readRange, &mapped))) {
            error = "Lecture de la capture fenêtrée impossible.";
            return false;
        }
        capture->resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4U);
        const auto* bytes = static_cast<const std::uint8_t*>(mapped);
        for (UINT row = 0; row < height; ++row) {
            std::memcpy(capture->data() +
                            static_cast<std::size_t>(row) * static_cast<std::size_t>(width) * 4U,
                        bytes + static_cast<std::size_t>(row) * state.readbackPitch,
                        static_cast<std::size_t>(width) * 4U);
        }
        const D3D12_RANGE writeRange{0, 0};
        state.readback->Unmap(0, &writeRange);
    }

    const auto end = std::chrono::steady_clock::now();
    stats = GpuRenderStats{};
    stats.width = static_cast<int>(width);
    stats.height = static_cast<int>(height);
    stats.meshes = scene.meshCount;
    stats.lights = scene.lightCount;
    stats.triangles = scene.triangleCount;
    stats.drawCalls = drawCalls;
    stats.backend = "D3D12";
    stats.adapter = state.adapterName;
    stats.milliseconds = std::chrono::duration<double, std::milli>(end - start).count();
    return true;
}

}  // namespace nova
