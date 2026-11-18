#include "nova/nova_image.hpp"

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#define STBI_NO_THREAD_LOCALS
#if defined(_MSC_VER)
#pragma warning(push)
#pragma warning(disable : 4244 4456 4457 4701 4703 4996)
#endif
#include "stb_image.h"
#if defined(_MSC_VER)
#pragma warning(pop)
#endif

#include <algorithm>
#include <cstring>
#include <fstream>
#include <iterator>

namespace nova {
namespace {

void imageError(const char* fallback, std::string& error, const char* detail) {
    error = fallback;
    if (detail && *detail) {
        error += " (";
        error += detail;
        error += ")";
    }
}

}  // namespace

bool decodeImage(const std::uint8_t* data, std::size_t size, Image& image, std::string& error) {
    image = Image{};
    if (!data || size == 0) {
        error = "Image vide.";
        return false;
    }
    if (size > 64U * 1024U * 1024U) {
        error = "Image trop volumineuse (64 Mo maximum).";
        return false;
    }
    int width = 0;
    int height = 0;
    int channels = 0;
    stbi_uc* pixels = stbi_load_from_memory(data, static_cast<int>(size), &width, &height, &channels, 4);
    if (!pixels || width <= 0 || height <= 0 || width > 8192 || height > 8192) {
        if (pixels) stbi_image_free(pixels);
        imageError("Décodage d'image impossible", error, stbi_failure_reason());
        return false;
    }
    image.width = width;
    image.height = height;
    image.rgba.assign(pixels, pixels + static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4U);
    stbi_image_free(pixels);
    return true;
}

bool loadImageFile(const std::string& path, Image& image, std::string& error) {
    image = Image{};
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        error = "Image introuvable : " + path;
        return false;
    }
    std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    if (!file.good() && !file.eof()) {
        error = "Lecture d'image incomplète : " + path;
        return false;
    }
    std::string detail;
    if (!decodeImage(bytes.data(), bytes.size(), image, detail)) {
        error = detail + " — " + path;
        return false;
    }
    return true;
}

Image resizeImage(const Image& source, int width, int height) {
    Image result;
    if (!source.valid() || width <= 0 || height <= 0) return result;
    width = std::clamp(width, 1, 4096);
    height = std::clamp(height, 1, 4096);
    result.width = width;
    result.height = height;
    result.rgba.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4U);
    for (int y = 0; y < height; ++y) {
        const float sourceY0 = (static_cast<float>(y) + 0.5F) * static_cast<float>(source.height) / static_cast<float>(height) - 0.5F;
        const int y0 = static_cast<int>(std::floor(sourceY0));
        const float fy = sourceY0 - static_cast<float>(y0);
        for (int x = 0; x < width; ++x) {
            const float sourceX0 = (static_cast<float>(x) + 0.5F) * static_cast<float>(source.width) / static_cast<float>(width) - 0.5F;
            const int x0 = static_cast<int>(std::floor(sourceX0));
            const float fx = sourceX0 - static_cast<float>(x0);
            float accum[4] = {0, 0, 0, 0};
            for (int dy = 0; dy < 2; ++dy) {
                for (int dx = 0; dx < 2; ++dx) {
                    const int sx = std::clamp(x0 + dx, 0, source.width - 1);
                    const int sy = std::clamp(y0 + dy, 0, source.height - 1);
                    const float weight = (dx ? fx : 1.0F - fx) * (dy ? fy : 1.0F - fy);
                    const std::size_t index = (static_cast<std::size_t>(sy) * static_cast<std::size_t>(source.width) +
                                               static_cast<std::size_t>(sx)) * 4U;
                    for (int channel = 0; channel < 4; ++channel) accum[channel] += static_cast<float>(source.rgba[index + static_cast<std::size_t>(channel)]) * weight;
                }
            }
            const std::size_t target = (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x)) * 4U;
            for (int channel = 0; channel < 4; ++channel) {
                result.rgba[target + static_cast<std::size_t>(channel)] = static_cast<std::uint8_t>(std::clamp(std::lround(accum[channel]), 0L, 255L));
            }
        }
    }
    return result;
}

}  // namespace nova
