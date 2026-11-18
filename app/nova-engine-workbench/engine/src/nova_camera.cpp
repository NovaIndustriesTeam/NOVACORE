#include "nova/nova_camera.hpp"

#include <algorithm>
#include <cmath>

namespace nova {
namespace {

constexpr float kPi = 3.14159265358979323846F;

float radians(float degrees) noexcept { return degrees * kPi / 180.0F; }

struct V3 {
    float x{};
    float y{};
    float z{};
};

V3 add(const V3& a, const V3& b) noexcept { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
V3 scale(const V3& a, float s) noexcept { return {a.x * s, a.y * s, a.z * s}; }
float dot(const V3& a, const V3& b) noexcept { return a.x * b.x + a.y * b.y + a.z * b.z; }
V3 cross(const V3& a, const V3& b) noexcept {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
V3 normalize(const V3& v) noexcept {
    const float length = std::sqrt(dot(v, v));
    return length > 1.0e-6F ? scale(v, 1.0F / length) : V3{0.0F, 0.0F, -1.0F};
}
bool finite(float value) noexcept { return std::isfinite(value); }

void multiply(const float a[16], const float b[16], float out[16]) noexcept {
    for (int row = 0; row < 4; ++row) {
        for (int column = 0; column < 4; ++column) {
            float sum = 0.0F;
            for (int k = 0; k < 4; ++k) sum += a[row * 4 + k] * b[k * 4 + column];
            out[row * 4 + column] = sum;
        }
    }
}

void perspective(float fovYRadians, float aspect, float nearZ, float farZ, float out[16]) noexcept {
    const float f = 1.0F / std::tan(fovYRadians * 0.5F);
    for (int index = 0; index < 16; ++index) out[index] = 0.0F;
    out[0] = f / std::max(aspect, 1.0e-6F);
    out[5] = f;
    out[10] = farZ / (nearZ - farZ);
    out[11] = (farZ * nearZ) / (nearZ - farZ);
    out[14] = -1.0F;
}

void lookAt(const V3& eye, const V3& forward, float out[16]) noexcept {
    V3 up{0.0F, 1.0F, 0.0F};
    if (std::abs(dot(forward, up)) > 0.999F) up = {0.0F, 0.0F, 1.0F};
    const V3 right = normalize(cross(forward, up));
    up = cross(right, forward);

    for (int index = 0; index < 16; ++index) out[index] = 0.0F;
    out[0] = right.x; out[1] = right.y; out[2] = right.z; out[3] = -dot(right, eye);
    out[4] = up.x;    out[5] = up.y;    out[6] = up.z;    out[7] = -dot(up, eye);
    out[8] = -forward.x; out[9] = -forward.y; out[10] = -forward.z; out[11] = dot(forward, eye);
    out[15] = 1.0F;
}

V3 forwardOf(const CameraPose& pose) noexcept {
    const float yaw = radians(pose.yawDegrees);
    const float pitch = radians(pose.pitchDegrees);
    const float cp = std::cos(pitch);
    return {-std::sin(yaw) * cp, std::sin(pitch), -std::cos(yaw) * cp};
}

V3 rightOf(const CameraPose& pose) noexcept {
    const float yaw = radians(pose.yawDegrees);
    return {std::cos(yaw), 0.0F, -std::sin(yaw)};
}

float wrapDegrees(float value) noexcept {
    value = std::fmod(value + 180.0F, 360.0F);
    if (value < 0.0F) value += 360.0F;
    return value - 180.0F;
}

}  // namespace

void FreeCamera::setPose(const CameraPose& pose) noexcept {
    pose_ = pose;
    clampPose();
}

void FreeCamera::clampPose() noexcept {
    const auto finiteOr = [](float value, float fallback) { return std::isfinite(value) ? value : fallback; };
    pose_.position[0] = finiteOr(pose_.position[0], 0.0F);
    pose_.position[1] = finiteOr(pose_.position[1], 2.0F);
    pose_.position[2] = finiteOr(pose_.position[2], 8.0F);
    pose_.yawDegrees = wrapDegrees(finiteOr(pose_.yawDegrees, 0.0F));
    pose_.pitchDegrees = std::clamp(finiteOr(pose_.pitchDegrees, 0.0F), -kMaxPitch, kMaxPitch);
    pose_.fovYDegrees = std::clamp(finiteOr(pose_.fovYDegrees, 48.0F), 10.0F, 120.0F);
    pose_.nearZ = finiteOr(pose_.nearZ, 0.05F);
    pose_.farZ = finiteOr(pose_.farZ, 600.0F);
    if (pose_.nearZ <= 0.0F) pose_.nearZ = 0.05F;
    if (pose_.farZ <= pose_.nearZ) pose_.farZ = pose_.nearZ + 0.05F;
}

void FreeCamera::look(float deltaXPixels, float deltaYPixels) noexcept {
    if (!std::isfinite(deltaXPixels) || !std::isfinite(deltaYPixels)) return;
    // Moving the mouse right turns right (yaw decreases); moving it down looks
    // down (pitch decreases).
    pose_.yawDegrees = wrapDegrees(pose_.yawDegrees - deltaXPixels * kLookSensitivity);
    pose_.pitchDegrees = std::clamp(pose_.pitchDegrees - deltaYPixels * kLookSensitivity,
                                    -kMaxPitch, kMaxPitch);
}

void FreeCamera::moveLocal(float forward, float right, float up, double deltaSeconds) noexcept {
    if (!std::isfinite(forward) || !std::isfinite(right) || !std::isfinite(up)) return;
    if (!std::isfinite(deltaSeconds)) return;
    const float norm = std::sqrt(forward * forward + right * right + up * up);
    if (norm <= 0.0F) return;
    // Sprint is applied by update(); moveLocal stays a raw metre/second primitive.
    const float distance = static_cast<float>(std::clamp(deltaSeconds, 0.0, kMaxDeltaSeconds)) * kBaseSpeed;
    if (norm > 1.0F) {
        forward /= norm;
        right /= norm;
        up /= norm;
    }
    const V3 f = forwardOf(pose_);
    const V3 r = rightOf(pose_);
    const V3 position{pose_.position[0], pose_.position[1], pose_.position[2]};
    const V3 moved = add(position, add(add(scale(f, forward * distance), scale(r, right * distance)),
                                      V3{0.0F, up * distance, 0.0F}));
    pose_.position[0] = moved.x;
    pose_.position[1] = moved.y;
    pose_.position[2] = moved.z;
}

void FreeCamera::update(const CameraInput& input, double deltaSeconds) noexcept {
    if (!std::isfinite(deltaSeconds)) return;
    const double dt = std::clamp(deltaSeconds, 0.0, kMaxDeltaSeconds);
    look(input.mouseDeltaX, input.mouseDeltaY);

    const float forward = (input.forward ? 1.0F : 0.0F) - (input.back ? 1.0F : 0.0F);
    const float right = (input.right ? 1.0F : 0.0F) - (input.left ? 1.0F : 0.0F);
    const float up = (input.up ? 1.0F : 0.0F) - (input.down ? 1.0F : 0.0F);
    const float norm = std::sqrt(forward * forward + right * right + up * up);
    if (norm <= 0.0F) return;

    const float factor = (norm > 1.0F ? 1.0F / norm : 1.0F) * (input.sprint ? kSprintMultiplier : 1.0F);
    const float distance = static_cast<float>(dt) * kBaseSpeed * factor;
    const V3 f = forwardOf(pose_);
    const V3 r = rightOf(pose_);
    const V3 position{pose_.position[0], pose_.position[1], pose_.position[2]};
    const V3 moved = add(position, add(add(scale(f, forward * distance), scale(r, right * distance)),
                                      V3{0.0F, up * distance, 0.0F}));
    pose_.position[0] = moved.x;
    pose_.position[1] = moved.y;
    pose_.position[2] = moved.z;
}

void FreeCamera::forwardVector(float out[3]) const noexcept {
    const V3 forward = forwardOf(pose_);
    out[0] = forward.x;
    out[1] = forward.y;
    out[2] = forward.z;
}

void FreeCamera::rightVector(float out[3]) const noexcept {
    const V3 right = rightOf(pose_);
    out[0] = right.x;
    out[1] = right.y;
    out[2] = right.z;
}

bool FreeCamera::viewMatrix(float out[16]) const noexcept {
    if (!out) return false;
    lookAt(V3{pose_.position[0], pose_.position[1], pose_.position[2]}, forwardOf(pose_), out);
    return true;
}

bool FreeCamera::viewProjection(int width, int height, float out[16]) const noexcept {
    if (!out || width < 1 || height < 1) return false;
    float view[16]{};
    float projection[16]{};
    (void)viewMatrix(view);
    perspective(radians(pose_.fovYDegrees), static_cast<float>(width) / static_cast<float>(height),
                pose_.nearZ, pose_.farZ, projection);
    multiply(projection, view, out);
    return true;
}

CameraPose cameraPoseFromTransform(const Transform& worldTransform) noexcept {
    CameraPose pose;
    pose.position[0] = worldTransform.position.x;
    pose.position[1] = worldTransform.position.y;
    pose.position[2] = worldTransform.position.z;
    pose.yawDegrees = worldTransform.rotationDegrees.y;
    pose.pitchDegrees = worldTransform.rotationDegrees.x;
    return pose;
}

bool cameraViewProjection(const CameraPose& pose, int width, int height, float out[16]) noexcept {
    FreeCamera camera(pose);
    return camera.viewProjection(width, height, out);
}

}  // namespace nova
