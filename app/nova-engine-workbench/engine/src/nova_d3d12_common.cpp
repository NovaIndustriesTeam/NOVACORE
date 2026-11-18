#include "nova_d3d12_common.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace nova::d3d12 {

std::string wideToUtf8(const wchar_t* value) {
    if (!value) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 1) return {};
    std::string result(static_cast<std::size_t>(size - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), size, nullptr, nullptr);
    return result;
}

std::string hresultText(HRESULT result) {
    char buffer[16]{};
    std::snprintf(buffer, sizeof(buffer), "0x%08lX", static_cast<unsigned long>(result));
    return buffer;
}

bool check(HRESULT result, const char* what, std::string& error) {
    if (SUCCEEDED(result)) return true;
    error = std::string(what) + " (HRESULT " + hresultText(result) + ")";
    return false;
}

ComPtr<ID3DBlob> compileShader(const char* source, const char* entry, const char* target,
                               std::string& error) {
    ComPtr<ID3DBlob> shader;
    ComPtr<ID3DBlob> diagnostics;
    const UINT flags = D3DCOMPILE_ENABLE_STRICTNESS | D3DCOMPILE_OPTIMIZATION_LEVEL3;
    const HRESULT result = D3DCompile(source, std::strlen(source), nullptr, nullptr, nullptr, entry,
                                      target, flags, 0, shader.GetAddressOf(),
                                      diagnostics.GetAddressOf());
    if (FAILED(result)) {
        error = std::string("Compilation du shader ") + entry + " impossible : ";
        if (diagnostics) {
            error += static_cast<const char*>(diagnostics->GetBufferPointer());
        } else {
            error += hresultText(result);
        }
        return nullptr;
    }
    return shader;
}

ComPtr<ID3D12Resource> createBuffer(ID3D12Device* device, UINT64 size, D3D12_HEAP_TYPE heapType) {
    D3D12_HEAP_PROPERTIES heap{};
    heap.Type = heapType;
    heap.CPUPageProperty = D3D12_CPU_PAGE_PROPERTY_UNKNOWN;
    heap.MemoryPoolPreference = D3D12_MEMORY_POOL_UNKNOWN;
    heap.CreationNodeMask = 1;
    heap.VisibleNodeMask = 1;

    D3D12_RESOURCE_DESC desc{};
    desc.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
    desc.Width = std::max<UINT64>(size, 1);
    desc.Height = 1;
    desc.DepthOrArraySize = 1;
    desc.MipLevels = 1;
    desc.Format = DXGI_FORMAT_UNKNOWN;
    desc.SampleDesc.Count = 1;
    desc.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
    desc.Flags = D3D12_RESOURCE_FLAG_NONE;

    ComPtr<ID3D12Resource> resource;
    // D3D12 requires UPLOAD buffers in GENERIC_READ and READBACK buffers in
    // COPY_DEST; any other combination is rejected by CreateCommittedResource.
    const D3D12_RESOURCE_STATES initialState = heapType == D3D12_HEAP_TYPE_READBACK
                                                   ? D3D12_RESOURCE_STATE_COPY_DEST
                                                   : D3D12_RESOURCE_STATE_GENERIC_READ;
    if (FAILED(device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &desc,
                                               initialState, nullptr,
                                               IID_PPV_ARGS(resource.GetAddressOf())))) {
        return nullptr;
    }
    return resource;
}

ComPtr<ID3D12Resource> createTexture2D(ID3D12Device* device, int width, int height,
                                       DXGI_FORMAT format, D3D12_RESOURCE_FLAGS flags,
                                       D3D12_RESOURCE_STATES state) {
    return createTexture2DArray(device, width, height, 1, format, flags, state);
}

ComPtr<ID3D12Resource> createTexture2DArray(ID3D12Device* device, int width, int height,
                                            int arraySize, DXGI_FORMAT format,
                                            D3D12_RESOURCE_FLAGS flags,
                                            D3D12_RESOURCE_STATES state) {
    D3D12_HEAP_PROPERTIES heap{};
    heap.Type = D3D12_HEAP_TYPE_DEFAULT;
    heap.CPUPageProperty = D3D12_CPU_PAGE_PROPERTY_UNKNOWN;
    heap.MemoryPoolPreference = D3D12_MEMORY_POOL_UNKNOWN;
    heap.CreationNodeMask = 1;
    heap.VisibleNodeMask = 1;

    D3D12_RESOURCE_DESC desc{};
    desc.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D;
    desc.Alignment = 0;
    desc.Width = static_cast<UINT64>(width);
    desc.Height = static_cast<UINT>(height);
    desc.DepthOrArraySize = static_cast<UINT16>(std::max(1, arraySize));
    desc.MipLevels = 1;
    desc.Format = format;
    desc.SampleDesc.Count = 1;
    desc.SampleDesc.Quality = 0;
    desc.Layout = D3D12_TEXTURE_LAYOUT_UNKNOWN;
    desc.Flags = flags;

    ComPtr<ID3D12Resource> resource;
    if (FAILED(device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &desc, state, nullptr,
                                               IID_PPV_ARGS(resource.GetAddressOf())))) {
        return nullptr;
    }
    return resource;
}

D3D12_RESOURCE_BARRIER transition(ID3D12Resource* resource, D3D12_RESOURCE_STATES before,
                                  D3D12_RESOURCE_STATES after) {
    D3D12_RESOURCE_BARRIER barrier{};
    barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
    barrier.Flags = D3D12_RESOURCE_BARRIER_FLAG_NONE;
    barrier.Transition.pResource = resource;
    barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    barrier.Transition.StateBefore = before;
    barrier.Transition.StateAfter = after;
    return barrier;
}

