#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace nova {

// Decoded RGBA8 image (top-left origin, sRGB). Used by image textures on every
// renderer. JPEG and PNG are decoded by the vendored stb_image; the software
// rasterizer, the D3D12 texture array builder and the Workbench all agree on
// this representation.
struct Image {
    int width{};
    int height{};
    std::vector<std::uint8_t> rgba;

    [[nodiscard]] bool valid() const noexcept {
        return width > 0 && height > 0 &&
               rgba.size() == static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4U;
    }
};

// Loads a PNG/JPEG file from disk. Errors are human readable and never throw.
[[nodiscard]] bool loadImageFile(const std::string& path, Image& image, std::string& error);

// Decodes an in-memory PNG/JPEG buffer (used by tests and by the Workbench asset
// endpoint without touching the filesystem twice).
[[nodiscard]] bool decodeImage(const std::uint8_t* data, std::size_t size, Image& image,
                               std::string& error);

// Deterministic box-filtered resize used to build the GPU texture array.
[[nodiscard]] Image resizeImage(const Image& source, int width, int height);

}  // namespace nova
