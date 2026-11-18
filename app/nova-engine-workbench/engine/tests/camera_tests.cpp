#include "nova/nova_camera.hpp"

#include <cmath>
#include <cstring>
#include <iostream>

namespace {

int fail(int code, const char* message) {
    std::cerr << message << '\n';
    return code;
}

bool near(float value, float expected, float tolerance = 0.01F) {
    return std::abs(value - expected) <= tolerance;
}

float dot3(const float a[3], const float b[3]) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

}  // namespace

int main() {
    // A camera at (0, 2, 8) looking down -Z must map its own eye to the view
    // origin and a point one metre along its forward vector to view-space
    // z = -1. Pitch is flattened so the axes are exactly -Z / +X.
    nova::CameraPose pose;
    pose.pitchDegrees = 0.0F;
    nova::FreeCamera camera(pose);
    float view[16]{};
    if (!camera.viewMatrix(view)) return fail(1, "viewMatrix rejected a default camera");
    const auto toView = [&view](const float point[3], float out[3]) {
        for (int row = 0; row < 3; ++row) {
            out[row] = view[row * 4 + 0] * point[0] + view[row * 4 + 1] * point[1] +
                       view[row * 4 + 2] * point[2] + view[row * 4 + 3];
        }
    };
    float eyeView[3]{};
    toView(pose.position, eyeView);
    if (!near(eyeView[0], 0.0F) || !near(eyeView[1], 0.0F) || !near(eyeView[2], 0.0F)) {
        return fail(2, "Default camera eye does not map to the view origin");
    }

    float forward[3]{};
    float right[3]{};
    camera.forwardVector(forward);
    camera.rightVector(right);
    const float ahead[3] = {pose.position[0] + forward[0], pose.position[1] + forward[1],
                            pose.position[2] + forward[2]};
    float aheadView[3]{};
    toView(ahead, aheadView);
    if (!near(aheadView[0], 0.0F) || !near(aheadView[1], 0.0F) || !near(aheadView[2], -1.0F)) {
        return fail(3, "Camera forward axis is not -Z");
    }
    if (!near(forward[0], 0.0F) || !near(forward[1], 0.0F) || !near(forward[2], -1.0F)) {
        return fail(4, "Default forward vector is not (0, 0, -1)");
    }
    if (!near(right[0], 1.0F) || !near(right[1], 0.0F) || !near(right[2], 0.0F)) {
        return fail(5, "Default right vector is not (1, 0, 0)");
    }

    // Keyboard movement: W moves along the view direction, D strafes right,
    // E rises. Diagonal input is normalised so it is not faster. Delta time is
    // clamped to kMaxDeltaSeconds, so the tests use that exact step.
    constexpr double kStep = nova::FreeCamera::kMaxDeltaSeconds;
    constexpr float kStepDistance = static_cast<float>(kStep) * nova::FreeCamera::kBaseSpeed;
    nova::FreeCamera walker(pose);
    nova::CameraInput input;
    input.forward = true;
    walker.update(input, kStep);
    if (!near(walker.pose().position[2], pose.position[2] - kStepDistance)) {
        return fail(6, "Forward movement distance is incorrect");
    }
    input = {};
    input.right = true;
    walker = nova::FreeCamera(pose);
    walker.update(input, kStep);
    if (!near(walker.pose().position[0], kStepDistance)) {
        return fail(7, "Strafe movement distance is incorrect");
    }
    input = {};
    input.up = true;
    walker = nova::FreeCamera(pose);
    walker.update(input, kStep);
    if (!near(walker.pose().position[1], pose.position[1] + kStepDistance)) {
        return fail(8, "Vertical movement distance is incorrect");
    }

    nova::CameraInput diagonal;
    diagonal.forward = true;
    diagonal.right = true;
    nova::FreeCamera diagonalCamera(pose);
    diagonalCamera.update(diagonal, kStep);
    const float dx = diagonalCamera.pose().position[0] - pose.position[0];
    const float dz = diagonalCamera.pose().position[2] - pose.position[2];
    if (!near(std::sqrt(dx * dx + dz * dz), kStepDistance, 0.02F)) {
        return fail(9, "Diagonal movement is not normalised");
    }

    nova::CameraInput sprint;
    sprint.forward = true;
    sprint.sprint = true;
    nova::FreeCamera fast(pose);
    fast.update(sprint, kStep);
    if (!near(fast.pose().position[2], pose.position[2] - kStepDistance * nova::FreeCamera::kSprintMultiplier)) {
        return fail(10, "Sprint multiplier is not applied");
    }

    // Delta time is clamped so a long stall cannot teleport the camera.
    nova::FreeCamera clamped(pose);
    nova::CameraInput slow;
    slow.forward = true;
    clamped.update(slow, 10.0);
    if (!near(clamped.pose().position[2],
              pose.position[2] - nova::FreeCamera::kBaseSpeed * static_cast<float>(nova::FreeCamera::kMaxDeltaSeconds))) {
        return fail(11, "Delta time is not clamped");
    }

    // Mouse look: 100 px to the right turns 12 degrees right (negative yaw),
    // then W must move toward +X. Positive pixel Y looks down.
    nova::FreeCamera looking(pose);
    looking.look(100.0F, 0.0F);
    if (!near(looking.pose().yawDegrees, -12.0F, 0.001F)) return fail(12, "Yaw sensitivity is incorrect");
    nova::CameraInput walkLook;
    walkLook.forward = true;
    looking.update(walkLook, kStep);
    if (!(looking.pose().position[0] > pose.position[0] + 0.05F)) {
        return fail(13, "Turning right does not move the camera toward +X");
    }
    looking.look(0.0F, -100.0F);
    if (!near(looking.pose().pitchDegrees, 12.0F - 0.0F, 0.001F)) {
        // -100 px means looking up by 12 degrees from the previous pitch (0).
        return fail(14, "Pitch sensitivity is incorrect");
    }
    looking.look(0.0F, 100000.0F);
    if (!near(looking.pose().pitchDegrees, -nova::FreeCamera::kMaxPitch, 0.001F)) {
        return fail(15, "Pitch is not clamped");
    }

    // Projection: the forward point is at the centre of the screen and inside
    // the near/far range. The projection uses clip-space z in [0, 1].
    nova::CameraPose straight;
    straight.pitchDegrees = 0.0F;
    float viewProjection[16]{};
    if (!nova::cameraViewProjection(straight, 960, 540, viewProjection)) {
        return fail(16, "viewProjection rejected valid dimensions");
    }
    const float point[4] = {0.0F, 2.0F, 8.0F - 10.0F, 1.0F};
    float clip[4]{};
    for (int row = 0; row < 4; ++row) {
        clip[row] = 0.0F;
        for (int k = 0; k < 4; ++k) clip[row] += viewProjection[row * 4 + k] * point[k];
    }
    if (!near(clip[0] / clip[3], 0.0F, 0.001F) || !near(clip[1] / clip[3], 0.0F, 0.001F)) {
        return fail(17, "Forward point is not centred in clip space");
    }
    const float ndcZ = clip[2] / clip[3];
    if (!(ndcZ > 0.0F && ndcZ < 1.0F)) return fail(18, "Clip-space depth is outside [0, 1]");

    // Pose extraction from a world transform keeps yaw/pitch/position, and the
    // resulting forward vector is unit length.
    nova::Transform transform;
    transform.position = {1.0F, 2.5F, -3.0F};
    transform.rotationDegrees = {-15.0F, 35.0F, 20.0F};
    const nova::CameraPose extracted = nova::cameraPoseFromTransform(transform);
    if (!near(extracted.position[0], 1.0F) || !near(extracted.position[1], 2.5F) || !near(extracted.position[2], -3.0F)) {
        return fail(19, "Pose position extraction failed");
    }
    if (!near(extracted.yawDegrees, 35.0F) || !near(extracted.pitchDegrees, -15.0F)) {
        return fail(20, "Pose rotation extraction failed");
    }
    nova::FreeCamera extractedCamera(extracted);
    extractedCamera.forwardVector(forward);
    if (!near(std::sqrt(dot3(forward, forward)), 1.0F, 0.001F)) {
        return fail(21, "Extracted forward vector is not normalised");
    }

    // Determinism: the same pose and viewport produce identical matrices.
    float first[16]{};
    float second[16]{};
    (void)nova::cameraViewProjection(extracted, 1280, 720, first);
    (void)nova::cameraViewProjection(extracted, 1280, 720, second);
    if (std::memcmp(first, second, sizeof(first)) != 0) return fail(22, "Camera matrices are not deterministic");

    std::cout << "Nova Engine free-camera tests passed.\n";
    return 0;
}
