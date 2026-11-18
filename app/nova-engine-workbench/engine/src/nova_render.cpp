#include "nova/nova_render.hpp"

#include "nova/nova_gpu.hpp"
#include "nova/nova_image.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <limits>
#include <memory>
#include <mutex>
#include <numbers>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace nova {
namespace {

constexpr float kPi = std::numbers::pi_v<float>;
constexpr float kEpsilon = 1.0e-6F;

// ---------------------------------------------------------------------------
// Small linear algebra layer (row-major matrices, column vectors).
// ---------------------------------------------------------------------------
struct V3 {
    float x{0.0F};
    float y{0.0F};
    float z{0.0F};
};

struct V2 {
    float x{0.0F};
    float y{0.0F};
};

constexpr V2 operator+(const V2& a, const V2& b) noexcept { return {a.x + b.x, a.y + b.y}; }
constexpr V2 operator*(const V2& a, float s) noexcept { return {a.x * s, a.y * s}; }
constexpr V2 operator/(const V2& a, float s) noexcept { return {a.x / s, a.y / s}; }

constexpr V3 operator+(const V3& a, const V3& b) noexcept { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
constexpr V3 operator-(const V3& a, const V3& b) noexcept { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
constexpr V3 operator*(const V3& a, float s) noexcept { return {a.x * s, a.y * s, a.z * s}; }
constexpr V3 operator*(float s, const V3& a) noexcept { return a * s; }
constexpr V3 operator*(const V3& a, const V3& b) noexcept { return {a.x * b.x, a.y * b.y, a.z * b.z}; }
constexpr V3 operator/(const V3& a, float s) noexcept { return {a.x / s, a.y / s, a.z / s}; }
constexpr V3& operator+=(V3& a, const V3& b) noexcept { a.x += b.x; a.y += b.y; a.z += b.z; return a; }
constexpr V3 operator-(const V3& a) noexcept { return {-a.x, -a.y, -a.z}; }
constexpr float dot(const V3& a, const V3& b) noexcept { return a.x * b.x + a.y * b.y + a.z * b.z; }
constexpr V3 cross(const V3& a, const V3& b) noexcept {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline float length(const V3& v) noexcept { return std::sqrt(dot(v, v)); }
inline V3 normalize(const V3& v) noexcept {
    const float len = length(v);
    return len > kEpsilon ? v / len : V3{0.0F, 1.0F, 0.0F};
}
inline V3 lerp(const V3& a, const V3& b, float t) noexcept { return a + (b - a) * t; }
inline V3 vmin(const V3& a, const V3& b) noexcept { return {std::min(a.x, b.x), std::min(a.y, b.y), std::min(a.z, b.z)}; }
inline V3 vmax(const V3& a, const V3& b) noexcept { return {std::max(a.x, b.x), std::max(a.y, b.y), std::max(a.z, b.z)}; }

struct V4 {
    float x{0.0F};
    float y{0.0F};
    float z{0.0F};
    float w{0.0F};
};

struct M3 {
    float m[3][3]{};
};

struct M4 {
    float m[4][4]{};
};

M4 identity4() noexcept {
    M4 r{};
    for (int i = 0; i < 4; ++i) r.m[i][i] = 1.0F;
    return r;
}

M4 mul(const M4& a, const M4& b) noexcept {
    M4 r{};
    for (int row = 0; row < 4; ++row) {
        for (int col = 0; col < 4; ++col) {
            float sum = 0.0F;
            for (int k = 0; k < 4; ++k) sum += a.m[row][k] * b.m[k][col];
            r.m[row][col] = sum;
        }
    }
    return r;
}

V4 mul(const M4& matrix, const V4& value) noexcept {
    return {
        matrix.m[0][0] * value.x + matrix.m[0][1] * value.y + matrix.m[0][2] * value.z + matrix.m[0][3] * value.w,
        matrix.m[1][0] * value.x + matrix.m[1][1] * value.y + matrix.m[1][2] * value.z + matrix.m[1][3] * value.w,
        matrix.m[2][0] * value.x + matrix.m[2][1] * value.y + matrix.m[2][2] * value.z + matrix.m[2][3] * value.w,
        matrix.m[3][0] * value.x + matrix.m[3][1] * value.y + matrix.m[3][2] * value.z + matrix.m[3][3] * value.w,
    };
}

V3 transformPoint(const M4& matrix, const V3& point) noexcept {
    const V4 out = mul(matrix, V4{point.x, point.y, point.z, 1.0F});
    return std::abs(out.w) > kEpsilon ? V3{out.x / out.w, out.y / out.w, out.z / out.w} : V3{out.x, out.y, out.z};
}

V3 transformDirection(const M4& matrix, const V3& direction) noexcept {
    return {
        matrix.m[0][0] * direction.x + matrix.m[0][1] * direction.y + matrix.m[0][2] * direction.z,
        matrix.m[1][0] * direction.x + matrix.m[1][1] * direction.y + matrix.m[1][2] * direction.z,
        matrix.m[2][0] * direction.x + matrix.m[2][1] * direction.y + matrix.m[2][2] * direction.z,
    };
}

M4 translation(const V3& t) noexcept {
    M4 r = identity4();
    r.m[0][3] = t.x;
    r.m[1][3] = t.y;
    r.m[2][3] = t.z;
    return r;
}

M4 scaling(const V3& s) noexcept {
    M4 r = identity4();
    r.m[0][0] = s.x;
    r.m[1][1] = s.y;
    r.m[2][2] = s.z;
    return r;
}

M4 rotationX(float degrees) noexcept {
    const float radians = degrees * kPi / 180.0F;
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    M4 r = identity4();
    r.m[1][1] = c; r.m[1][2] = -s;
    r.m[2][1] = s; r.m[2][2] = c;
    return r;
}

M4 rotationY(float degrees) noexcept {
    const float radians = degrees * kPi / 180.0F;
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    M4 r = identity4();
    r.m[0][0] = c; r.m[0][2] = s;
    r.m[2][0] = -s; r.m[2][2] = c;
    return r;
}

M4 rotationZ(float degrees) noexcept {
    const float radians = degrees * kPi / 180.0F;
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    M4 r = identity4();
    r.m[0][0] = c; r.m[0][1] = -s;
    r.m[1][0] = s; r.m[1][1] = c;
    return r;
}

M4 modelMatrix(const Transform& transform) noexcept {
    const auto convert = [](const Vec3& value) { return V3{value.x, value.y, value.z}; };
    const M4 rotation = mul(rotationY(transform.rotationDegrees.y),
                            mul(rotationX(transform.rotationDegrees.x), rotationZ(transform.rotationDegrees.z)));
    return mul(translation(convert(transform.position)), mul(rotation, scaling(convert(transform.scale))));
}

M4 perspective(float fovYRadians, float aspect, float nearZ, float farZ) noexcept {
    const float f = 1.0F / std::tan(fovYRadians * 0.5F);
    M4 r{};
    r.m[0][0] = f / std::max(aspect, kEpsilon);
    r.m[1][1] = f;
    r.m[2][2] = farZ / (nearZ - farZ);
    r.m[2][3] = (farZ * nearZ) / (nearZ - farZ);
    r.m[3][2] = -1.0F;
    return r;
}

M4 lookAt(const V3& eye, const V3& center, const V3& upHint) noexcept {
    V3 forward = normalize(center - eye);
    if (length(forward) < kEpsilon) forward = {0.0F, 0.0F, -1.0F};
    V3 up = upHint;
    if (std::abs(dot(forward, normalize(up))) > 0.999F) up = {0.0F, 0.0F, 1.0F};
    const V3 right = normalize(cross(forward, up));
    up = cross(right, forward);
    M4 r = identity4();
    r.m[0][0] = right.x; r.m[0][1] = right.y; r.m[0][2] = right.z; r.m[0][3] = -dot(right, eye);
    r.m[1][0] = up.x; r.m[1][1] = up.y; r.m[1][2] = up.z; r.m[1][3] = -dot(up, eye);
    r.m[2][0] = -forward.x; r.m[2][1] = -forward.y; r.m[2][2] = -forward.z; r.m[2][3] = dot(forward, eye);
    return r;
}

M3 upper3(const M4& matrix) noexcept {
    M3 r{};
    for (int row = 0; row < 3; ++row) {
        for (int col = 0; col < 3; ++col) r.m[row][col] = matrix.m[row][col];
    }
    return r;
}

M3 inverseTranspose(const M3& matrix) noexcept {
    const float a = matrix.m[0][0], b = matrix.m[0][1], c = matrix.m[0][2];
    const float d = matrix.m[1][0], e = matrix.m[1][1], f = matrix.m[1][2];
    const float g = matrix.m[2][0], h = matrix.m[2][1], i = matrix.m[2][2];
    const float det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    M3 r{};
    if (std::abs(det) < 1.0e-9F) return r;
    const float invDet = 1.0F / det;
    // Inverse of the matrix, then transposed (only the 3x3 block matters).
    r.m[0][0] = (e * i - f * h) * invDet;
    r.m[1][0] = -(b * i - c * h) * invDet;
    r.m[2][0] = (b * f - c * e) * invDet;
    r.m[0][1] = -(d * i - f * g) * invDet;
    r.m[1][1] = (a * i - c * g) * invDet;
    r.m[2][1] = -(a * f - c * d) * invDet;
    r.m[0][2] = (d * h - e * g) * invDet;
    r.m[1][2] = -(a * h - b * g) * invDet;
    r.m[2][2] = (a * e - b * d) * invDet;
    return r;
}

V3 mul(const M3& matrix, const V3& value) noexcept {
    return {
        matrix.m[0][0] * value.x + matrix.m[0][1] * value.y + matrix.m[0][2] * value.z,
        matrix.m[1][0] * value.x + matrix.m[1][1] * value.y + matrix.m[1][2] * value.z,
        matrix.m[2][0] * value.x + matrix.m[2][1] * value.y + matrix.m[2][2] * value.z,
    };
}

// ---------------------------------------------------------------------------
// Geometry primitives generated procedurally. No external assets are required.
// ---------------------------------------------------------------------------
struct Vertex {
    V3 position;
    V3 normal;
    V2 uv;
};

struct MeshData {
    std::vector<Vertex> vertices;
    std::vector<std::uint32_t> indices;
};

// Planar UV projection on the dominant normal axis. Enough for procedural
// patterns and keeps every primitive seam-free without external assets.
V2 planarUv(const V3& position, const V3& normal) {
    const float ax = std::abs(normal.x);
    const float ay = std::abs(normal.y);
    const float az = std::abs(normal.z);
    if (ay >= ax && ay >= az) return {position.x + 0.5F, position.z + 0.5F};
    if (ax >= az) return {position.z + 0.5F, position.y + 0.5F};
    return {position.x + 0.5F, position.y + 0.5F};
}

void addQuad(MeshData& mesh, const V3& a, const V3& b, const V3& c, const V3& d, const V3& normal) {
    const auto base = static_cast<std::uint32_t>(mesh.vertices.size());
    const V3 corners[4] = {a, b, c, d};
    for (const V3& corner : corners) mesh.vertices.push_back({corner, normal, planarUv(corner, normal)});
    mesh.indices.insert(mesh.indices.end(), {base, base + 1, base + 2, base, base + 2, base + 3});
}

MeshData makeCube() {
    MeshData mesh;
    const float s = 0.5F;
    addQuad(mesh, {-s, -s, s}, {s, -s, s}, {s, s, s}, {-s, s, s}, {0, 0, 1});
    addQuad(mesh, {s, -s, -s}, {-s, -s, -s}, {-s, s, -s}, {s, s, -s}, {0, 0, -1});
    addQuad(mesh, {s, -s, s}, {s, -s, -s}, {s, s, -s}, {s, s, s}, {1, 0, 0});
    addQuad(mesh, {-s, -s, -s}, {-s, -s, s}, {-s, s, s}, {-s, s, -s}, {-1, 0, 0});
    addQuad(mesh, {-s, s, s}, {s, s, s}, {s, s, -s}, {-s, s, -s}, {0, 1, 0});
    addQuad(mesh, {-s, -s, -s}, {s, -s, -s}, {s, -s, s}, {-s, -s, s}, {0, -1, 0});
    return mesh;
}

MeshData makeSphere() {
    MeshData mesh;
    constexpr int stacks = 18;
    constexpr int segments = 28;
    constexpr float radius = 0.5F;
    for (int stack = 0; stack <= stacks; ++stack) {
        const float v = static_cast<float>(stack) / static_cast<float>(stacks);
        const float phi = v * kPi;
        for (int segment = 0; segment <= segments; ++segment) {
            const float u = static_cast<float>(segment) / static_cast<float>(segments);
            const float theta = u * 2.0F * kPi;
            const V3 normal{std::sin(phi) * std::cos(theta), std::cos(phi), std::sin(phi) * std::sin(theta)};
            mesh.vertices.push_back({normal * radius, normal, {u, v}});
        }
    }
    for (int stack = 0; stack < stacks; ++stack) {
        for (int segment = 0; segment < segments; ++segment) {
            const auto a = static_cast<std::uint32_t>(stack * (segments + 1) + segment);
            const auto b = a + static_cast<std::uint32_t>(segments + 1);
            mesh.indices.insert(mesh.indices.end(), {a, b, a + 1, b, b + 1, a + 1});
        }
    }
    return mesh;
}

MeshData makePlane() {
    MeshData mesh;
    addQuad(mesh, {-0.5F, 0.0F, -0.5F}, {-0.5F, 0.0F, 0.5F}, {0.5F, 0.0F, 0.5F}, {0.5F, 0.0F, -0.5F}, {0, 1, 0});
    return mesh;
}

MeshData makeCylinder() {
    MeshData mesh;
    constexpr int segments = 24;
    const float radius = 0.5F;
    const float half = 0.5F;
    for (int segment = 0; segment < segments; ++segment) {
        const float a = 2.0F * kPi * static_cast<float>(segment) / static_cast<float>(segments);
        const float b = 2.0F * kPi * static_cast<float>(segment + 1) / static_cast<float>(segments);
        const V3 n0{std::cos(a), 0.0F, std::sin(a)};
        const V3 n1{std::cos(b), 0.0F, std::sin(b)};
        addQuad(mesh, {n0.x * radius, -half, n0.z * radius}, {n1.x * radius, -half, n1.z * radius},
                {n1.x * radius, half, n1.z * radius}, {n0.x * radius, half, n0.z * radius}, normalize(n0 + n1));
    }
    for (int cap = 0; cap < 2; ++cap) {
        const float y = cap == 0 ? -half : half;
        const V3 normal{0.0F, cap == 0 ? -1.0F : 1.0F, 0.0F};
        const auto center = static_cast<std::uint32_t>(mesh.vertices.size());
        const V3 centerPosition{0.0F, y, 0.0F};
        mesh.vertices.push_back({centerPosition, normal, planarUv(centerPosition, normal)});
        for (int segment = 0; segment <= segments; ++segment) {
            const float angle = 2.0F * kPi * static_cast<float>(segment) / static_cast<float>(segments);
            const V3 position{std::cos(angle) * radius, y, std::sin(angle) * radius};
            mesh.vertices.push_back({position, normal, planarUv(position, normal)});
        }
        for (int segment = 0; segment < segments; ++segment) {
            const auto first = center + 1 + static_cast<std::uint32_t>(segment);
            if (cap == 0) mesh.indices.insert(mesh.indices.end(), {center, first + 1, first});
            else mesh.indices.insert(mesh.indices.end(), {center, first, first + 1});
        }
    }
    return mesh;
}

MeshData makeCone() {
    MeshData mesh;
    constexpr int segments = 24;
    const float radius = 0.5F;
    const float half = 0.5F;
    const V3 apex{0.0F, half, 0.0F};
    for (int segment = 0; segment < segments; ++segment) {
        const float a = 2.0F * kPi * static_cast<float>(segment) / static_cast<float>(segments);
        const float b = 2.0F * kPi * static_cast<float>(segment + 1) / static_cast<float>(segments);
        const V3 p0{std::cos(a) * radius, -half, std::sin(a) * radius};
        const V3 p1{std::cos(b) * radius, -half, std::sin(b) * radius};
        const V3 normal = normalize(cross(p1 - p0, apex - p0));
        const auto base = static_cast<std::uint32_t>(mesh.vertices.size());
        mesh.vertices.push_back({p0, normal, planarUv(p0, normal)});
        mesh.vertices.push_back({p1, normal, planarUv(p1, normal)});
        mesh.vertices.push_back({apex, normal, planarUv(apex, normal)});
        mesh.indices.insert(mesh.indices.end(), {base, base + 1, base + 2});
    }
    const V3 down{0.0F, -1.0F, 0.0F};
    const auto center = static_cast<std::uint32_t>(mesh.vertices.size());
    const V3 centerPosition{0.0F, -half, 0.0F};
    mesh.vertices.push_back({centerPosition, down, planarUv(centerPosition, down)});
    for (int segment = 0; segment <= segments; ++segment) {
        const float angle = 2.0F * kPi * static_cast<float>(segment) / static_cast<float>(segments);
        const V3 position{std::cos(angle) * radius, -half, std::sin(angle) * radius};
        mesh.vertices.push_back({position, down, planarUv(position, down)});
    }
    for (int segment = 0; segment < segments; ++segment) {
        const auto first = center + 1 + static_cast<std::uint32_t>(segment);
        mesh.indices.insert(mesh.indices.end(), {center, first, first + 1});
    }
    return mesh;
}

MeshData makeTorus() {
    MeshData mesh;
    constexpr int majorSegments = 32;
    constexpr int minorSegments = 18;
    constexpr float majorRadius = 0.35F;
    constexpr float minorRadius = 0.15F;
    for (int major = 0; major <= majorSegments; ++major) {
        const float u = static_cast<float>(major) / static_cast<float>(majorSegments);
        const float theta = u * 2.0F * kPi;
        for (int minor = 0; minor <= minorSegments; ++minor) {
            const float v = static_cast<float>(minor) / static_cast<float>(minorSegments);
            const float phi = v * 2.0F * kPi;
            const V3 normal{std::cos(phi) * std::cos(theta), std::sin(phi), std::cos(phi) * std::sin(theta)};
            const V3 position{std::cos(theta) * (majorRadius + minorRadius * std::cos(phi)), minorRadius * std::sin(phi),
                              std::sin(theta) * (majorRadius + minorRadius * std::cos(phi))};
            mesh.vertices.push_back({position, normal, {u * 3.0F, v}});
        }
    }
    for (int major = 0; major < majorSegments; ++major) {
        for (int minor = 0; minor < minorSegments; ++minor) {
            const auto a = static_cast<std::uint32_t>(major * (minorSegments + 1) + minor);
            const auto b = a + static_cast<std::uint32_t>(minorSegments + 1);
            mesh.indices.insert(mesh.indices.end(), {a, b, a + 1, b, b + 1, a + 1});
        }
    }
    return mesh;
}

MeshData makeCapsule() {
    MeshData mesh;
    constexpr int segments = 24;
    constexpr int capStacks = 8;
    constexpr float radius = 0.3F;
    constexpr float cylinderHalf = 0.2F;
    std::vector<V3> rowCenters;
    std::vector<float> rowRadius;
    std::vector<float> rowY;
    for (int stack = 0; stack <= capStacks; ++stack) {
        const float phi = (static_cast<float>(stack) / static_cast<float>(capStacks)) * (kPi * 0.5F);
        rowY.push_back(cylinderHalf + radius * std::cos(phi));
        rowRadius.push_back(radius * std::sin(phi));
        rowCenters.push_back({0.0F, cylinderHalf, 0.0F});
    }
    for (int stack = 0; stack <= capStacks; ++stack) {
        const float phi = kPi * 0.5F + (static_cast<float>(stack) / static_cast<float>(capStacks)) * (kPi * 0.5F);
        rowY.push_back(-cylinderHalf + radius * std::cos(phi));
        rowRadius.push_back(radius * std::sin(phi));
        rowCenters.push_back({0.0F, -cylinderHalf, 0.0F});
    }
    const int rows = static_cast<int>(rowY.size());
    for (int row = 0; row < rows; ++row) {
        for (int segment = 0; segment <= segments; ++segment) {
            const float u = static_cast<float>(segment) / static_cast<float>(segments);
            const float theta = u * 2.0F * kPi;
            const V3 position{std::cos(theta) * rowRadius[static_cast<std::size_t>(row)], rowY[static_cast<std::size_t>(row)],
                              std::sin(theta) * rowRadius[static_cast<std::size_t>(row)]};
            V3 normal{position.x, position.y - rowCenters[static_cast<std::size_t>(row)].y, position.z};
            if (rowRadius[static_cast<std::size_t>(row)] < 1.0e-5F) {
                normal = {0.0F, row <= capStacks ? 1.0F : -1.0F, 0.0F};
            }
            mesh.vertices.push_back({position, normalize(normal), {u * 2.0F, static_cast<float>(row) / static_cast<float>(rows - 1)}});
        }
    }
    for (int row = 0; row + 1 < rows; ++row) {
        for (int segment = 0; segment < segments; ++segment) {
            const auto a = static_cast<std::uint32_t>(row * (segments + 1) + segment);
            const auto b = a + static_cast<std::uint32_t>(segments + 1);
            mesh.indices.insert(mesh.indices.end(), {a, b, a + 1, b, b + 1, a + 1});
        }
    }
    return mesh;
}

MeshData makePyramid() {
    MeshData mesh;
    const V3 base[4] = {{-0.5F, -0.5F, -0.5F}, {0.5F, -0.5F, -0.5F}, {0.5F, -0.5F, 0.5F}, {-0.5F, -0.5F, 0.5F}};
    const V3 apex{0.0F, 0.5F, 0.0F};
    for (int side = 0; side < 4; ++side) {
        const V3 a = base[side];
        const V3 b = base[(side + 1) % 4];
        const V3 normal = normalize(cross(b - a, apex - a));
        const auto start = static_cast<std::uint32_t>(mesh.vertices.size());
        mesh.vertices.push_back({a, normal, planarUv(a, normal)});
        mesh.vertices.push_back({b, normal, planarUv(b, normal)});
        mesh.vertices.push_back({apex, normal, planarUv(apex, normal)});
        mesh.indices.insert(mesh.indices.end(), {start, start + 1, start + 2});
    }
    addQuad(mesh, base[0], base[1], base[2], base[3], {0.0F, -1.0F, 0.0F});
    return mesh;
}

std::string toLower(std::string_view value) {
    std::string result(value);
    std::transform(result.begin(), result.end(), result.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return result;
}

bool mentions(const Entity& entity, std::string_view token) {
    const std::string needle = toLower(token);
    for (const auto& component : entity.components) {
        if (toLower(component).find(needle) != std::string::npos) return true;
    }
    return toLower(entity.name).find(needle) != std::string::npos;
}

const MeshData& meshFor(const Entity& entity) {
    static const MeshData cube = makeCube();
    static const MeshData sphere = makeSphere();
    static const MeshData plane = makePlane();
    static const MeshData cylinder = makeCylinder();
    static const MeshData cone = makeCone();
    static const MeshData torus = makeTorus();
    static const MeshData capsule = makeCapsule();
    static const MeshData pyramid = makePyramid();
    switch (primitiveFor(entity)) {
        case Primitive::Sphere: return sphere;
        case Primitive::Plane: return plane;
        case Primitive::Cylinder: return cylinder;
        case Primitive::Cone: return cone;
        case Primitive::Torus: return torus;
        case Primitive::Capsule: return capsule;
        case Primitive::Pyramid: return pyramid;
        case Primitive::Cube: return cube;
    }
    return cube;
}

// ---------------------------------------------------------------------------
// Scene preparation.
// ---------------------------------------------------------------------------
M4 entityWorldMatrix(const Scene& scene, const Entity& entity) {
    M4 matrix = modelMatrix(entity.transform);
    std::vector<std::string> visited{entity.id};
    std::optional<std::string> parentId = entity.parentId;
    while (parentId) {
        if (std::find(visited.begin(), visited.end(), *parentId) != visited.end()) break;
        visited.push_back(*parentId);
        const Entity* parent = scene.findEntity(*parentId);
        if (!parent) break;
        matrix = mul(modelMatrix(parent->transform), matrix);
        parentId = parent->parentId;
    }
    return matrix;
}

struct CameraSetup {
    V3 eye{0.0F, 3.0F, 10.0F};
    V3 target{0.0F};
    M4 view{};
    M4 projection{};
    M4 viewProjection{};
    std::string name{"Auto camera"};
    std::string id{};
    float nearZ{0.05F};
    float farZ{600.0F};
};

struct Bounds {
    V3 min{std::numeric_limits<float>::max(), std::numeric_limits<float>::max(), std::numeric_limits<float>::max()};
    V3 max{-std::numeric_limits<float>::max(), -std::numeric_limits<float>::max(), -std::numeric_limits<float>::max()};
    bool valid{false};
    void include(const V3& point) noexcept {
        min = vmin(min, point);
        max = vmax(max, point);
        valid = true;
    }
    V3 center() const noexcept { return valid ? (min + max) * 0.5F : V3{0.0F}; }
    V3 size() const noexcept { return valid ? max - min : V3{0.0F}; }
};

struct SceneLight {
    LightType type{LightType::Directional};
    V3 position{};
    V3 direction{0.0F, -1.0F, 0.0F};  // Direction the light travels.
    V3 color{1.0F, 1.0F, 1.0F};       // Linear.
    float intensity{1.0F};
    float range{8.0F};
    float cosOuter{-1.0F};
    float cosInner{1.0F};
    int shadowIndex{-1};
};

struct ShadowMap {
    int size{};
    std::vector<float> depth;
    M4 viewProjection{};
    bool valid{false};
};

struct Lighting {
    V3 ambientSky{0.16F, 0.22F, 0.35F};
    V3 ambientGround{0.035F, 0.045F, 0.07F};
    std::vector<SceneLight> lights;
    std::vector<ShadowMap> shadowMaps;
};

V3 srgbToLinear(const V3& color) noexcept;

M4 orthographic(float left, float right, float bottom, float top, float nearZ, float farZ) noexcept {
    M4 r = identity4();
    r.m[0][0] = 2.0F / (right - left);
    r.m[1][1] = 2.0F / (top - bottom);
    r.m[2][2] = -1.0F / (farZ - nearZ);
    r.m[0][3] = -(right + left) / (right - left);
    r.m[1][3] = -(top + bottom) / (top - bottom);
    r.m[2][3] = -nearZ / (farZ - nearZ);
    return r;
}

void appendShadowMap(Lighting& lighting, SceneLight& light, const M4& viewProjection, int resolution) {
    resolution = std::clamp(resolution, 128, 2048);
    ShadowMap map;
    map.size = resolution;
    map.depth.assign(static_cast<std::size_t>(resolution) * static_cast<std::size_t>(resolution), 1.0F);
    map.viewProjection = viewProjection;
    map.valid = true;
    light.shadowIndex = static_cast<int>(lighting.shadowMaps.size());
    lighting.shadowMaps.push_back(std::move(map));
}

Lighting buildLighting(const Scene& scene, const Bounds& meshBounds, const RenderOptions& options) {
    Lighting lighting;
    const V3 center = meshBounds.valid ? meshBounds.center() : V3{0.0F, 0.8F, 0.0F};
    const float radius = meshBounds.valid ? std::clamp(length(meshBounds.size()) * 0.5F, 2.0F, 400.0F) : 4.0F;

    bool explicitLight = false;
    for (const auto& entity : scene.entities()) {
        if (!entity.visible || entity.type != "Light") continue;
        explicitLight = true;
        const M4 world = entityWorldMatrix(scene, entity);
        SceneLight light;
        if (entity.light) {
            light.type = entity.light->type;
            light.color = srgbToLinear({entity.light->color.x, entity.light->color.y, entity.light->color.z});
            light.intensity = entity.light->intensity;
            light.range = entity.light->range;
            const float outer = entity.light->spotAngle * kPi / 180.0F;
            light.cosOuter = std::cos(outer);
            light.cosInner = std::cos(outer * 0.72F);
            light.position = transformPoint(world, {0.0F, 0.0F, 0.0F});
            light.direction = normalize(transformDirection(world, {0.0F, 0.0F, -1.0F}));
            if (light.intensity <= 0.0F) continue;
        } else if (mentions(entity, "directional") || mentions(entity, "sun")) {
            light.type = LightType::Directional;
            light.color = srgbToLinear({1.0F, 0.91F, 0.78F});
            light.intensity = 1.15F;
            light.direction = normalize(transformDirection(world, {0.0F, 0.0F, -1.0F}));
        } else {
            light.type = LightType::Point;
            light.position = transformPoint(world, {0.0F, 0.0F, 0.0F});
            light.color = srgbToLinear({1.0F, 0.66F, 0.32F});
            light.range = std::clamp(8.0F * std::max({std::abs(entity.transform.scale.x),
                                                      std::abs(entity.transform.scale.y),
                                                      std::abs(entity.transform.scale.z)}), 2.0F, 60.0F);
            light.intensity = 1.35F;
        }

        // Explicit schema-4 lights own their castShadow flag. Legacy scenes
        // only carry components ("Directional Light", ...), so they inherit the
        // documented default Light::castShadow = true.
        const bool castShadow = entity.light ? entity.light->castShadow : true;
        if (castShadow && options.shadows &&
            (light.type == LightType::Directional || light.type == LightType::Spot)) {
            if (light.type == LightType::Directional && lighting.shadowMaps.size() < 1U) {
                const float extent = radius * 1.35F + 1.0F;
                const float distance = radius * 2.5F + 6.0F;
                const V3 eye = center - light.direction * distance;
                const M4 view = lookAt(eye, center, {0.0F, 1.0F, 0.0F});
                const M4 projection = orthographic(-extent, extent, -extent, extent, 0.1F, distance + radius * 3.0F);
                appendShadowMap(lighting, light, mul(projection, view), options.shadowResolution);
            } else if (light.type == LightType::Spot && lighting.shadowMaps.size() < 2U) {
                const float outerDegrees = std::acos(std::clamp(light.cosOuter, -1.0F, 1.0F)) * 180.0F / kPi;
                const float fov = std::clamp(outerDegrees * 2.0F * 1.08F, 10.0F, 170.0F);
                const M4 view = lookAt(light.position, light.position + light.direction, {0.0F, 1.0F, 0.0F});
                const M4 projection = perspective(fov * kPi / 180.0F, 1.0F, 0.15F, light.range);
                appendShadowMap(lighting, light, mul(projection, view), options.shadowResolution);
            }
        }
        lighting.lights.push_back(light);
        if (lighting.lights.size() >= 8U) break;
    }

    if (!explicitLight) {
        // Historical default rig used by scenes without any Light entity: a warm
        // key and a cool fill, both directional, so older documents keep their look.
        SceneLight key;
        key.type = LightType::Directional;
        key.direction = normalize({-0.45F, -0.8F, -0.4F});
        key.color = srgbToLinear({1.0F, 0.94F, 0.84F});
        key.intensity = 1.15F;
        lighting.lights.push_back(key);

        SceneLight fill;
        fill.type = LightType::Directional;
        fill.direction = normalize({0.55F, -0.25F, 0.6F});
        fill.color = srgbToLinear({0.32F, 0.46F, 0.72F});
        fill.intensity = 0.34F;
        lighting.lights.push_back(fill);
    }
    return lighting;
}

CameraSetup selectCamera(const Scene& scene, const RenderOptions& options, const Bounds& meshBounds) {
    const Entity* camera = nullptr;
    if (!options.cameraId.empty()) {
        camera = scene.findEntity(options.cameraId);
        if (camera && (camera->type != "Camera" || !camera->visible)) camera = nullptr;
    }
    if (!camera) {
        for (const auto& entity : scene.entities()) {
            if (entity.visible && entity.type == "Camera") { camera = &entity; break; }
        }
    }

    CameraSetup setup;
    if (camera) {
        const M4 world = entityWorldMatrix(scene, *camera);
        setup.eye = transformPoint(world, {0.0F, 0.0F, 0.0F});
        const V3 forward = normalize(transformDirection(world, {0.0F, 0.0F, -1.0F}));
        setup.target = setup.eye + forward;
        setup.name = camera->name;
        setup.id = camera->id;
    } else {
        const V3 center = meshBounds.valid ? meshBounds.center() : V3{0.0F, 0.8F, 0.0F};
        float radius = meshBounds.valid ? length(meshBounds.size()) * 0.5F : 4.0F;
        radius = std::clamp(radius, 1.5F, 400.0F);
        const V3 direction = normalize(V3{0.72F, 0.48F, 1.0F});
        setup.eye = center + direction * (radius * 2.35F);
        setup.target = center;
        setup.name = "Auto camera";
    }

    const float aspect = static_cast<float>(options.width) / static_cast<float>(options.height);
    const float fov = 48.0F * kPi / 180.0F;
    setup.view = lookAt(setup.eye, setup.target, {0.0F, 1.0F, 0.0F});
    setup.projection = perspective(fov, aspect, setup.nearZ, setup.farZ);
    setup.viewProjection = mul(setup.projection, setup.view);
    return setup;
}

struct BlobShadow {
    float x{0.0F};
    float z{0.0F};
    float radius{1.0F};
    float strength{0.45F};
};

// ---------------------------------------------------------------------------
// Colour helpers.
// ---------------------------------------------------------------------------
V3 srgbToLinear(const V3& color) noexcept {
    const auto channel = [](float value) {
        return value <= 0.04045F ? value / 12.92F : std::pow((value + 0.055F) / 1.055F, 2.4F);
    };
    return {channel(color.x), channel(color.y), channel(color.z)};
}

V3 linearToSrgb(const V3& color) noexcept {
    const auto channel = [](float value) {
        value = std::clamp(value, 0.0F, 1.0F);
        return value <= 0.0031308F ? value * 12.92F : 1.055F * std::pow(value, 1.0F / 2.4F) - 0.055F;
    };
    return {channel(color.x), channel(color.y), channel(color.z)};
}

// Explicit per-entity material, or the historical type/id palette converted to
// linear space. Returns linear albedo so both renderers stay in the same space.
Material entityMaterial(const Entity& entity) {
    Material material = entity.material.value_or(defaultMaterialFor(entity));
    const V3 linear = srgbToLinear({material.albedo.x, material.albedo.y, material.albedo.z});
    material.albedo = Vec3{linear.x, linear.y, linear.z};
    return material;
}

// Shared procedural pattern evaluation. The HLSL pixel shader and the WebGL2
// viewport use the exact same formulas so all three renderers agree.
V3 applySurfacePattern(const V3& albedo, SurfacePattern pattern, float tiling, const V2& uv) {
    if (pattern == SurfacePattern::None) return albedo;
    const float scale = std::clamp(tiling, 1.0F, 64.0F);
    const float u = uv.x * scale;
    const float v = uv.y * scale;
    if (pattern == SurfacePattern::Checker) {
        const int cell = static_cast<int>(std::floor(u)) + static_cast<int>(std::floor(v));
        return (cell % 2 == 0) ? albedo : albedo * 0.45F;
    }
    const float edge = std::max(std::abs(u - std::floor(u) - 0.5F), std::abs(v - std::floor(v) - 0.5F));
    if (edge > 0.44F) {
        return {std::clamp(albedo.x * 1.35F + 0.06F, 0.0F, 1.0F),
                std::clamp(albedo.y * 1.35F + 0.06F, 0.0F, 1.0F),
                std::clamp(albedo.z * 1.35F + 0.06F, 0.0F, 1.0F)};
    }
    return albedo * 0.62F;
}

// ---------------------------------------------------------------------------
// Image textures. PNG/JPEG files are decoded once, converted to linear space
// and cached for the process lifetime.
// ---------------------------------------------------------------------------
struct Texture {
    int width{};
    int height{};
    std::vector<V3> linear;

    [[nodiscard]] bool valid() const noexcept {
        return width > 0 && height > 0 && linear.size() == static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    }
};

std::string joinAssetPath(const std::string& root, const std::string& relative) {
    if (root.empty()) return relative;
    const char last = root.back();
    if (last == '/' || last == '\\') return root + relative;
    return root + "/" + relative;
}

std::shared_ptr<const Texture> loadTexture(const std::string& path, const std::string& assetRoot, std::string& error) {
    static std::mutex mutex;
    static std::unordered_map<std::string, std::shared_ptr<const Texture>> cache;
    const std::string resolved = joinAssetPath(assetRoot, path);
    {
        const std::lock_guard<std::mutex> lock(mutex);
        const auto it = cache.find(resolved);
        if (it != cache.end()) return it->second;
    }
    Image image;
    if (!loadImageFile(resolved, image, error)) return nullptr;
    auto texture = std::make_shared<Texture>();
    texture->width = image.width;
    texture->height = image.height;
    texture->linear.resize(static_cast<std::size_t>(image.width) * static_cast<std::size_t>(image.height));
    static std::array<float, 256> toLinear{};
    static bool initialized = false;
    if (!initialized) {
        for (int value = 0; value < 256; ++value) {
            const float srgb = static_cast<float>(value) / 255.0F;
            toLinear[static_cast<std::size_t>(value)] =
                srgb <= 0.04045F ? srgb / 12.92F : std::pow((srgb + 0.055F) / 1.055F, 2.4F);
        }
        initialized = true;
    }
    for (std::size_t index = 0; index < texture->linear.size(); ++index) {
        const std::size_t source = index * 4U;
        texture->linear[index] = {toLinear[image.rgba[source]], toLinear[image.rgba[source + 1U]],
                                  toLinear[image.rgba[source + 2U]]};
    }
    {
        const std::lock_guard<std::mutex> lock(mutex);
        cache[resolved] = texture;
    }
    return texture;
}

V3 sampleTexture(const Texture& texture, const V2& uv) {
    if (!texture.valid()) return {1.0F, 1.0F, 1.0F};
    const float u = uv.x - std::floor(uv.x);
    const float v = uv.y - std::floor(uv.y);
    const float x = u * static_cast<float>(texture.width) - 0.5F;
    const float y = v * static_cast<float>(texture.height) - 0.5F;
    const int x0 = static_cast<int>(std::floor(x));
    const int y0 = static_cast<int>(std::floor(y));
    const float fx = x - static_cast<float>(x0);
    const float fy = y - static_cast<float>(y0);
    const auto fetch = [&](int px, int py) -> V3 {
        const int wrappedX = ((px % texture.width) + texture.width) % texture.width;
        const int wrappedY = ((py % texture.height) + texture.height) % texture.height;
        return texture.linear[static_cast<std::size_t>(wrappedY) * static_cast<std::size_t>(texture.width) +
                              static_cast<std::size_t>(wrappedX)];
    };
    const V3 c00 = fetch(x0, y0);
    const V3 c10 = fetch(x0 + 1, y0);
    const V3 c01 = fetch(x0, y0 + 1);
    const V3 c11 = fetch(x0 + 1, y0 + 1);
    return lerp(lerp(c00, c10, fx), lerp(c01, c11, fx), fy);
}

// ---------------------------------------------------------------------------
// Rasterizer.
// ---------------------------------------------------------------------------
struct Triangle {
    V3 position[3];
    V3 normal[3];
    V2 uv[3];
    V3 albedo{};
    std::shared_ptr<const Texture> texture;
    float roughness{0.42F};
    float metallic{0.05F};
    float tiling{4.0F};
    SurfacePattern pattern{SurfacePattern::None};
    bool emissive{false};
    bool selected{false};
    std::string entityId;
};

struct ClipVertex {
    V4 clip{};
    V3 world{};
    V3 normal{};
    V2 uv{};
};

struct ScreenVertex {
    float x{};
    float y{};
    float z{};
    float invW{};
    V3 world{};
    V3 normal{};
    V2 uv{};
};

// HDR (linear float) framebuffer. Tonemapping and bloom happen after the scene
// pass, exactly like the D3D12 and WebGL2 backends.
struct Framebuffer {
    int width{};
    int height{};
    std::vector<float> rgb;  // 3 floats per pixel, linear light.
    std::vector<float> depth;
    Framebuffer(int w, int h) : width(w), height(h), rgb(static_cast<std::size_t>(w) * static_cast<std::size_t>(h) * 3U, 0.0F), depth(static_cast<std::size_t>(w) * static_cast<std::size_t>(h), 1.0F) {}
    std::size_t index(int x, int y) const noexcept { return static_cast<std::size_t>(y) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x); }
};

float edgeFunction(float ax, float ay, float bx, float by, float px, float py) noexcept {
    return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

// ACES filmic approximation (Narkowicz fit), shared by all backends.
V3 acesToneMap(const V3& color) noexcept {
    const auto channel = [](float value) {
        const float x = std::max(value, 0.0F);
        const float mapped = (x * (2.51F * x + 0.03F)) / (x * (2.43F * x + 0.59F) + 0.14F);
        return std::clamp(mapped, 0.0F, 1.0F);
    };
    return {channel(color.x), channel(color.y), channel(color.z)};
}

// Percentage-closer filtering (3x3) against one shadow map. A light without a
// shadow map simply returns full visibility, so the same shading path is used
// for all three light types.
float shadowVisibility(const Lighting& lighting, int shadowIndex, const V3& position, const V3& normal,
                       float ndotl) noexcept {
    if (shadowIndex < 0 || static_cast<std::size_t>(shadowIndex) >= lighting.shadowMaps.size()) return 1.0F;
    const ShadowMap& map = lighting.shadowMaps[static_cast<std::size_t>(shadowIndex)];
    if (!map.valid || map.size <= 0 || map.depth.size() != static_cast<std::size_t>(map.size) * static_cast<std::size_t>(map.size)) return 1.0F;

    const V3 offset = position + normal * 0.035F;
    const V4 clip = mul(map.viewProjection, V4{offset.x, offset.y, offset.z, 1.0F});
    if (clip.w <= 1.0e-5F) return 1.0F;
    const float u = clip.x / clip.w * 0.5F + 0.5F;
    const float v = 0.5F - clip.y / clip.w * 0.5F;
    const float depth = clip.z / clip.w;
    if (u < 0.0F || u > 1.0F || v < 0.0F || v > 1.0F || depth < 0.0F || depth > 1.0F) return 1.0F;

    const float texelX = u * static_cast<float>(map.size) - 0.5F;
    const float texelY = v * static_cast<float>(map.size) - 0.5F;
    const int baseX = static_cast<int>(std::floor(texelX));
    const int baseY = static_cast<int>(std::floor(texelY));
    const float bias = std::max(0.0008F, 0.0038F * (1.0F - std::clamp(ndotl, 0.0F, 1.0F)));
    float lit = 0.0F;
    for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
            const int px = std::clamp(baseX + dx, 0, map.size - 1);
            const int py = std::clamp(baseY + dy, 0, map.size - 1);
            const float stored = map.depth[static_cast<std::size_t>(py) * static_cast<std::size_t>(map.size) +
                                          static_cast<std::size_t>(px)];
            lit += (depth <= stored + bias) ? 1.0F : 0.0F;
        }
    }
    return lit / 9.0F;
}

// Returns linear HDR radiance. Exposure, bloom and the ACES curve are applied
// once by the post-process pass so every backend matches.
V3 shadeFragment(const V3& position, V3 normal, const V3& albedo, const V2& uv,
                 const std::shared_ptr<const Texture>& texture, float roughness,
                 float metallic, SurfacePattern pattern, float tiling, bool emissive, bool selected,
                 const Lighting& lighting, const CameraSetup& camera) {
    const float tilingScale = std::clamp(tiling, 1.0F, 64.0F);
    V3 surface = albedo;
    if (texture && texture->valid()) {
        surface = surface * sampleTexture(*texture, {uv.x * tilingScale, uv.y * tilingScale});
    } else {
        surface = applySurfacePattern(albedo, pattern, tiling, uv);
    }
    if (emissive) return surface;

    const V3 view = normalize(camera.eye - position);
    if (dot(normal, view) < 0.0F) normal = -normal;
    const float ndv = std::clamp(dot(normal, view), 0.0F, 1.0F);

    // Metallic/roughness drive the specular lobe: smooth surfaces get a tight,
    // strong highlight, metals tint it with their albedo and lose diffuse.
    roughness = std::clamp(roughness, 0.04F, 1.0F);
    metallic = std::clamp(metallic, 0.0F, 1.0F);
    const float shininess = std::max(2.0F, std::pow(2.0F, 10.0F * (1.0F - roughness)));
    const float specularStrength = (0.04F + 0.46F * (1.0F - roughness)) * (1.0F - metallic * 0.45F);
    const V3 specularTint = lerp(V3{1.0F, 1.0F, 1.0F}, surface, metallic);
    const float diffuseWeight = 1.0F - metallic * 0.65F;

    const float hemisphere = std::clamp(normal.y * 0.5F + 0.5F, 0.0F, 1.0F);
    V3 color = surface * lerp(lighting.ambientGround, lighting.ambientSky, hemisphere);

    // Up to eight scene lights (directional, point, spot), shadow-mapped where
    // the light requested it and the backend supports it.
    for (const auto& light : lighting.lights) {
        V3 directionToLight;
        float attenuation = 1.0F;
        if (light.type == LightType::Directional) {
            directionToLight = -normalize(light.direction);
        } else {
            const V3 delta = light.position - position;
            const float distanceSquared = dot(delta, delta);
            if (distanceSquared < 1.0e-6F) continue;
            const float rangeSquared = light.range * light.range;
            if (distanceSquared > rangeSquared) continue;
            const float distance = std::sqrt(distanceSquared);
            directionToLight = delta / distance;
            attenuation = std::pow(std::max(0.0F, 1.0F - distanceSquared / rangeSquared), 2.0F) /
                          (1.0F + distanceSquared * 0.18F);
            if (light.type == LightType::Spot) {
                const float cosAngle = dot(-directionToLight, normalize(light.direction));
                if (cosAngle <= light.cosOuter) continue;
                const float cone = std::clamp((cosAngle - light.cosOuter) /
                                                  std::max(light.cosInner - light.cosOuter, 1.0e-4F),
                                              0.0F, 1.0F);
                attenuation *= cone * cone;
            }
        }
        const float ndotl = std::max(dot(normal, directionToLight), 0.0F);
        if (ndotl <= 0.0F || attenuation <= 0.0F) continue;
        const float visibility = shadowVisibility(lighting, light.shadowIndex, position, normal, ndotl);
        if (visibility <= 0.0F) continue;
        const V3 half = normalize(directionToLight + view);
        const float spec = std::pow(std::max(dot(normal, half), 0.0F), shininess) * specularStrength;
        const float scale = light.intensity * attenuation * visibility;
        color += (surface * (ndotl * diffuseWeight) + specularTint * spec) * light.color * scale;
    }

    const float rim = std::pow(1.0F - ndv, 3.2F);
    color += V3{0.20F, 0.34F, 0.55F} * (rim * 0.14F);
    if (selected) {
        color += V3{0.18F, 0.72F, 1.0F} * (rim * 1.4F + 0.06F);
    }

    const float fog = 1.0F - std::exp(-length(camera.eye - position) * 0.010F);
    color = lerp(color, V3{0.030F, 0.052F, 0.085F}, fog * 0.30F);
    return color;
}

void writePixel(Framebuffer& framebuffer, int x, int y, const V3& linearColor) {
    const std::size_t index = framebuffer.index(x, y) * 3U;
    framebuffer.rgb[index] = linearColor.x;
    framebuffer.rgb[index + 1] = linearColor.y;
    framebuffer.rgb[index + 2] = linearColor.z;
}

void drawBackground(Framebuffer& framebuffer, const CameraSetup& camera, const RenderOptions& options,
                    const std::vector<BlobShadow>& shadows) {
    const float tanHalf = std::tan(48.0F * kPi / 360.0F);
    const float aspect = static_cast<float>(framebuffer.width) / static_cast<float>(framebuffer.height);
    const V3 right{camera.view.m[0][0], camera.view.m[0][1], camera.view.m[0][2]};
    const V3 up{camera.view.m[1][0], camera.view.m[1][1], camera.view.m[1][2]};
    const V3 forward{-camera.view.m[2][0], -camera.view.m[2][1], -camera.view.m[2][2]};

    const V3 zenith{0.010F, 0.020F, 0.048F};
    const V3 horizon{0.070F, 0.120F, 0.200F};
    const V3 groundColor{0.055F, 0.082F, 0.120F};
    const V3 gridColor{0.24F, 0.43F, 0.70F};
    const V3 majorColor{0.36F, 0.62F, 0.95F};
    const V3 axisX{0.80F, 0.30F, 0.34F};
    const V3 axisZ{0.30F, 0.48F, 0.90F};

    for (int y = 0; y < framebuffer.height; ++y) {
        const float ndcY = 1.0F - 2.0F * (static_cast<float>(y) + 0.5F) / static_cast<float>(framebuffer.height);
        for (int x = 0; x < framebuffer.width; ++x) {
            const float ndcX = 2.0F * (static_cast<float>(x) + 0.5F) / static_cast<float>(framebuffer.width) - 1.0F;
            const V3 direction = normalize(forward + right * (ndcX * tanHalf * aspect) + up * (ndcY * tanHalf));

            V3 color;
            bool groundHit = false;
            if (options.grid && direction.y < -1.0e-4F && camera.eye.y > 0.001F) {
                const float travel = -camera.eye.y / direction.y;
                if (travel > 0.0F && travel < 500.0F) {
                    const V3 point = camera.eye + direction * travel;
                    const float footprint = std::max(0.0015F, travel * (2.0F * tanHalf / static_cast<float>(framebuffer.height)) * 1.35F);
                    const float fade = std::exp(-travel * 0.014F);
                    const auto lineMask = [](float coordinate, float width) {
                        const float distance = std::abs(coordinate - std::round(coordinate));
                        return 1.0F - std::min(1.0F, distance / std::max(width, 1.0e-5F));
                    };
                    const float minor = std::max(lineMask(point.x, footprint * 1.2F), lineMask(point.z, footprint * 1.2F));
                    const float major = std::max(lineMask(point.x / 10.0F, footprint * 0.25F), lineMask(point.z / 10.0F, footprint * 0.25F));
                    color = groundColor;
                    color = lerp(color, gridColor, std::clamp(minor * 0.55F * fade, 0.0F, 1.0F));
                    color = lerp(color, majorColor, std::clamp(major * 0.85F * fade, 0.0F, 1.0F));
                    if (std::abs(point.z) < footprint * 1.4F) color = lerp(color, axisX, std::clamp(fade * 0.95F, 0.0F, 1.0F));
                    if (std::abs(point.x) < footprint * 1.4F) color = lerp(color, axisZ, std::clamp(fade * 0.95F, 0.0F, 1.0F));

                    float shadowFactor = 1.0F;
                    if (options.shadows) {
                        for (const auto& shadow : shadows) {
                            const float dx = point.x - shadow.x;
                            const float dz = point.z - shadow.z;
                            const float normalized = (dx * dx + dz * dz) / std::max(shadow.radius * shadow.radius, 1.0e-5F);
                            shadowFactor *= 1.0F - shadow.strength * std::exp(-normalized * 2.4F);
                        }
                    }
                    color = color * std::clamp(shadowFactor, 0.18F, 1.0F);

                    const V4 clip = mul(camera.viewProjection, V4{point.x, point.y, point.z, 1.0F});
                    if (clip.w > 1.0e-5F) {
                        const float depth = clip.z / clip.w;
                        if (depth >= 0.0F && depth <= 1.0F) {
                            framebuffer.depth[framebuffer.index(x, y)] = depth;
                            groundHit = true;
                        }
                    }
                }
            }
            if (!groundHit) {
                const float height = std::clamp(direction.y * 1.35F + 0.22F, 0.0F, 1.0F);
                color = lerp(horizon, zenith, std::pow(height, 0.62F));
                const float glow = std::exp(-std::abs(direction.y) * 9.0F) * 0.10F;
                color += V3{0.16F, 0.10F, 0.05F} * glow;
            }

            // Subtle dithering removes banding from the gradient.
            const std::uint32_t noise = static_cast<std::uint32_t>((x * 73856093) ^ (y * 19349663)) & 0xFFU;
            const float dither = (static_cast<float>(noise) / 255.0F - 0.5F) / 255.0F;
            color += V3{dither, dither, dither};
            writePixel(framebuffer, x, y, color);
        }
    }
}

void drawLine(Framebuffer& framebuffer, float x0, float y0, float z0, float x1, float y1, float z1, const V3& color) {
    const float dx = x1 - x0;
    const float dy = y1 - y0;
    const int steps = static_cast<int>(std::max(std::abs(dx), std::abs(dy)));
    if (steps <= 0) return;
    for (int step = 0; step <= steps; ++step) {
        const float t = static_cast<float>(step) / static_cast<float>(steps);
        const int x = static_cast<int>(std::lround(x0 + dx * t));
        const int y = static_cast<int>(std::lround(y0 + dy * t));
        const float z = z0 + (z1 - z0) * t;
        if (x < 0 || y < 0 || x >= framebuffer.width || y >= framebuffer.height) continue;
        const std::size_t index = framebuffer.index(x, y);
        if (z < 0.0F || z > 1.0F || z > framebuffer.depth[index] + 0.0015F) continue;
        framebuffer.depth[index] = std::max(0.0F, z - 0.0007F);
        writePixel(framebuffer, x, y, color);
    }
}

void projectLine(Framebuffer& framebuffer, const CameraSetup& camera, const V3& a, const V3& b, const V3& color) {
    V4 ca = mul(camera.viewProjection, V4{a.x, a.y, a.z, 1.0F});
    V4 cb = mul(camera.viewProjection, V4{b.x, b.y, b.z, 1.0F});
    if (ca.w <= 0.0F || cb.w <= 0.0F) return;
    const auto screenX = [&](const V4& clip) { return (clip.x / clip.w * 0.5F + 0.5F) * static_cast<float>(framebuffer.width); };
    const auto screenY = [&](const V4& clip) { return (0.5F - clip.y / clip.w * 0.5F) * static_cast<float>(framebuffer.height); };
    drawLine(framebuffer, screenX(ca), screenY(ca), ca.z / ca.w, screenX(cb), screenY(cb), cb.z / cb.w, color);
}

void drawBoxWireframe(Framebuffer& framebuffer, const CameraSetup& camera, const V3& min, const V3& max, const V3& color) {
    const V3 corners[8] = {
        {min.x, min.y, min.z}, {max.x, min.y, min.z}, {max.x, max.y, min.z}, {min.x, max.y, min.z},
        {min.x, min.y, max.z}, {max.x, min.y, max.z}, {max.x, max.y, max.z}, {min.x, max.y, max.z},
    };
    static constexpr int edges[12][2] = {{0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7}};
    for (const auto& edge : edges) projectLine(framebuffer, camera, corners[edge[0]], corners[edge[1]], color);
}

std::size_t clipNear(const ClipVertex input[3], std::array<ClipVertex, 4>& output) {
    std::size_t count = 0;
    for (int index = 0; index < 3; ++index) {
        const ClipVertex& current = input[index];
        const ClipVertex& next = input[(index + 1) % 3];
        const bool currentInside = current.clip.z >= 0.0F && current.clip.w > 1.0e-6F;
        const bool nextInside = next.clip.z >= 0.0F && next.clip.w > 1.0e-6F;
        if (currentInside) output[count++] = current;
        if (currentInside != nextInside) {
            const float denominator = current.clip.z - next.clip.z;
            if (std::abs(denominator) < 1.0e-9F) continue;
            const float t = current.clip.z / denominator;
            ClipVertex vertex;
            vertex.clip = {
                current.clip.x + (next.clip.x - current.clip.x) * t,
                current.clip.y + (next.clip.y - current.clip.y) * t,
                0.0F,
                current.clip.w + (next.clip.w - current.clip.w) * t,
            };
            vertex.world = lerp(current.world, next.world, t);
            vertex.normal = normalize(lerp(current.normal, next.normal, t));
            vertex.uv = {current.uv.x + (next.uv.x - current.uv.x) * t,
                         current.uv.y + (next.uv.y - current.uv.y) * t};
            output[count++] = vertex;
        }
        if (count >= 4) break;
    }
    return count;
}

// Depth-only rasterization into a light-space shadow map. Stores the closest
// depth so the shading pass can compare with a small normal-dependent bias.
void rasterizeShadowTriangle(ShadowMap& map, const ScreenVertex vertices[3]) {
    const float area = edgeFunction(vertices[0].x, vertices[0].y, vertices[1].x, vertices[1].y,
                                    vertices[2].x, vertices[2].y);
    if (std::abs(area) < 1.0e-7F) return;

    int minX = static_cast<int>(std::floor(std::min({vertices[0].x, vertices[1].x, vertices[2].x})));
    int maxX = static_cast<int>(std::ceil(std::max({vertices[0].x, vertices[1].x, vertices[2].x})));
    int minY = static_cast<int>(std::floor(std::min({vertices[0].y, vertices[1].y, vertices[2].y})));
    int maxY = static_cast<int>(std::ceil(std::max({vertices[0].y, vertices[1].y, vertices[2].y})));
    minX = std::max(0, minX);
    minY = std::max(0, minY);
    maxX = std::min(map.size - 1, maxX);
    maxY = std::min(map.size - 1, maxY);
    if (minX > maxX || minY > maxY) return;

    for (int y = minY; y <= maxY; ++y) {
        for (int x = minX; x <= maxX; ++x) {
            const float px = static_cast<float>(x) + 0.5F;
            const float py = static_cast<float>(y) + 0.5F;
            const float b0 = edgeFunction(vertices[1].x, vertices[1].y, vertices[2].x, vertices[2].y, px, py) / area;
            const float b1 = edgeFunction(vertices[2].x, vertices[2].y, vertices[0].x, vertices[0].y, px, py) / area;
            const float b2 = edgeFunction(vertices[0].x, vertices[0].y, vertices[1].x, vertices[1].y, px, py) / area;
            if (b0 < -1.0e-5F || b1 < -1.0e-5F || b2 < -1.0e-5F) continue;
            const float depth = b0 * vertices[0].z + b1 * vertices[1].z + b2 * vertices[2].z;
            if (depth < 0.0F || depth > 1.0F) continue;
            const std::size_t index = static_cast<std::size_t>(y) * static_cast<std::size_t>(map.size) +
                                      static_cast<std::size_t>(x);
            if (depth < map.depth[index]) map.depth[index] = depth;
        }
    }
}

void renderShadowMap(ShadowMap& map, const std::vector<Triangle>& triangles) {
    if (!map.valid || map.size <= 0) return;
    for (const auto& triangle : triangles) {
        ClipVertex clip[3];
        for (int index = 0; index < 3; ++index) {
            clip[index].world = triangle.position[index];
            clip[index].normal = triangle.normal[index];
            clip[index].uv = triangle.uv[index];
            clip[index].clip = mul(map.viewProjection, V4{triangle.position[index].x, triangle.position[index].y,
                                                          triangle.position[index].z, 1.0F});
        }
        std::array<ClipVertex, 4> clipped{};
        const std::size_t count = clipNear(clip, clipped);
        if (count < 3) continue;
        for (std::size_t fan = 1; fan + 1 < count; ++fan) {
            ScreenVertex screen[3];
            bool valid = true;
            for (int index = 0; index < 3; ++index) {
                const ClipVertex& vertex = clipped[index == 0 ? 0 : (fan - 1 + static_cast<std::size_t>(index)) % count];
                if (vertex.clip.w <= 1.0e-6F) { valid = false; break; }
                screen[index].x = (vertex.clip.x / vertex.clip.w * 0.5F + 0.5F) * static_cast<float>(map.size);
                screen[index].y = (0.5F - vertex.clip.y / vertex.clip.w * 0.5F) * static_cast<float>(map.size);
                screen[index].z = vertex.clip.z / vertex.clip.w;
                screen[index].invW = 1.0F / vertex.clip.w;
                screen[index].world = vertex.world;
                screen[index].normal = vertex.normal;
                screen[index].uv = vertex.uv;
            }
            if (!valid) continue;
            rasterizeShadowTriangle(map, screen);
        }
    }
}

void rasterizeTriangle(Framebuffer& framebuffer, ScreenVertex vertices[3], const Triangle& triangle,
                       const Lighting& lighting, const CameraSetup& camera, RenderStats& stats) {
    const float area = edgeFunction(vertices[0].x, vertices[0].y, vertices[1].x, vertices[1].y, vertices[2].x, vertices[2].y);
    if (std::abs(area) < 1.0e-7F) return;

    int minX = static_cast<int>(std::floor(std::min({vertices[0].x, vertices[1].x, vertices[2].x})));
    int maxX = static_cast<int>(std::ceil(std::max({vertices[0].x, vertices[1].x, vertices[2].x})));
    int minY = static_cast<int>(std::floor(std::min({vertices[0].y, vertices[1].y, vertices[2].y})));
    int maxY = static_cast<int>(std::ceil(std::max({vertices[0].y, vertices[1].y, vertices[2].y})));
    minX = std::max(0, minX);
    minY = std::max(0, minY);
    maxX = std::min(framebuffer.width - 1, maxX);
    maxY = std::min(framebuffer.height - 1, maxY);
    if (minX > maxX || minY > maxY) return;

    for (int y = minY; y <= maxY; ++y) {
        for (int x = minX; x <= maxX; ++x) {
            const float px = static_cast<float>(x) + 0.5F;
            const float py = static_cast<float>(y) + 0.5F;
            const float b0 = edgeFunction(vertices[1].x, vertices[1].y, vertices[2].x, vertices[2].y, px, py) / area;
            const float b1 = edgeFunction(vertices[2].x, vertices[2].y, vertices[0].x, vertices[0].y, px, py) / area;
            const float b2 = edgeFunction(vertices[0].x, vertices[0].y, vertices[1].x, vertices[1].y, px, py) / area;
            if (b0 < -1.0e-5F || b1 < -1.0e-5F || b2 < -1.0e-5F) continue;

            const float depth = b0 * vertices[0].z + b1 * vertices[1].z + b2 * vertices[2].z;
            const std::size_t index = framebuffer.index(x, y);
            if (depth < 0.0F || depth > 1.0F || depth >= framebuffer.depth[index]) continue;

            const float inverseW = b0 * vertices[0].invW + b1 * vertices[1].invW + b2 * vertices[2].invW;
            if (inverseW <= 1.0e-9F) continue;
            const V3 position = (vertices[0].world * (b0 * vertices[0].invW) + vertices[1].world * (b1 * vertices[1].invW) + vertices[2].world * (b2 * vertices[2].invW)) / inverseW;
            V3 normal = (vertices[0].normal * (b0 * vertices[0].invW) + vertices[1].normal * (b1 * vertices[1].invW) + vertices[2].normal * (b2 * vertices[2].invW)) / inverseW;
            if (length(normal) < 1.0e-6F) normal = triangle.normal[0];

            const V2 uv = (vertices[0].uv * (b0 * vertices[0].invW) + vertices[1].uv * (b1 * vertices[1].invW) +
                           vertices[2].uv * (b2 * vertices[2].invW)) / inverseW;

            const V3 color = shadeFragment(position, normal, triangle.albedo, uv, triangle.texture,
                                           triangle.roughness, triangle.metallic, triangle.pattern,
                                           triangle.tiling, triangle.emissive, triangle.selected,
                                           lighting, camera);
            framebuffer.depth[index] = depth;
            writePixel(framebuffer, x, y, color);
            ++stats.meshPixels;
        }
    }
}

void rasterizeScene(Framebuffer& framebuffer, const std::vector<Triangle>& triangles, const CameraSetup& camera,
                    const Lighting& lighting, const RenderOptions& options, RenderStats& stats) {
    for (const auto& triangle : triangles) {
        ClipVertex clip[3];
        for (int index = 0; index < 3; ++index) {
            clip[index].world = triangle.position[index];
            clip[index].normal = triangle.normal[index];
            clip[index].uv = triangle.uv[index];
            clip[index].clip = mul(camera.viewProjection, V4{triangle.position[index].x, triangle.position[index].y, triangle.position[index].z, 1.0F});
        }
        std::array<ClipVertex, 4> clipped{};
        const std::size_t count = clipNear(clip, clipped);
        if (count < 3) continue;
        for (std::size_t fan = 1; fan + 1 < count; ++fan) {
            ScreenVertex screen[3];
            bool valid = true;
            for (int index = 0; index < 3; ++index) {
                const ClipVertex& vertex = clipped[index == 0 ? 0 : (fan - 1 + static_cast<std::size_t>(index)) % count];
                if (vertex.clip.w <= 1.0e-6F) { valid = false; break; }
                screen[index].x = (vertex.clip.x / vertex.clip.w * 0.5F + 0.5F) * static_cast<float>(framebuffer.width);
                screen[index].y = (0.5F - vertex.clip.y / vertex.clip.w * 0.5F) * static_cast<float>(framebuffer.height);
                screen[index].z = vertex.clip.z / vertex.clip.w;
                screen[index].invW = 1.0F / vertex.clip.w;
                screen[index].world = vertex.world;
                screen[index].normal = vertex.normal;
                screen[index].uv = vertex.uv;
            }
            if (!valid) continue;
            if (options.wireframe) {
                const V3 lineColor = triangle.albedo;
                for (int edge = 0; edge < 3; ++edge) {
                    const ScreenVertex& a = screen[edge];
                    const ScreenVertex& b = screen[(edge + 1) % 3];
                    drawLine(framebuffer, a.x, a.y, a.z, b.x, b.y, b.z, lineColor);
                }
            } else {
                rasterizeTriangle(framebuffer, screen, triangle, lighting, camera, stats);
            }
        }
    }
}

void blurSeparable(std::vector<V3>& image, int width, int height) {
    static constexpr float weights[5] = {1.0F / 16.0F, 4.0F / 16.0F, 6.0F / 16.0F, 4.0F / 16.0F, 1.0F / 16.0F};
    std::vector<V3> temporary(image.size());
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            V3 sum{};
            for (int k = -2; k <= 2; ++k) {
                const int sampleX = std::clamp(x + k, 0, width - 1);
                sum += image[static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                             static_cast<std::size_t>(sampleX)] * weights[k + 2];
            }
            temporary[static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                      static_cast<std::size_t>(x)] = sum;
        }
    }
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            V3 sum{};
            for (int k = -2; k <= 2; ++k) {
                const int sampleY = std::clamp(y + k, 0, height - 1);
                sum += temporary[static_cast<std::size_t>(sampleY) * static_cast<std::size_t>(width) +
                                 static_cast<std::size_t>(x)] * weights[k + 2];
            }
            image[static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                  static_cast<std::size_t>(x)] = sum;
        }
    }
}

