#pragma once

#include "nova/nova_core.hpp"

namespace nova {

// Camera contract shared by the runtime window and the tests. Matrices are
// row-major and use the same projection convention as the software rasterizer
// and the D3D12 backend (clip-space z in [0, 1]).
struct CameraPose {
    float position[3]{0.0F, 2.0F, 8.0F};
    float yawDegrees{0.0F};    // Rotation around +Y. 0 looks toward -Z.
    float pitchDegrees{-8.0F}; // Positive looks up, clamped by FreeCamera.
    float fovYDegrees{48.0F};
    float nearZ{0.05F};
    float farZ{600.0F};
};

// Per-frame input consumed by FreeCamera. Mouse deltas are expressed in pixels
// and are reset by NativeWindow::takeInput().
struct CameraInput {
    bool forward{};
    bool back{};
    bool left{};
    bool right{};
    bool up{};
    bool down{};
    bool sprint{};
    float mouseDeltaX{};
    float mouseDeltaY{};
};

class FreeCamera {
public:
    static constexpr float kBaseSpeed = 4.0F;          // metres per second
    static constexpr float kSprintMultiplier = 3.0F;
    static constexpr float kLookSensitivity = 0.12F;   // degrees per pixel
    static constexpr float kMaxPitch = 89.0F;
    static constexpr double kMaxDeltaSeconds = 0.1;

    FreeCamera() = default;
    explicit FreeCamera(const CameraPose& pose) : pose_(pose) { clampPose(); }

    void setPose(const CameraPose& pose) noexcept;
    [[nodiscard]] const CameraPose& pose() const noexcept { return pose_; }

    // Applies mouse look and keyboard movement. deltaSeconds is clamped to
    // [0, kMaxDeltaSeconds] so a stall cannot teleport the camera.
    void update(const CameraInput& input, double deltaSeconds) noexcept;

    // Explicit primitives used by update() and by the tests.
    void look(float deltaXPixels, float deltaYPixels) noexcept;
    void moveLocal(float forward, float right, float up, double deltaSeconds) noexcept;

    [[nodiscard]] bool viewMatrix(float out[16]) const noexcept;
    [[nodiscard]] bool viewProjection(int width, int height, float out[16]) const noexcept;
    void forwardVector(float out[3]) const noexcept;
    void rightVector(float out[3]) const noexcept;

private:
    void clampPose() noexcept;
    CameraPose pose_{};
};

// Extracts a free-camera pose from an entity world transform. The engine model
// matrix applies Y then X rotations, so yaw comes from rotation.y and pitch
// from rotation.x.
[[nodiscard]] CameraPose cameraPoseFromTransform(const Transform& worldTransform) noexcept;
[[nodiscard]] bool cameraViewProjection(const CameraPose& pose, int width, int height,
                                        float out[16]) noexcept;

}  // namespace nova
