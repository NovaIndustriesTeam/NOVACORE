#include "nova/nova_core.hpp"

#include <cmath>
#include <iostream>
#include <string>

namespace {
int fail(int code, const char* message) {
    std::cerr << message << '\n';
    return code;
}
}  // namespace

int main() {
    const auto engine = nova::info();
    if (engine.name != "Nova Engine") return fail(1, "Engine name mismatch");
    if (engine.version.empty()) return fail(2, "Version must not be empty");
    if (!nova::isSupportedApiVersion(1) || !nova::isSupportedApiVersion(2) || !nova::isSupportedApiVersion(3) || !nova::isSupportedApiVersion(4) || !nova::isSupportedApiVersion(5) || !nova::isSupportedApiVersion(6)) return fail(3, "Supported API version rejected");
    if (nova::isSupportedApiVersion(999)) return fail(4, "Unknown API must not be supported");

    nova::Scene scene;
    const auto cameraId = scene.createEntity("Main Camera", "Camera");
    const auto meshId = scene.createEntity("Cube", "Mesh");
    if (cameraId.empty() || cameraId == meshId) return fail(5, "Entity identifiers must be unique");
    if (scene.entities().size() != 2 || scene.visibleEntityCount() != 2) return fail(6, "Scene creation/count failed");
    auto* cube = scene.findEntity(meshId);
    if (!cube || cube->name != "Cube") return fail(7, "Entity lookup failed");
    cube->visible = false;
    if (scene.visibleEntityCount() != 1) return fail(8, "Visibility count failed");
    cube->visible = true;
    cube->transform.position = {2.0F, 0.0F, 0.0F};
    cube->components = {"Mesh Renderer", "Collider"};
    const auto parentId = scene.createEntity("Parent", "Empty");
    auto* parent = scene.findEntity(parentId);
    parent->transform.position = {5.0F, 1.0F, 0.0F};
    parent->transform.scale = {2.0F, 2.0F, 2.0F};
    if (!scene.setParent(meshId, parentId) || scene.setParent(parentId, meshId)) return fail(9, "Scene parent validation failed");
    const auto world = scene.worldTransform(meshId);
    if (!world || std::abs(world->position.x - 9.0F) > 0.001F || std::abs(world->position.y - 1.0F) > 0.001F) return fail(10, "World transform failed");

    if (!scene.duplicateEntity(meshId) || scene.entities().size() != 4) return fail(11, "Entity duplication failed");
    if (!scene.renameEntity(meshId, "Renamed Cube") || scene.findEntity(meshId)->name != "Renamed Cube") return fail(12, "Entity rename failed");
    if (scene.renameEntity(meshId, "")) return fail(13, "Empty entity name should be rejected");
    if (!scene.removeEntity(cameraId) || scene.removeEntity("missing")) return fail(14, "Entity removal failed");
    if (!scene.removeEntity(parentId)) return fail(15, "Parent removal failed");
    if (scene.findEntity(meshId)->parentId.has_value()) return fail(16, "Removing a parent must promote its children to root");

    nova::Scene document;
    document.setName("Scène \"test\"\nNova");
    document.setUpdatedAt("2026-11-10T20:00:00.000Z");
    const auto rootId = document.createEntity("Root", "Empty");
    const auto childId = document.createEntity("Enfant", "Mesh");
    auto* root = document.findEntity(rootId);
    root->transform.position = {1.5F, -2.0F, 3.25F};
    root->transform.rotationDegrees = {0.0F, 90.0F, -15.5F};
    auto* child = document.findEntity(childId);
    child->transform.position = {2.0F, 0.0F, 0.0F};
    child->components = {"Mesh Renderer", "Collider"};
    child->material = nova::Material{{0.25F, 0.55F, 0.85F}, 0.75F, 0.18F, 12.0F, nova::SurfacePattern::Checker, false};
    child->visible = false;
    if (!document.setParent(childId, rootId)) return fail(17, "Document parent failed");
    std::string validationError;
    if (!nova::validateScene(document, validationError)) return fail(18, validationError.c_str());

    const std::string json = nova::sceneToJson(document);
    nova::Scene reloaded;
    if (!nova::sceneFromJson(json, reloaded, validationError)) return fail(19, validationError.c_str());
    if (reloaded.name() != document.name() || reloaded.updatedAt() != document.updatedAt()) return fail(20, "Scene metadata round-trip failed");
    if (reloaded.entities().size() != 2) return fail(21, "Scene entity round-trip failed");
    const auto* reloadedChild = reloaded.findEntity(childId);
    if (!reloadedChild || reloadedChild->parentId != rootId || reloadedChild->visible || reloadedChild->components.size() != 2) return fail(22, "Entity round-trip failed");
    if (!reloadedChild->material || reloadedChild->material->pattern != nova::SurfacePattern::Checker ||
        std::abs(reloadedChild->material->metallic - 0.75F) > 0.001F ||
        std::abs(reloadedChild->material->roughness - 0.18F) > 0.001F ||
        std::abs(reloadedChild->material->tiling - 12.0F) > 0.001F) return fail(40, "Material round-trip failed");
    const auto reloadedWorld = reloaded.worldTransform(childId);
    if (!reloadedWorld || std::abs(reloadedWorld->position.x - 3.5F) > 0.001F || std::abs(reloadedWorld->position.y - -2.0F) > 0.001F) return fail(23, "World transform round-trip failed");
    if (nova::sceneToJson(reloaded) != json) return fail(24, "Repeated serialization must be stable");

    nova::Scene rejected;
    if (nova::sceneFromJson("{", rejected, validationError)) return fail(25, "Malformed JSON must be rejected");
    if (!nova::sceneFromJson(R"({"schemaVersion":1,"name":"X","entities":[]})", rejected, validationError)) return fail(26, "Schema version 1 should remain compatible");
    if (!nova::sceneFromJson(R"({"schemaVersion":3,"name":"X","entities":[]})", rejected, validationError)) return fail(41, "Schema version 3 must be accepted");
    if (!nova::sceneFromJson(R"({"schemaVersion":4,"name":"X","entities":[]})", rejected, validationError)) return fail(27, "Schema version 4 must be accepted");
    if (nova::sceneFromJson(R"({"schemaVersion":5,"name":"X","entities":[]})", rejected, validationError)) return fail(64, "Unknown schema version must be rejected");
    if (nova::sceneFromJson(R"({"schemaVersion":2,"name":"X","entities":[{"id":"a","name":"A","type":"Mesh","position":[0,0,0],"rotation":[0,0,0],"scale":[0,1,1]}]})", rejected, validationError)) return fail(28, "Zero scale must be rejected");
    if (nova::sceneFromJson(R"({"schemaVersion":2,"name":"X","entities":[{"id":"a","name":"A","type":"Unknown","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]}]})", rejected, validationError)) return fail(29, "Unknown entity type must be rejected");
    if (nova::sceneFromJson(R"({"schemaVersion":2,"name":"X","entities":[{"id":"a","name":"A","type":"Mesh","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]},{"id":"a","name":"B","type":"Mesh","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]}]})", rejected, validationError)) return fail(30, "Duplicate entity ids must be rejected");
    if (nova::sceneFromJson(R"({"schemaVersion":2,"name":"X","entities":[{"id":"a","name":"A","type":"Mesh","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],"parentId":"missing"}]})", rejected, validationError)) return fail(31, "Missing parent must be rejected");
    if (nova::sceneFromJson(R"({"schemaVersion":2,"name":"X","entities":[{"id":"a","name":"A","type":"Mesh","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],"parentId":"b"},{"id":"b","name":"B","type":"Mesh","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],"parentId":"a"}]})", rejected, validationError)) return fail(32, "Cyclic hierarchy must be rejected");
    if (nova::sceneFromJson(R"({"schemaVersion":3,"name":"X","entities":[{"id":"a","name":"A","type":"Mesh","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],"material":{"albedo":[0.2,0.4,0.8],"metallic":2.0,"roughness":0.5,"tiling":4,"pattern":"none","emissive":false}}]})", rejected, validationError)) return fail(42, "Out-of-range metallic must be rejected");
    if (nova::sceneFromJson(R"({"schemaVersion":3,"name":"X","entities":[{"id":"a","name":"A","type":"Mesh","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1],"material":{"albedo":[0.2,0.4,0.8],"metallic":0.0,"roughness":0.5,"tiling":4,"pattern":"stripes","emissive":false}}]})", rejected, validationError)) return fail(43, "Unknown pattern must be rejected");

    nova::SurfacePattern pattern = nova::SurfacePattern::None;
    if (!nova::parseSurfacePattern("checker", pattern) || pattern != nova::SurfacePattern::Checker) return fail(44, "Checker pattern parse failed");
    if (!nova::parseSurfacePattern("grid", pattern) || pattern != nova::SurfacePattern::Grid) return fail(45, "Grid pattern parse failed");
    if (nova::parseSurfacePattern("stripes", pattern)) return fail(46, "Unknown pattern must not parse");
    if (std::string(nova::surfacePatternName(nova::SurfacePattern::Grid)) != "grid") return fail(47, "Grid pattern name failed");
    nova::Material defaults = nova::defaultMaterialFor(*document.findEntity(childId));
    if (!nova::isValidMaterial(defaults) || defaults.pattern != nova::SurfacePattern::None) return fail(48, "Default material invalid");
    nova::Material invalid = defaults;
    invalid.roughness = 0.0F;
    if (nova::isValidMaterial(invalid)) return fail(49, "Invalid roughness must be rejected");

    nova::Material textured = defaults;
    textured.texture = "textures/brick.png";
    if (!nova::isValidMaterial(textured)) return fail(50, "Relative PNG texture path must be valid");
    textured.texture = "../secret.png";
    if (nova::isValidMaterial(textured)) return fail(51, "Parent traversal texture path must be rejected");
    textured.texture = "C:/absolute.png";
    if (nova::isValidMaterial(textured)) return fail(52, "Absolute texture path must be rejected");
    textured.texture = "textures/data.bmp";
    if (nova::isValidMaterial(textured)) return fail(53, "Non PNG/JPEG texture must be rejected");

    nova::Light spot;
    spot.type = nova::LightType::Spot;
    spot.spotAngle = 35.0F;
    if (!nova::isValidLight(spot)) return fail(54, "Valid spot light rejected");
    spot.spotAngle = 120.0F;
    if (nova::isValidLight(spot)) return fail(55, "Out-of-range spot angle accepted");

    nova::Primitive primitive = nova::Primitive::Cube;
    if (!nova::parsePrimitive("torus", primitive) || primitive != nova::Primitive::Torus) return fail(56, "Torus primitive parse failed");
    if (nova::parsePrimitive("blob", primitive)) return fail(57, "Unknown primitive must not parse");

    // Gameplay: the spinner rotates, the collectible is picked up and the
    // rigidbody falls under gravity. All three are deterministic in play mode.
    nova::Scene playScene;
    const auto playerId = playScene.createEntity("Player", "Mesh");
    playScene.findEntity(playerId)->controller = nova::Controller{4.0F, 5.0F};
    const auto spinnerId = playScene.createEntity("Spinner", "Mesh");
    playScene.findEntity(spinnerId)->spinner = nova::Spinner{{0.0F, 1.0F, 0.0F}, 90.0F};
    const auto coinId = playScene.createEntity("Coin", "Mesh");
    playScene.findEntity(coinId)->collectible = nova::Collectible{50.0F, 5};
    const auto fallerId = playScene.createEntity("Faller", "Mesh");
    auto* faller = playScene.findEntity(fallerId);
    faller->transform.position = {6.0F, 5.0F, 0.0F};
    faller->rigidbody = nova::Rigidbody{{0.0F, 0.0F, 0.0F}, 1.0F, 0.25F, true};

    nova::Runtime playRuntime;
    if (!playRuntime.startPlay(playScene) || !playRuntime.playing()) return fail(58, "Play mode must start with a controller");
    const float spinBefore = playScene.findEntity(spinnerId)->transform.rotationDegrees.y;
    nova::PlayInput playInput;
    playRuntime.play(playScene, playInput, 0.5);
    const float spinAfter = playScene.findEntity(spinnerId)->transform.rotationDegrees.y;
    // The runtime clamps a single step to 0.1 s (frame-time safety), so the
    // spinner advances by degreesPerSecond * 0.1 for this call.
    if (std::abs((spinAfter - spinBefore) - 9.0F) > 0.5F) return fail(59, "Spinner must rotate by degreesPerSecond * clamped delta");
    if (playScene.findEntity(coinId)->visible) return fail(60, "Collectible inside its radius must be collected");
    if (playRuntime.playStats().score != 5 || playRuntime.playStats().collected != 1) return fail(61, "Collectible score must be reported");
    if (playScene.findEntity(fallerId)->transform.position.y >= 5.0F) return fail(62, "Rigidbody with gravity must fall");
    playRuntime.stopPlay();
    if (playRuntime.playing()) return fail(63, "Play mode must stop");

    nova::Runtime runtime;
    if (runtime.initialized()) return fail(33, "Runtime should start stopped");
    runtime.initialize();
    const auto stats = runtime.tick(1.0 / 60.0, document);
    if (!runtime.initialized() || stats.frameNumber != 1 || stats.visibleEntities != 1) return fail(34, "Runtime tick failed");
    if (std::abs(stats.deltaSeconds - (1.0 / 60.0)) > 0.0001) return fail(35, "Delta time incorrect");
    const auto clamped = runtime.tick(3.0, document);
    if (clamped.deltaSeconds > 0.2501) return fail(36, "Delta clamp failed");
    runtime.shutdown();
    if (runtime.initialized()) return fail(37, "Runtime shutdown failed");

    nova::Transform valid{};
    if (!nova::isValidTransform(valid)) return fail(38, "Default transform invalid");
    valid.scale.x = 0.0F;
    if (nova::isValidTransform(valid)) return fail(39, "Singular transform should be rejected");

    std::cout << "Nova Engine core/scene/json/runtime tests passed.\n";
    return 0;
}