// HDR post-process shared by the software renderer: box downsample -> exposure
// -> threshold bloom (half resolution, separable blur) -> ACES -> sRGB -> RGBA8.
// The D3D12 and WebGL2 backends implement the same stages.
void postProcess(const Framebuffer& source, int supersample, const RenderOptions& options,
                 std::vector<std::uint8_t>& rgba) {
    const int width = std::max(1, source.width / std::max(1, supersample));
    const int height = std::max(1, source.height / std::max(1, supersample));
    std::vector<V3> hdr(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));

    const int block = std::max(1, supersample);
    const float divisor = 1.0F / static_cast<float>(block * block);
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float red = 0.0F;
            float green = 0.0F;
            float blue = 0.0F;
            for (int sy = 0; sy < block; ++sy) {
                for (int sx = 0; sx < block; ++sx) {
                    const int sourceX = std::min(source.width - 1, x * block + sx);
                    const int sourceY = std::min(source.height - 1, y * block + sy);
                    const std::size_t index = source.index(sourceX, sourceY) * 3U;
                    red += source.rgb[index];
                    green += source.rgb[index + 1];
                    blue += source.rgb[index + 2];
                }
            }
            hdr[static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                static_cast<std::size_t>(x)] = {red * divisor, green * divisor, blue * divisor};
        }
    }

    const float exposure = std::clamp(options.exposure, 0.05F, 8.0F);
    for (auto& value : hdr) value = value * exposure;

    if (options.bloom && options.bloomIntensity > 0.0F) {
        const int bloomWidth = std::max(1, width / 2);
        const int bloomHeight = std::max(1, height / 2);
        std::vector<V3> bright(static_cast<std::size_t>(bloomWidth) * static_cast<std::size_t>(bloomHeight));
        constexpr float threshold = 0.82F;
        for (int y = 0; y < bloomHeight; ++y) {
            for (int x = 0; x < bloomWidth; ++x) {
                const int sourceX = std::min(width - 1, x * 2);
                const int sourceY = std::min(height - 1, y * 2);
                const V3 color = hdr[static_cast<std::size_t>(sourceY) * static_cast<std::size_t>(width) +
                                     static_cast<std::size_t>(sourceX)];
                const float luminance = 0.2126F * color.x + 0.7152F * color.y + 0.0722F * color.z;
                const float amount = std::max(0.0F, luminance - threshold) / std::max(luminance, 1.0e-4F);
                bright[static_cast<std::size_t>(y) * static_cast<std::size_t>(bloomWidth) +
                       static_cast<std::size_t>(x)] = color * amount;
            }
        }
        blurSeparable(bright, bloomWidth, bloomHeight);
        const float intensity = std::clamp(options.bloomIntensity, 0.0F, 2.0F);
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                const int sampleX = std::min(bloomWidth - 1, x / 2);
                const int sampleY = std::min(bloomHeight - 1, y / 2);
                hdr[static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                    static_cast<std::size_t>(x)] +=
                    bright[static_cast<std::size_t>(sampleY) * static_cast<std::size_t>(bloomWidth) +
                           static_cast<std::size_t>(sampleX)] * intensity;
            }
        }
    }

    rgba.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4U, 255U);
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const V3 mapped = acesToneMap(hdr[static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                                              static_cast<std::size_t>(x)]);
            const V3 srgb = linearToSrgb(mapped);
            const std::size_t target = (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                                        static_cast<std::size_t>(x)) * 4U;
            rgba[target] = static_cast<std::uint8_t>(std::lround(std::clamp(srgb.x, 0.0F, 1.0F) * 255.0F));
            rgba[target + 1] = static_cast<std::uint8_t>(std::lround(std::clamp(srgb.y, 0.0F, 1.0F) * 255.0F));
            rgba[target + 2] = static_cast<std::uint8_t>(std::lround(std::clamp(srgb.z, 0.0F, 1.0F) * 255.0F));
            rgba[target + 3] = 255U;
        }
    }
}