bool createAdapterDevice(ComPtr<ID3D12Device>& device, std::string& adapterName,
                         std::string& error) {
    ComPtr<IDXGIFactory4> factory;
    if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(factory.GetAddressOf())))) {
        error = "DXGI est indisponible sur cette machine.";
        return false;
    }

    UINT bestIndex = UINT_MAX;
    std::uint64_t bestMemory = 0;
    for (UINT index = 0;; ++index) {
        ComPtr<IDXGIAdapter1> adapter;
        if (factory->EnumAdapters1(index, adapter.GetAddressOf()) == DXGI_ERROR_NOT_FOUND) break;
        DXGI_ADAPTER_DESC1 desc{};
        if (FAILED(adapter->GetDesc1(&desc))) continue;
        if ((desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) continue;
        if (desc.DedicatedVideoMemory >= bestMemory) {
            bestMemory = desc.DedicatedVideoMemory;
            bestIndex = index;
        }
    }

    if (bestIndex != UINT_MAX) {
        ComPtr<IDXGIAdapter1> adapter;
        if (SUCCEEDED(factory->EnumAdapters1(bestIndex, adapter.GetAddressOf()))) {
            DXGI_ADAPTER_DESC1 desc{};
            adapter->GetDesc1(&desc);
            adapterName = wideToUtf8(desc.Description);
            if (SUCCEEDED(D3D12CreateDevice(adapter.Get(), D3D_FEATURE_LEVEL_11_0,
                                            IID_PPV_ARGS(device.GetAddressOf())))) {
                return true;
            }
        }
    }

    adapterName = "WARP (rendu logiciel Direct3D 12)";
    if (FAILED(D3D12CreateDevice(nullptr, D3D_FEATURE_LEVEL_11_0,
                                 IID_PPV_ARGS(device.GetAddressOf())))) {
        error = "Aucun appareil Direct3D 12 compatible n'a pu être créé.";
        return false;
    }
    return true;
}

bool createRootSignature(ID3D12Device* device, ComPtr<ID3D12RootSignature>& rootSignature,
                         std::string& error) {
    D3D12_DESCRIPTOR_RANGE range{};
    range.RangeType = D3D12_DESCRIPTOR_RANGE_TYPE_SRV;
    range.NumDescriptors = 5;  // t0 textures, t1 HDR, t2 bloomA, t3 bloomB, t4 shadows.
    range.BaseShaderRegister = 0;
    range.RegisterSpace = 0;
    range.OffsetInDescriptorsFromTableStart = 0;

    D3D12_ROOT_PARAMETER rootParameters[3]{};
    rootParameters[0].ParameterType = D3D12_ROOT_PARAMETER_TYPE_CBV;
    rootParameters[0].Descriptor.ShaderRegister = 0;
    rootParameters[0].Descriptor.RegisterSpace = 0;
    rootParameters[0].ShaderVisibility = D3D12_SHADER_VISIBILITY_ALL;

    // 16 root constants hold the current shadow light-space matrix (b1).
    rootParameters[1].ParameterType = D3D12_ROOT_PARAMETER_TYPE_32BIT_CONSTANTS;
    rootParameters[1].Constants.ShaderRegister = 1;
    rootParameters[1].Constants.RegisterSpace = 0;
    rootParameters[1].Constants.Num32BitValues = 16;
    rootParameters[1].ShaderVisibility = D3D12_SHADER_VISIBILITY_ALL;

    rootParameters[2].ParameterType = D3D12_ROOT_PARAMETER_TYPE_DESCRIPTOR_TABLE;
    rootParameters[2].DescriptorTable.NumDescriptorRanges = 1;
    rootParameters[2].DescriptorTable.pDescriptorRanges = &range;
    rootParameters[2].ShaderVisibility = D3D12_SHADER_VISIBILITY_ALL;

    D3D12_STATIC_SAMPLER_DESC sampler{};
    sampler.Filter = D3D12_FILTER_MIN_MAG_MIP_LINEAR;
    sampler.AddressU = D3D12_TEXTURE_ADDRESS_MODE_WRAP;
    sampler.AddressV = D3D12_TEXTURE_ADDRESS_MODE_WRAP;
    sampler.AddressW = D3D12_TEXTURE_ADDRESS_MODE_WRAP;
    sampler.MipLODBias = 0.0F;
    sampler.MaxAnisotropy = 1;
    sampler.ComparisonFunc = D3D12_COMPARISON_FUNC_ALWAYS;
    sampler.BorderColor = D3D12_STATIC_BORDER_COLOR_TRANSPARENT_BLACK;
    sampler.MinLOD = 0.0F;
    sampler.MaxLOD = D3D12_FLOAT32_MAX;
    sampler.ShaderRegister = 0;
    sampler.RegisterSpace = 0;
    sampler.ShaderVisibility = D3D12_SHADER_VISIBILITY_ALL;

    D3D12_ROOT_SIGNATURE_DESC rootDesc{};
    rootDesc.NumParameters = 3;
    rootDesc.pParameters = rootParameters;
    rootDesc.NumStaticSamplers = 1;
    rootDesc.pStaticSamplers = &sampler;
    rootDesc.Flags = D3D12_ROOT_SIGNATURE_FLAG_ALLOW_INPUT_ASSEMBLER_INPUT_LAYOUT;

    ComPtr<ID3DBlob> serializedRoot;
    ComPtr<ID3DBlob> rootDiagnostics;
    if (!check(D3D12SerializeRootSignature(&rootDesc, D3D_ROOT_SIGNATURE_VERSION_1,
                                           serializedRoot.GetAddressOf(),
                                           rootDiagnostics.GetAddressOf()),
               "Sérialisation de la root signature impossible", error)) {
        return false;
    }
    return check(device->CreateRootSignature(0, serializedRoot->GetBufferPointer(),
                                             serializedRoot->GetBufferSize(),
                                             IID_PPV_ARGS(rootSignature.GetAddressOf())),
                 "Création de la root signature impossible", error);
}