// ---------------------------------------------------------------------------
// PNG writer: RGBA8, no filtering, zlib stored blocks. Fully self-contained.
// ---------------------------------------------------------------------------
std::uint32_t crc32Update(std::uint32_t crc, const std::uint8_t* data, std::size_t size) {
    static std::array<std::uint32_t, 256> table{};
    static bool initialized = false;
    if (!initialized) {
        for (std::uint32_t index = 0; index < 256; ++index) {
            std::uint32_t value = index;
            for (int bit = 0; bit < 8; ++bit) value = (value & 1U) ? (0xEDB88320U ^ (value >> 1U)) : (value >> 1U);
            table[index] = value;
        }
        initialized = true;
    }
    for (std::size_t index = 0; index < size; ++index) crc = table[(crc ^ data[index]) & 0xFFU] ^ (crc >> 8U);
    return crc;
}

std::uint32_t adler32(const std::vector<std::uint8_t>& data) {
    std::uint32_t a = 1;
    std::uint32_t b = 0;
    for (const std::uint8_t value : data) {
        a = (a + value) % 65521U;
        b = (b + a) % 65521U;
    }
    return (b << 16U) | a;
}

void appendU32(std::vector<std::uint8_t>& out, std::uint32_t value) {
    out.push_back(static_cast<std::uint8_t>((value >> 24U) & 0xFFU));
    out.push_back(static_cast<std::uint8_t>((value >> 16U) & 0xFFU));
    out.push_back(static_cast<std::uint8_t>((value >> 8U) & 0xFFU));
    out.push_back(static_cast<std::uint8_t>(value & 0xFFU));
}

void appendChunk(std::vector<std::uint8_t>& out, const char type[4], const std::vector<std::uint8_t>& data) {
    appendU32(out, static_cast<std::uint32_t>(data.size()));
    const std::size_t start = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), data.begin(), data.end());
    const std::uint32_t crc = crc32Update(0xFFFFFFFFU, out.data() + start, out.size() - start) ^ 0xFFFFFFFFU;
    appendU32(out, crc);
}

}  // namespace

bool renderScene(const Scene& scene, const RenderOptions& options, std::vector<std::uint8_t>& rgba,
                 RenderStats& stats, std::string& error) {
    const auto started = std::chrono::steady_clock::now();
    error.clear();
    stats = RenderStats{};

    int width = std::clamp(options.width, 64, 1920);
    int height = std::clamp(options.height, 64, 1080);
    int supersample = std::clamp(options.supersample, 1, 4);
    while (supersample > 1 && (static_cast<long long>(width) * supersample > 4096 || static_cast<long long>(height) * supersample > 4096 ||
                               static_cast<long long>(width) * height * supersample * supersample > 16'000'000LL)) {
        --supersample;
    }
    const int internalWidth = width * supersample;
    const int internalHeight = height * supersample;
    if (internalWidth < 1 || internalHeight < 1) {
        error = "Dimensions de rendu invalides.";
        return false;
    }

    // Validate transforms used by the renderer before touching the framebuffer.
    Bounds meshBounds;
    for (const auto& entity : scene.entities()) {
        if (!entity.visible) continue;
        if (entity.type == "Mesh" || entity.type == "Prefab") {
            const M4 world = entityWorldMatrix(scene, entity);
            const MeshData& mesh = meshFor(entity);
            for (const auto& vertex : mesh.vertices) meshBounds.include(transformPoint(world, vertex.position));
        }
    }

    CameraSetup camera = selectCamera(scene, options, meshBounds);
    Lighting lighting = buildLighting(scene, meshBounds, options);

    std::vector<BlobShadow> shadows;
    std::vector<Triangle> triangles;
    std::unordered_set<std::string> loadedTextures;
    int meshCount = 0;
    int lightCount = 0;
    int textureErrors = 0;

    for (const auto& entity : scene.entities()) {
        if (!entity.visible) continue;
        const M4 world = entityWorldMatrix(scene, entity);
        const M3 normalMatrix = inverseTranspose(upper3(world));
        const bool selected = !options.selectedId.empty() && entity.id == options.selectedId;

        if (entity.type == "Mesh" || entity.type == "Prefab") {
            const MeshData& mesh = meshFor(entity);
            const Material material = entityMaterial(entity);
            std::shared_ptr<const Texture> texture;
            if (!material.texture.empty()) {
                std::string textureError;
                texture = loadTexture(material.texture, options.assetRoot, textureError);
                if (texture) {
                    loadedTextures.insert(material.texture);
                } else {
                    ++textureErrors;
                }
            }
            Bounds localBounds;
            for (const auto& vertex : mesh.vertices) {
                const V3 position = transformPoint(world, vertex.position);
                localBounds.include(position);
            }
            if (!localBounds.valid) continue;
            const V3 size = localBounds.size();
            const V3 center = localBounds.center();
            const float radius = std::max({size.x, size.z, 0.4F}) * 0.62F;
            shadows.push_back({center.x, center.z, radius, 0.44F});

            for (std::size_t index = 0; index + 2 < mesh.indices.size(); index += 3) {
                Triangle triangle;
                triangle.albedo = V3{material.albedo.x, material.albedo.y, material.albedo.z};
                triangle.texture = texture;
                triangle.roughness = material.roughness;
                triangle.metallic = material.metallic;
                triangle.tiling = material.tiling;
                triangle.pattern = material.pattern;
                triangle.emissive = material.emissive;
                triangle.selected = selected;
                triangle.entityId = entity.id;
                for (int corner = 0; corner < 3; ++corner) {
                    const Vertex& vertex = mesh.vertices[mesh.indices[index + static_cast<std::size_t>(corner)]];
                    triangle.position[corner] = transformPoint(world, vertex.position);
                    triangle.normal[corner] = normalize(mul(normalMatrix, vertex.normal));
                    triangle.uv[corner] = vertex.uv;
                }
                triangles.push_back(std::move(triangle));
            }
            ++meshCount;
        } else if (entity.type == "Light") {
            ++lightCount;
        }
    }

    // Shadow maps are rasterized from the same geometry before the camera pass.
    for (auto& shadowMap : lighting.shadowMaps) renderShadowMap(shadowMap, triangles);

    Framebuffer framebuffer(internalWidth, internalHeight);
    drawBackground(framebuffer, camera, options, shadows);
    rasterizeScene(framebuffer, triangles, camera, lighting, options, stats);

    // Selection and gizmo overlays are drawn after the shaded pass, depth-tested.
    for (const auto& entity : scene.entities()) {
        if (!entity.visible) continue;
        const bool selected = !options.selectedId.empty() && entity.id == options.selectedId;
        if (entity.type == "Mesh" || entity.type == "Prefab") {
            if (!selected) continue;
            const M4 world = entityWorldMatrix(scene, entity);
            const MeshData& mesh = meshFor(entity);
            Bounds bounds;
            for (const auto& vertex : mesh.vertices) bounds.include(transformPoint(world, vertex.position));
            if (bounds.valid) drawBoxWireframe(framebuffer, camera, bounds.min, bounds.max, {0.20F, 0.78F, 1.0F});
        } else if (entity.type == "Camera") {
            if (!camera.id.empty() && camera.id == entity.id) continue;
            const M4 world = entityWorldMatrix(scene, entity);
            const V3 eye = transformPoint(world, {0.0F, 0.0F, 0.0F});
            if (length(camera.eye - eye) < 0.25F) continue;
            const V3 forward = normalize(transformDirection(world, {0.0F, 0.0F, -1.0F}));
            const V3 right = normalize(transformDirection(world, {1.0F, 0.0F, 0.0F}));
            const V3 up = normalize(transformDirection(world, {0.0F, 1.0F, 0.0F}));
            const V3 corners[4] = {eye + forward * 1.15F + right * 0.55F + up * 0.34F,
                                   eye + forward * 1.15F - right * 0.55F + up * 0.34F,
                                   eye + forward * 1.15F - right * 0.55F - up * 0.34F,
                                   eye + forward * 1.15F + right * 0.55F - up * 0.34F};
            const V3 color = selected ? V3{0.55F, 0.92F, 1.0F} : V3{0.32F, 0.70F, 0.95F};
            for (const auto& corner : corners) projectLine(framebuffer, camera, eye, corner, color);
            projectLine(framebuffer, camera, corners[0], corners[1], color);
            projectLine(framebuffer, camera, corners[1], corners[2], color);
            projectLine(framebuffer, camera, corners[2], corners[3], color);
            projectLine(framebuffer, camera, corners[3], corners[0], color);
            projectLine(framebuffer, camera, eye, eye + up * 0.45F, color);
        } else if (entity.type == "Light") {
            const M4 world = entityWorldMatrix(scene, entity);
            const V3 position = transformPoint(world, {0.0F, 0.0F, 0.0F});
            const bool directional = mentions(entity, "directional") || mentions(entity, "sun");
            const V3 color = selected ? V3{1.0F, 0.92F, 0.62F} : V3{1.0F, 0.72F, 0.32F};
            if (directional) {
                const V3 direction = normalize(transformDirection(world, {0.0F, 0.0F, -1.0F}));
                projectLine(framebuffer, camera, position, position + direction * 1.4F, color);
                const V3 right = normalize(cross(direction, {0.0F, 1.0F, 0.0F}));
                const V3 tip = position + direction * 1.4F;
                projectLine(framebuffer, camera, tip, tip - direction * 0.35F + right * 0.18F, color);
                projectLine(framebuffer, camera, tip, tip - direction * 0.35F - right * 0.18F, color);
            } else {
                for (int ray = 0; ray < 6; ++ray) {
                    const float angle = 2.0F * kPi * static_cast<float>(ray) / 6.0F;
                    const V3 offset{std::cos(angle) * 0.45F, 0.0F, std::sin(angle) * 0.45F};
                    projectLine(framebuffer, camera, position, position + offset, color);
                }
                projectLine(framebuffer, camera, position + V3{0, 0.45F, 0}, position - V3{0, 0.45F, 0}, color);
            }
        } else if (entity.type == "Empty" && selected) {
            const M4 world = entityWorldMatrix(scene, entity);
            const V3 position = transformPoint(world, {0.0F, 0.0F, 0.0F});
            const V3 color{0.45F, 0.85F, 1.0F};
            projectLine(framebuffer, camera, position - V3{0.5F, 0, 0}, position + V3{0.5F, 0, 0}, color);
            projectLine(framebuffer, camera, position - V3{0, 0.5F, 0}, position + V3{0, 0.5F, 0}, color);
            projectLine(framebuffer, camera, position - V3{0, 0, 0.5F}, position + V3{0, 0, 0.5F}, color);
        } else if (entity.type == "Audio" && selected) {
            const M4 world = entityWorldMatrix(scene, entity);
            const V3 position = transformPoint(world, {0.0F, 0.0F, 0.0F});
            drawBoxWireframe(framebuffer, camera, position - V3{0.3F, 0.3F, 0.3F}, position + V3{0.3F, 0.3F, 0.3F}, {0.65F, 0.75F, 0.9F});
        }
    }

    postProcess(framebuffer, supersample, options, rgba);
    stats.width = width;
    stats.height = height;
    stats.internalWidth = internalWidth;
    stats.internalHeight = internalHeight;
    stats.meshes = meshCount;
    stats.lights = lightCount;
    stats.triangles = static_cast<int>(triangles.size());
    stats.shadowMaps = static_cast<int>(lighting.shadowMaps.size());
    stats.textures = static_cast<int>(loadedTextures.size());
    stats.cameraName = camera.name;
    (void)textureErrors;
    stats.milliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    return true;
}