bool createPipelines(ID3D12Device* device, ID3D12RootSignature* rootSignature,
                     DXGI_FORMAT hdrFormat, DXGI_FORMAT finalFormat, Pipelines& pipelines,
                     std::string& error) {
    const auto compile = [&error](const char* entry, const char* target) {
        return compileShader(kShaderSource, entry, target, error);
    };
    ComPtr<ID3DBlob> vertexScene = compile("VSScene", "vs_5_1");
    if (!vertexScene) return false;
    ComPtr<ID3DBlob> pixelScene = compile("PSScene", "ps_5_1");
    if (!pixelScene) return false;
    ComPtr<ID3DBlob> vertexSky = compile("VSSky", "vs_5_1");
    if (!vertexSky) return false;
    ComPtr<ID3DBlob> pixelSky = compile("PSSky", "ps_5_1");
    if (!pixelSky) return false;
    ComPtr<ID3DBlob> vertexShadow = compile("VSShadow", "vs_5_1");
    if (!vertexShadow) return false;
    ComPtr<ID3DBlob> vertexFullscreen = compile("VSFullscreen", "vs_5_1");
    if (!vertexFullscreen) return false;
    ComPtr<ID3DBlob> pixelBright = compile("PSBright", "ps_5_1");
    if (!pixelBright) return false;
    ComPtr<ID3DBlob> pixelBlur = compile("PSBlur", "ps_5_1");
    if (!pixelBlur) return false;
    ComPtr<ID3DBlob> pixelComposite = compile("PSComposite", "ps_5_1");
    if (!pixelComposite) return false;

    D3D12_INPUT_ELEMENT_DESC inputLayout[] = {
        {"POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0},
        {"NORMAL", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 12, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0},
        {"COLOR", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 24, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0},
        {"TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 36, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0},
        {"TEXCOORD", 1, DXGI_FORMAT_R32G32B32A32_FLOAT, 0, 44, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0},
        {"TEXCOORD", 2, DXGI_FORMAT_R32_FLOAT, 0, 60, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0},
        {"TEXCOORD", 3, DXGI_FORMAT_R32_FLOAT, 0, 64, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0},
    };
    static_assert(sizeof(nova::GpuVertex) == 68, "GpuVertex must match the D3D12 input layout");

    D3D12_RASTERIZER_DESC rasterizer{};
    rasterizer.FillMode = D3D12_FILL_MODE_SOLID;
    rasterizer.CullMode = D3D12_CULL_MODE_NONE;
    rasterizer.FrontCounterClockwise = FALSE;
    rasterizer.DepthBias = D3D12_DEFAULT_DEPTH_BIAS;
    rasterizer.DepthBiasClamp = D3D12_DEFAULT_DEPTH_BIAS_CLAMP;
    rasterizer.SlopeScaledDepthBias = D3D12_DEFAULT_SLOPE_SCALED_DEPTH_BIAS;
    rasterizer.DepthClipEnable = TRUE;
    rasterizer.MultisampleEnable = FALSE;
    rasterizer.AntialiasedLineEnable = FALSE;
    rasterizer.ForcedSampleCount = 0;
    rasterizer.ConservativeRaster = D3D12_CONSERVATIVE_RASTERIZATION_MODE_OFF;

    D3D12_BLEND_DESC blend{};
    blend.AlphaToCoverageEnable = FALSE;
    blend.IndependentBlendEnable = FALSE;
    blend.RenderTarget[0].BlendEnable = FALSE;
    blend.RenderTarget[0].LogicOpEnable = FALSE;
    blend.RenderTarget[0].SrcBlend = D3D12_BLEND_ONE;
    blend.RenderTarget[0].DestBlend = D3D12_BLEND_ZERO;
    blend.RenderTarget[0].BlendOp = D3D12_BLEND_OP_ADD;
    blend.RenderTarget[0].SrcBlendAlpha = D3D12_BLEND_ONE;
    blend.RenderTarget[0].DestBlendAlpha = D3D12_BLEND_ZERO;
    blend.RenderTarget[0].BlendOpAlpha = D3D12_BLEND_OP_ADD;
    blend.RenderTarget[0].LogicOp = D3D12_LOGIC_OP_NOOP;
    blend.RenderTarget[0].RenderTargetWriteMask = D3D12_COLOR_WRITE_ENABLE_ALL;

    D3D12_DEPTH_STENCIL_DESC depthState{};
    depthState.DepthEnable = TRUE;
    depthState.DepthWriteMask = D3D12_DEPTH_WRITE_MASK_ALL;
    depthState.DepthFunc = D3D12_COMPARISON_FUNC_LESS;
    depthState.StencilEnable = FALSE;

    D3D12_GRAPHICS_PIPELINE_STATE_DESC scenePipeline{};
    scenePipeline.InputLayout = {inputLayout, _countof(inputLayout)};
    scenePipeline.pRootSignature = rootSignature;
    scenePipeline.VS = {vertexScene->GetBufferPointer(), vertexScene->GetBufferSize()};
    scenePipeline.PS = {pixelScene->GetBufferPointer(), pixelScene->GetBufferSize()};
    scenePipeline.RasterizerState = rasterizer;
    scenePipeline.BlendState = blend;
    scenePipeline.DepthStencilState = depthState;
    scenePipeline.SampleMask = UINT_MAX;
    scenePipeline.PrimitiveTopologyType = D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
    scenePipeline.NumRenderTargets = 1;
    scenePipeline.RTVFormats[0] = hdrFormat;
    scenePipeline.DSVFormat = DXGI_FORMAT_D32_FLOAT;
    scenePipeline.SampleDesc.Count = 1;
    scenePipeline.SampleDesc.Quality = 0;
    scenePipeline.Flags = D3D12_PIPELINE_STATE_FLAG_NONE;

    if (!check(device->CreateGraphicsPipelineState(&scenePipeline, IID_PPV_ARGS(pipelines.solid.GetAddressOf())),
               "Création du pipeline PBR impossible", error)) {
        return false;
    }

    D3D12_GRAPHICS_PIPELINE_STATE_DESC wirePipeline = scenePipeline;
    wirePipeline.PrimitiveTopologyType = D3D12_PRIMITIVE_TOPOLOGY_TYPE_LINE;
    if (!check(device->CreateGraphicsPipelineState(&wirePipeline, IID_PPV_ARGS(pipelines.wire.GetAddressOf())),
               "Création du pipeline filaire impossible", error)) {
        return false;
    }

    D3D12_DEPTH_STENCIL_DESC skyDepth = depthState;
    skyDepth.DepthEnable = FALSE;
    skyDepth.DepthWriteMask = D3D12_DEPTH_WRITE_MASK_ZERO;

    D3D12_GRAPHICS_PIPELINE_STATE_DESC skyPipeline = scenePipeline;
    skyPipeline.InputLayout = {nullptr, 0};
    skyPipeline.VS = {vertexSky->GetBufferPointer(), vertexSky->GetBufferSize()};
    skyPipeline.PS = {pixelSky->GetBufferPointer(), pixelSky->GetBufferSize()};
    skyPipeline.DepthStencilState = skyDepth;
    if (!check(device->CreateGraphicsPipelineState(&skyPipeline, IID_PPV_ARGS(pipelines.sky.GetAddressOf())),
               "Création du pipeline ciel impossible", error)) {
        return false;
    }

    // Depth-only shadow pass. No render target, no pixel shader: only the
    // light-space depth is written, then sampled with PCF by the scene pass.
    D3D12_GRAPHICS_PIPELINE_STATE_DESC shadowPipeline = scenePipeline;
    shadowPipeline.VS = {vertexShadow->GetBufferPointer(), vertexShadow->GetBufferSize()};
    shadowPipeline.PS = {nullptr, 0};
    shadowPipeline.NumRenderTargets = 0;
    for (auto& format : shadowPipeline.RTVFormats) format = DXGI_FORMAT_UNKNOWN;
    shadowPipeline.PrimitiveTopologyType = D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
    if (!check(device->CreateGraphicsPipelineState(&shadowPipeline, IID_PPV_ARGS(pipelines.shadow.GetAddressOf())),
               "Création du pipeline d'ombres impossible", error)) {
        return false;
    }

    D3D12_DEPTH_STENCIL_DESC noDepth{};
    noDepth.DepthEnable = FALSE;
    noDepth.DepthWriteMask = D3D12_DEPTH_WRITE_MASK_ZERO;
    noDepth.DepthFunc = D3D12_COMPARISON_FUNC_ALWAYS;
    noDepth.StencilEnable = FALSE;

    D3D12_GRAPHICS_PIPELINE_STATE_DESC postPipeline = scenePipeline;
    postPipeline.InputLayout = {nullptr, 0};
    postPipeline.VS = {vertexFullscreen->GetBufferPointer(), vertexFullscreen->GetBufferSize()};
    postPipeline.DepthStencilState = noDepth;
    postPipeline.DSVFormat = DXGI_FORMAT_UNKNOWN;
    postPipeline.PrimitiveTopologyType = D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
    postPipeline.RTVFormats[0] = hdrFormat;

    postPipeline.PS = {pixelBright->GetBufferPointer(), pixelBright->GetBufferSize()};
    if (!check(device->CreateGraphicsPipelineState(&postPipeline, IID_PPV_ARGS(pipelines.bright.GetAddressOf())),
               "Création du pipeline bloom (bright) impossible", error)) {
        return false;
    }
    postPipeline.PS = {pixelBlur->GetBufferPointer(), pixelBlur->GetBufferSize()};
    if (!check(device->CreateGraphicsPipelineState(&postPipeline, IID_PPV_ARGS(pipelines.blur.GetAddressOf())),
               "Création du pipeline bloom (flou) impossible", error)) {
        return false;
    }
    postPipeline.RTVFormats[0] = finalFormat;
    postPipeline.PS = {pixelComposite->GetBufferPointer(), pixelComposite->GetBufferSize()};
    if (!check(device->CreateGraphicsPipelineState(&postPipeline, IID_PPV_ARGS(pipelines.composite.GetAddressOf())),
               "Création du pipeline de composition impossible", error)) {
        return false;
    }
    return true;
}

FrameConstants frameConstants(const GpuScene& scene) noexcept {
    const auto copy3 = [](const float (&source)[3], float (&target)[4]) {
        target[0] = source[0];
        target[1] = source[1];
        target[2] = source[2];
        target[3] = 0.0F;
    };

    FrameConstants constants{};
    std::memcpy(constants.viewProjection, scene.viewProjection, sizeof(constants.viewProjection));
    copy3(scene.cameraPosition, constants.cameraPosition);
    constants.cameraPosition[3] = 1.0F;

    const int shadowCount = std::min<int>(static_cast<int>(scene.shadowMaps.size()), 2);
    for (int index = 0; index < shadowCount; ++index) {
        std::memcpy(constants.shadowViewProjection[index],
                    scene.shadowMaps[static_cast<std::size_t>(index)].viewProjection,
                    sizeof(constants.shadowViewProjection[index]));
    }

    const int lightCount = std::min<int>(static_cast<int>(scene.lights.size()), 8);
    for (int index = 0; index < lightCount; ++index) {
        const GpuLight& light = scene.lights[static_cast<std::size_t>(index)];
        float* data = constants.lightData[index];
        data[0] = light.position[0];
        data[1] = light.position[1];
        data[2] = light.position[2];
        data[3] = static_cast<float>(light.type);
        data[4] = light.direction[0];
        data[5] = light.direction[1];
        data[6] = light.direction[2];
        data[7] = light.range;
        data[8] = light.color[0];
        data[9] = light.color[1];
        data[10] = light.color[2];
        data[11] = light.intensity;
        data[12] = light.cosOuter;
        data[13] = light.cosInner;
        data[14] = static_cast<float>(light.shadowIndex);
        data[15] = 0.0F;
    }

    copy3(scene.ambientSky, constants.ambientSky);
    copy3(scene.ambientGround, constants.ambientGround);
    copy3(scene.backgroundTop, constants.backgroundTop);
    copy3(scene.backgroundBottom, constants.backgroundBottom);
    constants.params[0] = scene.exposure;
    constants.params[1] = 2.2F;  // Selection rim boost.
    constants.params[2] = static_cast<float>(lightCount);
    constants.params[3] = static_cast<float>(shadowCount);
    constants.params2[0] = scene.bloomIntensity;
    constants.params2[1] = scene.bloom ? 1.0F : 0.0F;
    constants.params2[2] = shadowCount > 0 ? static_cast<float>(scene.shadowMaps[0].size) : 1024.0F;
    constants.params2[3] = 0.0F;
    return constants;
}

namespace {

constexpr UINT kSrvCount = 5;
constexpr UINT kRtvCount = 3;

D3D12_CPU_DESCRIPTOR_HANDLE offsetHandle(D3D12_CPU_DESCRIPTOR_HANDLE handle, UINT index,
                                         UINT descriptorSize) {
    handle.ptr += static_cast<SIZE_T>(index) * descriptorSize;
    return handle;
}

void writeSrv(ID3D12Device* device, D3D12_CPU_DESCRIPTOR_HANDLE handle, ID3D12Resource* resource,
              DXGI_FORMAT format, D3D12_SRV_DIMENSION dimension, UINT arraySize) {
    if (!resource) return;
    D3D12_SHADER_RESOURCE_VIEW_DESC desc{};
    desc.Format = format;
    desc.ViewDimension = dimension;
    desc.Shader4ComponentMapping = D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;
    if (dimension == D3D12_SRV_DIMENSION_TEXTURE2DARRAY) {
        desc.Texture2DArray.MostDetailedMip = 0;
        desc.Texture2DArray.MipLevels = 1;
        desc.Texture2DArray.FirstArraySlice = 0;
        desc.Texture2DArray.ArraySize = std::max(1U, arraySize);
        desc.Texture2DArray.PlaneSlice = 0;
    } else {
        desc.Texture2D.MostDetailedMip = 0;
        desc.Texture2D.MipLevels = 1;
        desc.Texture2D.PlaneSlice = 0;
    }
    device->CreateShaderResourceView(resource, &desc, handle);
}

void recordTextureUpload(ID3D12GraphicsCommandList* list, FrameResources& resources,
                         const GpuScene& scene) {
    if (resources.texturesReady || !resources.textures || !resources.textureUpload) return;
    const int layers = std::max(1, resources.textureLayers);
    const int width = std::max(1, scene.textureWidth);
    const int height = std::max(1, scene.textureHeight);
    const UINT rowPitch = (static_cast<UINT>(width) * 4U + D3D12_TEXTURE_DATA_PITCH_ALIGNMENT - 1U) &
                          ~(D3D12_TEXTURE_DATA_PITCH_ALIGNMENT - 1U);

    void* mapped = nullptr;
    if (FAILED(resources.textureUpload->Map(0, nullptr, &mapped)) || !mapped) return;
    auto* destination = static_cast<std::uint8_t*>(mapped);
    for (int layer = 0; layer < layers; ++layer) {
        const GpuTexture* source = layer < static_cast<int>(scene.textures.size())
                                       ? &scene.textures[static_cast<std::size_t>(layer)]
                                       : nullptr;
        const bool usable = source && source->width == width && source->height == height &&
                            source->rgba.size() >= static_cast<std::size_t>(width) *
                                                       static_cast<std::size_t>(height) * 4U;
        for (int row = 0; row < height; ++row) {
            std::uint8_t* target = destination +
                                   (static_cast<std::size_t>(layer) * static_cast<std::size_t>(height) +
                                    static_cast<std::size_t>(row)) *
                                       rowPitch;
            if (usable) {
                std::memcpy(target,
                            source->rgba.data() + static_cast<std::size_t>(row) *
                                                      static_cast<std::size_t>(width) * 4U,
                            static_cast<std::size_t>(width) * 4U);
            } else {
                std::memset(target, 0xFF, static_cast<std::size_t>(width) * 4U);
            }
        }
    }
    resources.textureUpload->Unmap(0, nullptr);

    for (int layer = 0; layer < layers; ++layer) {
        D3D12_TEXTURE_COPY_LOCATION destinationLocation{};
        destinationLocation.pResource = resources.textures.Get();
        destinationLocation.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
        destinationLocation.SubresourceIndex = static_cast<UINT>(layer);

        D3D12_TEXTURE_COPY_LOCATION sourceLocation{};
        sourceLocation.pResource = resources.textureUpload.Get();
        sourceLocation.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;
        sourceLocation.PlacedFootprint.Offset =
            static_cast<UINT64>(layer) * static_cast<UINT64>(rowPitch) * static_cast<UINT64>(height);
        sourceLocation.PlacedFootprint.Footprint.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        sourceLocation.PlacedFootprint.Footprint.Width = static_cast<UINT>(width);
        sourceLocation.PlacedFootprint.Footprint.Height = static_cast<UINT>(height);
        sourceLocation.PlacedFootprint.Footprint.Depth = 1;
        sourceLocation.PlacedFootprint.Footprint.RowPitch = rowPitch;
        list->CopyTextureRegion(&destinationLocation, 0, 0, 0, &sourceLocation, nullptr);
    }

    const D3D12_RESOURCE_BARRIER barrier = transition(
        resources.textures.Get(), D3D12_RESOURCE_STATE_COPY_DEST,
        D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
    list->ResourceBarrier(1, &barrier);
    resources.texturesReady = true;
}

}  // namespace

bool ensureFrameResources(ID3D12Device* device, FrameResources& resources, int width, int height,
                          const GpuScene& scene, std::string& error) {
    if (width < 1 || height < 1) {
        error = "Dimensions invalides pour les ressources de frame.";
        return false;
    }

    const int shadowLayers = std::clamp(static_cast<int>(scene.shadowMaps.size()), 0, 2);
    const int shadowSize = shadowLayers > 0
                               ? std::clamp(scene.shadowMaps[0].size, 128, 2048)
                               : 0;
    const int textureLayers = std::max(1, static_cast<int>(scene.textures.size()));

    const bool sizeChanged = resources.width != width || resources.height != height;
    const bool shadowChanged =
        resources.shadowLayers != shadowLayers || resources.shadowSize != shadowSize;
    const bool textureChanged = resources.textureLayers != textureLayers;
    const bool rebuildRtv = sizeChanged || !resources.rtvHeap;
    const bool rebuildDsv = sizeChanged || shadowChanged || !resources.dsvHeap;
    const bool rebuildSrv = !resources.srvHeap;

    if (sizeChanged) {
        resources.hdr = createTexture2D(device, width, height, DXGI_FORMAT_R16G16B16A16_FLOAT,
                                        D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,
                                        D3D12_RESOURCE_STATE_COMMON);
        resources.bloomA = createTexture2D(device, std::max(1, width / 2), std::max(1, height / 2),
                                           DXGI_FORMAT_R16G16B16A16_FLOAT,
                                           D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,
                                           D3D12_RESOURCE_STATE_COMMON);
        resources.bloomB = createTexture2D(device, std::max(1, width / 2), std::max(1, height / 2),
                                           DXGI_FORMAT_R16G16B16A16_FLOAT,
                                           D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,
                                           D3D12_RESOURCE_STATE_COMMON);
        resources.depth = createTexture2D(device, width, height, DXGI_FORMAT_R32_TYPELESS,
                                          D3D12_RESOURCE_FLAG_ALLOW_DEPTH_STENCIL,
                                          D3D12_RESOURCE_STATE_COMMON);
        if (!resources.hdr || !resources.bloomA || !resources.bloomB || !resources.depth) {
            error = "Création des cibles intermédiaires GPU impossible.";
            return false;
        }
        resources.hdrState = D3D12_RESOURCE_STATE_COMMON;
        resources.bloomAState = D3D12_RESOURCE_STATE_COMMON;
        resources.bloomBState = D3D12_RESOURCE_STATE_COMMON;
        resources.depthState = D3D12_RESOURCE_STATE_COMMON;
    }

    if (shadowChanged) {
        resources.shadowMaps.Reset();
        if (shadowLayers > 0) {
            resources.shadowMaps = createTexture2DArray(
                device, shadowSize, shadowSize, shadowLayers, DXGI_FORMAT_R32_TYPELESS,
                D3D12_RESOURCE_FLAG_ALLOW_DEPTH_STENCIL, D3D12_RESOURCE_STATE_DEPTH_WRITE);
            if (!resources.shadowMaps) {
                error = "Création des shadow maps GPU impossible.";
                return false;
            }
        }
        resources.shadowState = D3D12_RESOURCE_STATE_DEPTH_WRITE;
    }

    if (textureChanged) {
        resources.textures.Reset();
        resources.textureUpload.Reset();
        const int textureWidth = std::max(1, scene.textureWidth);
        const int textureHeight = std::max(1, scene.textureHeight);
        const UINT rowPitch = (static_cast<UINT>(textureWidth) * 4U +
                               D3D12_TEXTURE_DATA_PITCH_ALIGNMENT - 1U) &
                              ~(D3D12_TEXTURE_DATA_PITCH_ALIGNMENT - 1U);
        resources.textures = createTexture2DArray(
            device, textureWidth, textureHeight, textureLayers, DXGI_FORMAT_R8G8B8A8_UNORM,
            D3D12_RESOURCE_FLAG_NONE, D3D12_RESOURCE_STATE_COPY_DEST);
        resources.textureUpload = createBuffer(
            device,
            static_cast<UINT64>(rowPitch) * static_cast<UINT64>(textureHeight) *
                static_cast<UINT64>(textureLayers),
            D3D12_HEAP_TYPE_UPLOAD);
        if (!resources.textures || !resources.textureUpload) {
            error = "Création du tableau de textures GPU impossible.";
            return false;
        }
        resources.texturesReady = false;
    }

    if (rebuildRtv) {
        D3D12_DESCRIPTOR_HEAP_DESC desc{};
        desc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
        desc.NumDescriptors = kRtvCount;
        desc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_NONE;
        if (!check(device->CreateDescriptorHeap(&desc, IID_PPV_ARGS(resources.rtvHeap.GetAddressOf())),
                   "Création du tas RTV intermédiaire impossible", error)) {
            return false;
        }
    }

    if (rebuildDsv) {
        D3D12_DESCRIPTOR_HEAP_DESC desc{};
        desc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_DSV;
        desc.NumDescriptors = 1 + static_cast<UINT>(shadowLayers);
        desc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_NONE;
        if (!check(device->CreateDescriptorHeap(&desc, IID_PPV_ARGS(resources.dsvHeap.GetAddressOf())),
                   "Création du tas DSV intermédiaire impossible", error)) {
            return false;
        }
    }

    if (rebuildSrv) {
        D3D12_DESCRIPTOR_HEAP_DESC desc{};
        desc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV;
        desc.NumDescriptors = kSrvCount;
        desc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
        if (!check(device->CreateDescriptorHeap(&desc, IID_PPV_ARGS(resources.srvHeap.GetAddressOf())),
                   "Création du tas SRV intermédiaire impossible", error)) {
            return false;
        }
    }

    resources.width = width;
    resources.height = height;
    resources.shadowLayers = shadowLayers;
    resources.shadowSize = shadowSize;
    resources.textureLayers = textureLayers;

    const UINT rtvSize = device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
    const UINT dsvSize = device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_DSV);
    const UINT srvSize =
        device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);

    const D3D12_CPU_DESCRIPTOR_HANDLE rtvStart = resources.rtvHeap->GetCPUDescriptorHandleForHeapStart();
    resources.hdrRtv = offsetHandle(rtvStart, 0, rtvSize);
    resources.bloomARtv = offsetHandle(rtvStart, 1, rtvSize);
    resources.bloomBRtv = offsetHandle(rtvStart, 2, rtvSize);
    device->CreateRenderTargetView(resources.hdr.Get(), nullptr, resources.hdrRtv);
    device->CreateRenderTargetView(resources.bloomA.Get(), nullptr, resources.bloomARtv);
    device->CreateRenderTargetView(resources.bloomB.Get(), nullptr, resources.bloomBRtv);

    const D3D12_CPU_DESCRIPTOR_HANDLE dsvStart = resources.dsvHeap->GetCPUDescriptorHandleForHeapStart();
    resources.depthDsv = offsetHandle(dsvStart, 0, dsvSize);
    D3D12_DEPTH_STENCIL_VIEW_DESC depthView{};
    depthView.Format = DXGI_FORMAT_D32_FLOAT;
    depthView.ViewDimension = D3D12_DSV_DIMENSION_TEXTURE2D;
    depthView.Flags = D3D12_DSV_FLAG_NONE;
    device->CreateDepthStencilView(resources.depth.Get(), &depthView, resources.depthDsv);

    for (int layer = 0; layer < shadowLayers; ++layer) {
        resources.shadowDsv[layer] = offsetHandle(dsvStart, 1 + static_cast<UINT>(layer), dsvSize);
        D3D12_DEPTH_STENCIL_VIEW_DESC shadowView{};
        shadowView.Format = DXGI_FORMAT_D32_FLOAT;
        shadowView.ViewDimension = D3D12_DSV_DIMENSION_TEXTURE2DARRAY;
        shadowView.Flags = D3D12_DSV_FLAG_NONE;
        shadowView.Texture2DArray.MipSlice = 0;
        shadowView.Texture2DArray.FirstArraySlice = static_cast<UINT>(layer);
        shadowView.Texture2DArray.ArraySize = 1;
        device->CreateDepthStencilView(resources.shadowMaps.Get(), &shadowView,
                                       resources.shadowDsv[layer]);
    }

    const D3D12_CPU_DESCRIPTOR_HANDLE srvStart = resources.srvHeap->GetCPUDescriptorHandleForHeapStart();
    writeSrv(device, offsetHandle(srvStart, 0, srvSize), resources.textures.Get(),
             DXGI_FORMAT_R8G8B8A8_UNORM_SRGB, D3D12_SRV_DIMENSION_TEXTURE2DARRAY,
             static_cast<UINT>(textureLayers));
    writeSrv(device, offsetHandle(srvStart, 1, srvSize), resources.hdr.Get(),
             DXGI_FORMAT_R16G16B16A16_FLOAT, D3D12_SRV_DIMENSION_TEXTURE2D, 1);
    writeSrv(device, offsetHandle(srvStart, 2, srvSize), resources.bloomA.Get(),
             DXGI_FORMAT_R16G16B16A16_FLOAT, D3D12_SRV_DIMENSION_TEXTURE2D, 1);
    writeSrv(device, offsetHandle(srvStart, 3, srvSize), resources.bloomB.Get(),
             DXGI_FORMAT_R16G16B16A16_FLOAT, D3D12_SRV_DIMENSION_TEXTURE2D, 1);
    writeSrv(device, offsetHandle(srvStart, 4, srvSize), resources.shadowMaps.Get(),
             DXGI_FORMAT_R32_FLOAT, D3D12_SRV_DIMENSION_TEXTURE2DARRAY,
             static_cast<UINT>(std::max(1, shadowLayers)));
    return true;
}

void recordFrame(ID3D12GraphicsCommandList* list, ID3D12RootSignature* rootSignature,
                 const Pipelines& pipelines, FrameResources& resources, const GpuScene& scene,
                 D3D12_GPU_VIRTUAL_ADDRESS frameConstantsAddress,
                 const D3D12_VERTEX_BUFFER_VIEW& vertexView,
                 const D3D12_INDEX_BUFFER_VIEW& triangleIndexView, UINT triangleIndexCount,
                 const D3D12_INDEX_BUFFER_VIEW& drawIndexView, UINT drawIndexCount,
                 bool lineTopology, D3D12_CPU_DESCRIPTOR_HANDLE finalRtv, int& drawCalls) {
    recordTextureUpload(list, resources, scene);

    list->SetGraphicsRootSignature(rootSignature);
    list->SetGraphicsRootConstantBufferView(0, frameConstantsAddress);
    ID3D12DescriptorHeap* const heaps[] = {resources.srvHeap.Get()};
    list->SetDescriptorHeaps(1, heaps);
    list->SetGraphicsRootDescriptorTable(2, resources.srvHeap->GetGPUDescriptorHandleForHeapStart());

    const int shadowCount =
        std::min<int>(resources.shadowLayers, static_cast<int>(scene.shadowMaps.size()));

    // Shadow maps are sampled by the scene pass, so a previous frame left them
    // in DEPTH_READ | PIXEL_SHADER_RESOURCE. They must be writable again before
    // the depth-only passes clear and fill them.
    if (shadowCount > 0 && resources.shadowState != D3D12_RESOURCE_STATE_DEPTH_WRITE) {
        const D3D12_RESOURCE_BARRIER toDepth =
            transition(resources.shadowMaps.Get(), resources.shadowState,
                       D3D12_RESOURCE_STATE_DEPTH_WRITE);
        list->ResourceBarrier(1, &toDepth);
        resources.shadowState = D3D12_RESOURCE_STATE_DEPTH_WRITE;
    }

    // Shadow passes: one depth-only draw per shadow-casting light.
    for (int index = 0; index < shadowCount; ++index) {
        D3D12_VIEWPORT shadowViewport{};
        shadowViewport.Width = static_cast<float>(resources.shadowSize);
        shadowViewport.Height = static_cast<float>(resources.shadowSize);
        shadowViewport.MaxDepth = 1.0F;
        list->RSSetViewports(1, &shadowViewport);
        D3D12_RECT shadowScissor{0, 0, resources.shadowSize, resources.shadowSize};
        list->RSSetScissorRects(1, &shadowScissor);

        list->OMSetRenderTargets(0, nullptr, FALSE, &resources.shadowDsv[index]);
        list->ClearDepthStencilView(resources.shadowDsv[index], D3D12_CLEAR_FLAG_DEPTH, 1.0F, 0,
                                   0, nullptr);
        list->SetPipelineState(pipelines.shadow.Get());
        list->IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        list->IASetVertexBuffers(0, 1, &vertexView);
        list->IASetIndexBuffer(&triangleIndexView);
        list->SetGraphicsRoot32BitConstants(
            1, 16, scene.shadowMaps[static_cast<std::size_t>(index)].viewProjection, 0);
        list->DrawIndexedInstanced(triangleIndexCount, 1, 0, 0, 0);
        ++drawCalls;
    }

    if (shadowCount > 0) {
        const D3D12_RESOURCE_STATES readable = static_cast<D3D12_RESOURCE_STATES>(
            D3D12_RESOURCE_STATE_DEPTH_READ | D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
        const D3D12_RESOURCE_BARRIER barrier =
            transition(resources.shadowMaps.Get(), resources.shadowState, readable);
        list->ResourceBarrier(1, &barrier);
        resources.shadowState = readable;
    }

    // HDR scene pass.
    {
        D3D12_RESOURCE_BARRIER barriers[2]{};
        UINT barrierCount = 0;
        if (resources.hdrState != D3D12_RESOURCE_STATE_RENDER_TARGET) {
            barriers[barrierCount++] =
                transition(resources.hdr.Get(), resources.hdrState,
                           D3D12_RESOURCE_STATE_RENDER_TARGET);
        }
        if (resources.depthState != D3D12_RESOURCE_STATE_DEPTH_WRITE) {
            barriers[barrierCount++] =
                transition(resources.depth.Get(), resources.depthState,
                           D3D12_RESOURCE_STATE_DEPTH_WRITE);
        }
        if (barrierCount > 0) list->ResourceBarrier(barrierCount, barriers);
        resources.hdrState = D3D12_RESOURCE_STATE_RENDER_TARGET;
        resources.depthState = D3D12_RESOURCE_STATE_DEPTH_WRITE;

        D3D12_VIEWPORT viewport{};
        viewport.Width = static_cast<float>(resources.width);
        viewport.Height = static_cast<float>(resources.height);
        viewport.MaxDepth = 1.0F;
        list->RSSetViewports(1, &viewport);
        D3D12_RECT scissor{0, 0, resources.width, resources.height};
        list->RSSetScissorRects(1, &scissor);

        list->OMSetRenderTargets(1, &resources.hdrRtv, FALSE, &resources.depthDsv);
        const float clear[4] = {scene.backgroundBottom[0], scene.backgroundBottom[1],
                                scene.backgroundBottom[2], 1.0F};
        list->ClearRenderTargetView(resources.hdrRtv, clear, 0, nullptr);
        list->ClearDepthStencilView(resources.depthDsv, D3D12_CLEAR_FLAG_DEPTH, 1.0F, 0, 0,
                                    nullptr);

        list->SetPipelineState(pipelines.sky.Get());
        list->DrawInstanced(3, 1, 0, 0);
        ++drawCalls;

        list->SetPipelineState((lineTopology ? pipelines.wire : pipelines.solid).Get());
        list->IASetPrimitiveTopology(lineTopology ? D3D_PRIMITIVE_TOPOLOGY_LINELIST
                                                  : D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        list->IASetVertexBuffers(0, 1, &vertexView);
        list->IASetIndexBuffer(&drawIndexView);
        list->DrawIndexedInstanced(drawIndexCount, 1, 0, 0, 0);
        ++drawCalls;
    }

    // Bright pass into half-resolution bloomA.
    {
        const D3D12_RESOURCE_BARRIER barrier = transition(
            resources.hdr.Get(), resources.hdrState, D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
        list->ResourceBarrier(1, &barrier);
        resources.hdrState = D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE;

        const D3D12_RESOURCE_BARRIER toTarget = transition(
            resources.bloomA.Get(), resources.bloomAState, D3D12_RESOURCE_STATE_RENDER_TARGET);
        list->ResourceBarrier(1, &toTarget);
        resources.bloomAState = D3D12_RESOURCE_STATE_RENDER_TARGET;

        D3D12_VIEWPORT viewport{};
        viewport.Width = static_cast<float>(std::max(1, resources.width / 2));
        viewport.Height = static_cast<float>(std::max(1, resources.height / 2));
        viewport.MaxDepth = 1.0F;
        list->RSSetViewports(1, &viewport);
        D3D12_RECT scissor{0, 0, std::max(1, resources.width / 2),
                           std::max(1, resources.height / 2)};
        list->RSSetScissorRects(1, &scissor);
        list->OMSetRenderTargets(1, &resources.bloomARtv, FALSE, nullptr);
        const float clearBloom[4] = {0.0F, 0.0F, 0.0F, 1.0F};
        list->ClearRenderTargetView(resources.bloomARtv, clearBloom, 0, nullptr);
        list->SetPipelineState(pipelines.bright.Get());
        list->DrawInstanced(3, 1, 0, 0);
        ++drawCalls;
    }

    // Blur pass into bloomB.
    {
        const D3D12_RESOURCE_BARRIER readBarrier = transition(
            resources.bloomA.Get(), resources.bloomAState, D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
        list->ResourceBarrier(1, &readBarrier);
        resources.bloomAState = D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE;

        const D3D12_RESOURCE_BARRIER toTarget = transition(
            resources.bloomB.Get(), resources.bloomBState, D3D12_RESOURCE_STATE_RENDER_TARGET);
        list->ResourceBarrier(1, &toTarget);
        resources.bloomBState = D3D12_RESOURCE_STATE_RENDER_TARGET;

        list->OMSetRenderTargets(1, &resources.bloomBRtv, FALSE, nullptr);
        const float clearBloom[4] = {0.0F, 0.0F, 0.0F, 1.0F};
        list->ClearRenderTargetView(resources.bloomBRtv, clearBloom, 0, nullptr);
        list->SetPipelineState(pipelines.blur.Get());
        list->DrawInstanced(3, 1, 0, 0);
        ++drawCalls;

        const D3D12_RESOURCE_BARRIER barrier = transition(
            resources.bloomB.Get(), resources.bloomBState, D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
        list->ResourceBarrier(1, &barrier);
        resources.bloomBState = D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE;
    }

    // ACES + bloom composite into the caller-provided final target.
    {
        D3D12_VIEWPORT viewport{};
        viewport.Width = static_cast<float>(resources.width);
        viewport.Height = static_cast<float>(resources.height);
        viewport.MaxDepth = 1.0F;
        list->RSSetViewports(1, &viewport);
        D3D12_RECT scissor{0, 0, resources.width, resources.height};
        list->RSSetScissorRects(1, &scissor);
        list->OMSetRenderTargets(1, &finalRtv, FALSE, nullptr);
        list->SetPipelineState(pipelines.composite.Get());
        list->DrawInstanced(3, 1, 0, 0);
        ++drawCalls;
    }
}

}  // namespace nova::d3d12