std::vector<std::uint8_t> encodePngRgba(int width, int height, const std::vector<std::uint8_t>& rgba) {
    std::vector<std::uint8_t> png;
    if (width <= 0 || height <= 0 || rgba.size() < static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4U) return png;
    static constexpr std::uint8_t signature[8] = {0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
    png.insert(png.end(), signature, signature + 8);

    std::vector<std::uint8_t> header;
    appendU32(header, static_cast<std::uint32_t>(width));
    appendU32(header, static_cast<std::uint32_t>(height));
    header.push_back(8U);   // bit depth
    header.push_back(6U);   // colour type RGBA
    header.push_back(0U);   // compression
    header.push_back(0U);   // filter
    header.push_back(0U);   // interlace
    appendChunk(png, "IHDR", header);

    std::vector<std::uint8_t> raw;
    raw.reserve((static_cast<std::size_t>(width) * 4U + 1U) * static_cast<std::size_t>(height));
    for (int y = 0; y < height; ++y) {
        raw.push_back(0U);
        const std::size_t row = static_cast<std::size_t>(y) * static_cast<std::size_t>(width) * 4U;
        raw.insert(raw.end(), rgba.begin() + static_cast<std::ptrdiff_t>(row), rgba.begin() + static_cast<std::ptrdiff_t>(row + static_cast<std::size_t>(width) * 4U));
    }

    std::vector<std::uint8_t> zlib;
    zlib.push_back(0x78U);
    zlib.push_back(0x01U);
    std::size_t offset = 0;
    constexpr std::size_t blockSize = 65535U;
    while (offset < raw.size()) {
        const std::size_t size = std::min(blockSize, raw.size() - offset);
        const bool last = offset + size >= raw.size();
        zlib.push_back(last ? 0x01U : 0x00U);
        zlib.push_back(static_cast<std::uint8_t>(size & 0xFFU));
        zlib.push_back(static_cast<std::uint8_t>((size >> 8U) & 0xFFU));
        const std::uint16_t inverse = static_cast<std::uint16_t>(~static_cast<std::uint16_t>(size));
        zlib.push_back(static_cast<std::uint8_t>(inverse & 0xFFU));
        zlib.push_back(static_cast<std::uint8_t>((inverse >> 8U) & 0xFFU));
        zlib.insert(zlib.end(), raw.begin() + static_cast<std::ptrdiff_t>(offset), raw.begin() + static_cast<std::ptrdiff_t>(offset + size));
        offset += size;
    }
    const std::uint32_t checksum = adler32(raw);
    zlib.push_back(static_cast<std::uint8_t>((checksum >> 24U) & 0xFFU));
    zlib.push_back(static_cast<std::uint8_t>((checksum >> 16U) & 0xFFU));
    zlib.push_back(static_cast<std::uint8_t>((checksum >> 8U) & 0xFFU));
    zlib.push_back(static_cast<std::uint8_t>(checksum & 0xFFU));
    appendChunk(png, "IDAT", zlib);
    appendChunk(png, "IEND", {});
    return png;
}

bool writePngFile(const std::string& path, int width, int height, const std::vector<std::uint8_t>& rgba, std::string& error) {
    const std::vector<std::uint8_t> png = encodePngRgba(width, height, rgba);
    if (png.empty()) {
        error = "Impossible d'encoder l'image PNG (dimensions invalides).";
        return false;
    }
    const std::string temporary = path + ".tmp";
    {
        std::ofstream file(temporary, std::ios::binary | std::ios::trunc);
        if (!file) {
            error = "Impossible d'écrire le rendu : " + path;
            return false;
        }
        file.write(reinterpret_cast<const char*>(png.data()), static_cast<std::streamsize>(png.size()));
        if (!file) {
            error = "Écriture du rendu incomplète.";
            return false;
        }
    }
    std::remove(path.c_str());
    if (std::rename(temporary.c_str(), path.c_str()) != 0) {
        std::remove(temporary.c_str());
        error = "Impossible de finaliser le fichier de rendu : " + path;
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// GPU scene extraction.
//
// The GPU backends do not re-implement scene traversal: they consume the same
// geometry, hierarchy, camera and lighting used by the software rasterizer.
// ---------------------------------------------------------------------------
bool buildGpuScene(const Scene& scene, const RenderOptions& options, GpuScene& out,
                   std::string& error) {
    out = GpuScene{};
    if (options.width < 1 || options.height < 1) {
        error = "Dimensions de rendu GPU invalides.";
        return false;
    }

    Bounds meshBounds;
    for (const auto& entity : scene.entities()) {
        if (!entity.visible) continue;
        if (entity.type != "Mesh" && entity.type != "Prefab") continue;
        const M4 world = entityWorldMatrix(scene, entity);
        const MeshData& mesh = meshFor(entity);
        for (const auto& vertex : mesh.vertices) meshBounds.include(transformPoint(world, vertex.position));
    }

    const CameraSetup camera = selectCamera(scene, options, meshBounds);
    const Lighting lighting = buildLighting(scene, meshBounds, options);

    for (int row = 0; row < 4; ++row) {
        for (int column = 0; column < 4; ++column) {
            out.viewProjection[row * 4 + column] = camera.viewProjection.m[row][column];
        }
    }
    out.cameraPosition[0] = camera.eye.x;
    out.cameraPosition[1] = camera.eye.y;
    out.cameraPosition[2] = camera.eye.z;
    out.cameraName = camera.name;

    const V3 zenith{0.010F, 0.020F, 0.048F};
    const V3 horizon{0.070F, 0.120F, 0.200F};
    const auto copy3 = [](const V3& value, float (&target)[3]) {
        target[0] = value.x;
        target[1] = value.y;
        target[2] = value.z;
    };
    copy3(zenith, out.backgroundTop);
    copy3(horizon, out.backgroundBottom);
    copy3(lighting.ambientSky, out.ambientSky);
    copy3(lighting.ambientGround, out.ambientGround);
    out.exposure = std::clamp(options.exposure, 0.05F, 8.0F);
    out.bloom = options.bloom;
    out.bloomIntensity = std::clamp(options.bloomIntensity, 0.0F, 2.0F);

    for (const auto& light : lighting.lights) {
        if (out.lights.size() >= 8U) break;
        GpuLight gpu;
        gpu.type = static_cast<int>(light.type);
        copy3(light.position, gpu.position);
        copy3(light.direction, gpu.direction);
        copy3(light.color, gpu.color);
        gpu.intensity = light.intensity;
        gpu.range = light.range;
        gpu.cosOuter = light.cosOuter;
        gpu.cosInner = light.cosInner;
        gpu.shadowIndex = light.shadowIndex;
        out.lights.push_back(gpu);
    }
    for (const auto& map : lighting.shadowMaps) {
        GpuShadowMap shadow;
        shadow.size = map.size;
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                shadow.viewProjection[row * 4 + column] = map.viewProjection.m[row][column];
            }
        }
        out.shadowMaps.push_back(shadow);
    }

    constexpr int kTextureSize = 512;
    std::unordered_map<std::string, float> textureLayers;
    for (const auto& entity : scene.entities()) {
        if (!entity.visible) continue;
        if (entity.type != "Mesh" && entity.type != "Prefab") continue;
        const MeshData& mesh = meshFor(entity);
        if (mesh.vertices.empty() || mesh.indices.empty()) continue;

        const M4 world = entityWorldMatrix(scene, entity);
        const M3 normalMatrix = inverseTranspose(upper3(world));
        const Material material = entityMaterial(entity);
        const bool selected = !options.selectedId.empty() && entity.id == options.selectedId;
        const float patternId = static_cast<float>(static_cast<int>(material.pattern));

        float textureIndex = -1.0F;
        if (!material.texture.empty()) {
            const auto existing = textureLayers.find(material.texture);
            if (existing != textureLayers.end()) {
                textureIndex = existing->second;
            } else {
                std::string textureError;
                Image image;
                if (loadImageFile(joinAssetPath(options.assetRoot, material.texture), image, textureError)) {
                    const Image resized = resizeImage(image, kTextureSize, kTextureSize);
                    if (resized.valid()) {
                        GpuTexture texture;
                        texture.width = resized.width;
                        texture.height = resized.height;
                        texture.rgba = resized.rgba;
                        textureIndex = static_cast<float>(out.textures.size());
                        out.textures.push_back(std::move(texture));
                        textureLayers.emplace(material.texture, textureIndex);
                    }
                }
            }
        }

        const auto base = static_cast<std::uint32_t>(out.vertices.size());
        if (base + mesh.vertices.size() > 0xFFFFFFFFULL) {
            error = "La scène GPU dépasse la limite d'index 32 bits.";
            return false;
        }

        for (const auto& vertex : mesh.vertices) {
            const V3 position = transformPoint(world, vertex.position);
            const V3 normal = normalize(mul(normalMatrix, vertex.normal));
            GpuVertex gpu{};
            gpu.position[0] = position.x;
            gpu.position[1] = position.y;
            gpu.position[2] = position.z;
            gpu.normal[0] = normal.x;
            gpu.normal[1] = normal.y;
            gpu.normal[2] = normal.z;
            gpu.color[0] = material.albedo.x;
            gpu.color[1] = material.albedo.y;
            gpu.color[2] = material.albedo.z;
            gpu.uv[0] = vertex.uv.x;
            gpu.uv[1] = vertex.uv.y;
            gpu.material[0] = material.roughness;
            gpu.material[1] = material.metallic;
            gpu.material[2] = patternId;
            gpu.material[3] = material.tiling;
            gpu.selected = selected ? 1.0F : 0.0F;
            gpu.textureIndex = textureIndex;
            out.vertices.push_back(gpu);
        }
        for (const std::uint32_t index : mesh.indices) out.indices.push_back(base + index);
        ++out.meshCount;
    }

    out.textureWidth = kTextureSize;
    out.textureHeight = kTextureSize;
    out.lightCount = static_cast<int>(out.lights.size());
    out.triangleCount = static_cast<int>(out.indices.size() / 3U);
    if (out.vertices.empty() || out.indices.empty()) {
        error = "La scène ne contient aucun maillage à rendre sur le GPU.";
        return false;
    }
    return true;
}

}  // namespace nova
