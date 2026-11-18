#include "nova/nova_camera.hpp"
#include "nova/nova_core.hpp"
#include "nova/nova_gpu.hpp"
#include "nova/nova_render.hpp"
#include "nova/nova_window.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace {
constexpr std::size_t kMaxSceneBytes = 4U * 1024U * 1024U;

void printUsage() {
    std::cout << "Nova Engine " << nova::info().version << " — moteur tridimensionnel C++20\n\n"
              << "Usage :\n"
              << "  NovaEngine                              Démonstration du noyau et du runtime\n"
              << "  NovaEngine --scene <fichier>            Charge et résume une scène JSON\n"
              << "  NovaEngine --scene <fichier> --validate Valide la scène (code 1 si invalide)\n"
              << "  NovaEngine --scene <fichier> --json     Réécrit la scène normalisée sur stdout\n"
              << "  NovaEngine --scene <fichier> --export <sortie>\n"
              << "                                          Exporte la scène normalisée\n"
              << "  NovaEngine --scene <fichier> --render <image.png> [options]\n"
              << "                                          Rasterise la scène sur CPU (logiciel)\n"
              << "  NovaEngine --scene <fichier> --render-gpu <image.png> [options]\n"
              << "                                          Rasterise la scène sur GPU (D3D12)\n"
              << "  NovaEngine --scene <fichier> --run [options]\n"
              << "                                          Ouvre la fenêtre native D3D12\n"
              << "  NovaEngine --gpu-info                   Liste les adaptateurs graphiques détectés\n\n"
              << "Options de rendu :\n"
              << "  --width <pixels>        Largeur de sortie (64-1920, défaut 960)\n"
              << "  --height <pixels>       Hauteur de sortie (64-1080, défaut 540)\n"
              << "  --supersample <1-4>     Anticrénelage interne CPU (défaut 2)\n"
              << "  --camera <id>           Caméra à utiliser (défaut : première caméra)\n"
              << "  --selected <id>         Entité surlignée dans le rendu\n"
              << "  --no-grid               Désactive la grille de sol (rendu CPU)\n"
              << "  --no-shadows            Désactive les shadow maps directionnelle/spot\n"
              << "  --shadow-resolution <n> Résolution des shadow maps (128-2048, défaut 1024)\n"
              << "  --no-bloom              Désactive le bloom HDR du post-traitement\n"
              << "  --bloom-intensity <v>   Intensité du bloom (0-2, défaut 0.45)\n"
              << "  --wireframe             Affiche les triangles en filaire\n"
              << "  --exposure <valeur>     Exposition (défaut 1.0)\n"
              << "  --assets <dossier>      Racine des textures PNG/JPEG relatives\n"
              << "  --backend <nom>         auto|d3d12|vulkan|metal|software (défaut auto)\n"
              << "  --stats-json            Écrit les statistiques de rendu en JSON sur stdout\n"
              << "  --gpu-json              Avec --gpu-info, écrit la liste en JSON\n\n"
              << "Options du runtime natif :\n"
              << "  --run                   Ouvre la fenêtre native et présente le swapchain D3D12\n"
              << "  --window-hidden         Fenêtre non affichée (tests automatisés, capture)\n"
              << "  --frames <n>            Rend n frames puis ferme (0 = interactif)\n"
              << "  --capture <image.png>   Capture PNG de la dernière frame présentée\n\n"
              << "Contrôles fenêtre : ZQSD/WASD déplacer, souris (clic droit) regarder,\n"
              << "E monter, C descendre, Maj sprinter, F1 filaire, Échap fermer.\n"
              << "  NovaEngine --help       Affiche cette aide\n";
}

bool readFile(const std::string& path, std::string& content, std::string& error) {
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        error = "Impossible d'ouvrir le fichier de scène : " + path;
        return false;
    }
    file.seekg(0, std::ios::end);
    const auto size = file.tellg();
    if (size < 0 || static_cast<std::size_t>(size) > kMaxSceneBytes) {
        error = "Le fichier de scène dépasse la limite de 4 Mo.";
        return false;
    }
    content.resize(static_cast<std::size_t>(size));
    file.seekg(0, std::ios::beg);
    if (!content.empty()) file.read(content.data(), static_cast<std::streamsize>(content.size()));
    if (!file) {
        error = "Lecture du fichier de scène incomplète.";
        return false;
    }
    return true;
}

bool writeFile(const std::string& path, std::string_view content, std::string& error) {
    const std::string temporary = path + ".tmp";
    {
        std::ofstream file(temporary, std::ios::binary | std::ios::trunc);
        if (!file) {
            error = "Impossible d'écrire le fichier de sortie : " + path;
            return false;
        }
        file.write(content.data(), static_cast<std::streamsize>(content.size()));
        if (!file) {
            error = "Écriture du fichier de sortie incomplète.";
            return false;
        }
    }
    if (std::rename(temporary.c_str(), path.c_str()) != 0) {
        std::remove(temporary.c_str());
        error = "Impossible de remplacer le fichier de sortie : " + path;
        return false;
    }
    return true;
}

bool parseInt(std::string_view value, int minimum, int maximum, int& target) {
    std::string literal(value);
    char* end = nullptr;
    const long parsed = std::strtol(literal.c_str(), &end, 10);
    if (end == literal.c_str() || *end != '\0' || parsed < minimum || parsed > maximum) return false;
    target = static_cast<int>(parsed);
    return true;
}

bool parseFloat(std::string_view value, float& target) {
    std::string literal(value);
    char* end = nullptr;
    const float parsed = std::strtof(literal.c_str(), &end);
    if (end == literal.c_str() || *end != '\0' || !std::isfinite(parsed) || parsed <= 0.0F || parsed > 8.0F) return false;
    target = parsed;
    return true;
}

bool parseFloatRange(std::string_view value, float minimum, float maximum, float& target) {
    std::string literal(value);
    char* end = nullptr;
    const float parsed = std::strtof(literal.c_str(), &end);
    if (end == literal.c_str() || *end != '\0' || !std::isfinite(parsed) || parsed < minimum || parsed > maximum) return false;
    target = parsed;
    return true;
}

std::string jsonEscape(std::string_view value) {
    std::string result;
    for (const char c : value) {
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result.push_back(c); break;
        }
    }
    return result;
}

void printSummary(const nova::Scene& scene) {
    std::cout << "\n  NOVA ENGINE / " << nova::info().version << "\n"
              << "  --------------------------------\n"
              << "  Core API      : " << nova::info().apiVersion << "\n"
              << "  Scene         : " << scene.name() << "\n"
              << "  Entities      : " << scene.entities().size() << "\n"
              << "  Visible count : " << scene.visibleEntityCount() << "\n"
              << "  Hierarchy     : " << std::count_if(scene.entities().begin(), scene.entities().end(), [](const nova::Entity& entity) { return entity.parentId.has_value(); }) << " enfant(s) rattaché(s)\n"
              << "  Renderer      : software 3D rasterizer (z-buffer, lights, PNG output)\n";
}

nova::CameraInput cameraInputFrom(const nova::NativeInput& native) {
    nova::CameraInput input;
    input.forward = native.forward;
    input.back = native.back;
    input.left = native.left;
    input.right = native.right;
    input.up = native.up;
    input.down = native.down;
    input.sprint = native.sprint;
    input.mouseDeltaX = native.mouseDeltaX;
    input.mouseDeltaY = native.mouseDeltaY;
    return input;
}

int runNativeRuntime(const nova::Scene& scene, const nova::RenderOptions& options, bool hidden,
                     int frames, const std::string& capturePath, bool statsJson) {
    if (hidden && frames <= 0) {
        std::cerr << "Erreur : --window-hidden exige --frames <n> positif.\n";
        return 2;
    }
    if (!capturePath.empty() && frames <= 0) {
        std::cerr << "Erreur : --capture exige --frames <n> positif.\n";
        return 2;
    }

    std::string error;
    nova::GpuScene gpuScene;
    if (!nova::buildGpuScene(scene, options, gpuScene, error)) {
        std::cerr << "Erreur runtime : " << error << "\n";
        return 1;
    }

    nova::CameraPose pose;
    const nova::Entity* cameraEntity = nullptr;
    if (!options.cameraId.empty()) {
        cameraEntity = scene.findEntity(options.cameraId);
        if (cameraEntity && (cameraEntity->type != "Camera" || !cameraEntity->visible)) {
            cameraEntity = nullptr;
        }
    }
    if (!cameraEntity) {
        for (const auto& entity : scene.entities()) {
            if (entity.visible && entity.type == "Camera") {
                cameraEntity = &entity;
                break;
            }
        }
    }
    if (cameraEntity) {
        if (const auto world = scene.worldTransform(cameraEntity->id)) {
            pose = nova::cameraPoseFromTransform(*world);
        }
    }

    nova::NativeWindowDesc windowDesc;
    windowDesc.width = options.width;
    windowDesc.height = options.height;
    windowDesc.visible = !hidden;
    windowDesc.title = "Nova Engine — Runtime D3D12";

    nova::NativeWindow window;
    if (!window.open(windowDesc, error)) {
        std::cerr << "Erreur runtime : " << error << "\n";
        return 1;
    }
    window.setWireframe(options.wireframe);
    nova::FreeCamera camera(pose);

    std::vector<std::uint8_t> capture;
    nova::GpuRenderStats stats;
    bool haveStats = false;
    int rendered = 0;
    double totalMilliseconds = 0.0;
    auto previous = std::chrono::steady_clock::now();

    while (true) {
        if (!window.pump()) break;
        if (frames > 0 && rendered >= frames) break;

        double deltaSeconds = 1.0 / 60.0;
        if (!hidden && frames == 0) {
            const auto now = std::chrono::steady_clock::now();
            deltaSeconds =
                std::clamp(std::chrono::duration<double>(now - previous).count(), 0.0, 0.1);
            previous = now;
        }
        const nova::NativeInput native = window.takeInput();
        camera.update(cameraInputFrom(native), deltaSeconds);

        const bool lastFrame = frames > 0 && rendered + 1 >= frames;
        const bool wantCapture = lastFrame && !capturePath.empty();
        capture.clear();
        if (!window.render(gpuScene, camera.pose(), window.wireframe(),
                           wantCapture ? &capture : nullptr, stats, error)) {
            std::cerr << "Erreur runtime : " << error << "\n";
            window.close();
            return 1;
        }
        haveStats = true;
        totalMilliseconds += stats.milliseconds;
        ++rendered;
        if (lastFrame) break;
    }
    window.close();

    if (!haveStats) {
        std::cerr << "Erreur runtime : aucune frame n'a pu être rendue.\n";
        return 1;
    }

    std::uint64_t captureBytes = 0;
    if (!capturePath.empty()) {
        if (capture.empty()) {
            std::cerr << "Erreur runtime : capture demandée mais aucune image n'a été lue.\n";
            return 1;
        }
        if (!nova::writePngFile(capturePath, stats.width, stats.height, capture, error)) {
            std::cerr << "Erreur runtime : " << error << "\n";
            return 1;
        }
        std::error_code sizeError;
        const auto size = std::filesystem::file_size(capturePath, sizeError);
        if (!sizeError) captureBytes = static_cast<std::uint64_t>(size);
    }

    const double average = rendered > 0 ? totalMilliseconds / static_cast<double>(rendered) : 0.0;
    if (statsJson) {
        std::cout << "{\"ok\":true,\"backend\":\"" << jsonEscape(stats.backend)
                  << "\",\"adapter\":\"" << jsonEscape(stats.adapter)
                  << "\",\"width\":" << stats.width
                  << ",\"height\":" << stats.height
                  << ",\"frames\":" << rendered
                  << ",\"meshes\":" << stats.meshes
                  << ",\"lights\":" << stats.lights
                  << ",\"triangles\":" << stats.triangles
                  << ",\"drawCalls\":" << stats.drawCalls
                  << ",\"wireframe\":" << (options.wireframe ? "true" : "false")
                  << ",\"milliseconds\":" << average;
        if (!capturePath.empty()) {
            std::cout << ",\"capture\":\"" << jsonEscape(capturePath) << "\""
                      << ",\"captureBytes\":" << captureBytes;
        }
        std::cout << "}\n";
    } else {
        std::cout << "Runtime natif : " << rendered << " frame(s), " << stats.width << "×"
                  << stats.height << ", " << stats.backend << " / " << stats.adapter << ", "
                  << stats.triangles << " triangles, " << stats.meshes << " maillage(s), "
                  << stats.lights << " lumière(s), " << average << " ms/frame moyenne.\n";
        if (!capturePath.empty()) {
            std::cout << "Capture fenêtre : " << capturePath << " (" << captureBytes
                      << " octets).\n";
        }
    }
    return 0;
}
}  // namespace

int main(int argc, char** argv) {
    std::string scenePath;
    std::string exportPath;
    std::string renderPath;
    std::string gpuRenderPath;
    bool validate = false;
    bool printJson = false;
    bool help = false;
    bool statsJson = false;
    bool gpuInfo = false;
    bool gpuJson = false;
    bool runNative = false;
    bool windowHidden = false;
    bool widthSpecified = false;
    bool heightSpecified = false;
    int frames = 0;
    std::string capturePath;
    nova::GpuBackend backend = nova::GpuBackend::Auto;
    nova::RenderOptions renderOptions;

    for (int index = 1; index < argc; ++index) {
        const std::string_view argument = argv[index];
        const auto nextValue = [&](int& cursor) -> std::string_view {
            if (cursor + 1 >= argc) return {};
            return argv[++cursor];
        };
        if (argument == "--help" || argument == "-h") {
            help = true;
        } else if (argument == "--validate") {
            validate = true;
        } else if (argument == "--json") {
            printJson = true;
        } else if (argument == "--stats-json") {
            statsJson = true;
        } else if (argument == "--gpu-info") {
            gpuInfo = true;
        } else if (argument == "--gpu-json") {
            gpuJson = true;
        } else if (argument == "--no-grid") {
            renderOptions.grid = false;
        } else if (argument == "--no-shadows") {
            renderOptions.shadows = false;
        } else if (argument == "--no-bloom") {
            renderOptions.bloom = false;
        } else if (argument == "--wireframe") {
            renderOptions.wireframe = true;
        } else if (argument == "--run") {
            runNative = true;
        } else if (argument == "--window-hidden") {
            windowHidden = true;
        } else if (argument == "--scene" || argument == "--export" || argument == "--render" ||
                   argument == "--render-gpu" || argument == "--backend" ||
                   argument == "--width" || argument == "--height" || argument == "--supersample" ||
                   argument == "--camera" || argument == "--selected" || argument == "--exposure" ||
                   argument == "--assets" ||
                   argument == "--bloom-intensity" || argument == "--shadow-resolution" ||
                   argument == "--frames" || argument == "--capture") {
            const std::string_view value = nextValue(index);
            if (value.empty()) {
                std::cerr << "Erreur : valeur manquante pour " << argument << ".\n";
                return 2;
            }
            if (argument == "--scene") scenePath = value;
            else if (argument == "--export") exportPath = value;
            else if (argument == "--render") renderPath = value;
            else if (argument == "--render-gpu") gpuRenderPath = value;
            else if (argument == "--camera") renderOptions.cameraId = value;
            else if (argument == "--selected") renderOptions.selectedId = value;
            else if (argument == "--assets") renderOptions.assetRoot = value;
            else if (argument == "--backend" && !nova::parseGpuBackend(value, backend)) {
                std::cerr << "Erreur : backend inconnu " << value << " (auto, d3d12, vulkan, metal, software).\n";
                return 2;
            } else if (argument == "--width") {
                if (!parseInt(value, 64, 1920, renderOptions.width)) {
                    std::cerr << "Erreur : --width doit être compris entre 64 et 1920.\n";
                    return 2;
                }
                widthSpecified = true;
            } else if (argument == "--height") {
                if (!parseInt(value, 64, 1080, renderOptions.height)) {
                    std::cerr << "Erreur : --height doit être compris entre 64 et 1080.\n";
                    return 2;
                }
                heightSpecified = true;
            } else if (argument == "--frames") {
                if (!parseInt(value, 1, 100000, frames)) {
                    std::cerr << "Erreur : --frames doit être compris entre 1 et 100000.\n";
                    return 2;
                }
            } else if (argument == "--capture") {
                capturePath = value;
            } else if (argument == "--supersample" && !parseInt(value, 1, 4, renderOptions.supersample)) {
                std::cerr << "Erreur : --supersample doit être compris entre 1 et 4.\n";
                return 2;
            } else if (argument == "--exposure" && !parseFloat(value, renderOptions.exposure)) {
                std::cerr << "Erreur : --exposure doit être un nombre entre 0 et 8.\n";
                return 2;
            } else if (argument == "--bloom-intensity" &&
                       !parseFloatRange(value, 0.0F, 2.0F, renderOptions.bloomIntensity)) {
                std::cerr << "Erreur : --bloom-intensity doit être un nombre entre 0 et 2.\n";
                return 2;
            } else if (argument == "--shadow-resolution" &&
                       !parseInt(value, 128, 2048, renderOptions.shadowResolution)) {
                std::cerr << "Erreur : --shadow-resolution doit être compris entre 128 et 2048.\n";
                return 2;
            }
        } else {
            std::cerr << "Erreur : option inconnue " << argument << ".\n";
            printUsage();
            return 2;
        }
    }

    if (runNative) {
        if (!widthSpecified) renderOptions.width = 1280;
        if (!heightSpecified) renderOptions.height = 720;
    }

    if (help) {
        printUsage();
        return 0;
    }

    if (gpuInfo || gpuJson) {
        const nova::GpuInfo info = nova::queryGpuInfo();
        if (gpuJson) {
            std::cout << "{\"available\":" << (info.available ? "true" : "false")
                      << ",\"backend\":\"" << jsonEscape(info.backend) << "\"";
            if (!info.error.empty()) std::cout << ",\"error\":\"" << jsonEscape(info.error) << "\"";
            std::cout << ",\"adapters\":[";
            for (std::size_t index = 0; index < info.adapters.size(); ++index) {
                const auto& adapter = info.adapters[index];
                if (index > 0) std::cout << ',';
                std::cout << "{\"name\":\"" << jsonEscape(adapter.name) << "\""
                          << ",\"backend\":\"" << jsonEscape(adapter.backend) << "\""
                          << ",\"vendorId\":" << adapter.vendorId
                          << ",\"deviceId\":" << adapter.deviceId
                          << ",\"dedicatedMemory\":" << adapter.dedicatedMemory
                          << ",\"hardware\":" << (adapter.hardware ? "true" : "false") << '}';
            }
            std::cout << "]}\n";
        } else {
            std::cout << "\n  NOVA ENGINE / GPU\n"
                      << "  --------------------------------\n"
                      << "  Backend       : " << info.backend << "\n"
                      << "  Disponible    : " << (info.available ? "oui" : "non") << "\n";
            if (!info.error.empty()) std::cout << "  Erreur        : " << info.error << "\n";
            for (const auto& adapter : info.adapters) {
                std::cout << "  Adaptateur    : " << adapter.name << "\n"
                          << "                  " << (adapter.hardware ? "matériel" : "logiciel")
                          << ", " << (adapter.dedicatedMemory / (1024ULL * 1024ULL)) << " Mio dédiés"
                          << ", vendor 0x" << std::hex << adapter.vendorId << std::dec
                          << ", device 0x" << std::hex << adapter.deviceId << std::dec << "\n";
            }
            std::cout << '\n';
        }
        return 0;
    }

    if (scenePath.empty()) {
        if (runNative) {
            nova::Scene scene;
            scene.setName("Runtime");
            const auto cameraId = scene.createEntity("Main Camera", "Camera");
            auto* camera = scene.findEntity(cameraId);
            camera->transform.position = {0.0F, 1.6F, 6.0F};
            camera->transform.rotationDegrees = {-8.0F, 0.0F, 0.0F};
            const auto meshId = scene.createEntity("Cube", "Mesh");
            auto* mesh = scene.findEntity(meshId);
            mesh->transform.position = {0.0F, 0.8F, 0.0F};
            mesh->transform.rotationDegrees = {0.0F, 24.0F, 0.0F};
            const auto lightId = scene.createEntity("Key Light", "Light");
            auto* light = scene.findEntity(lightId);
            light->transform.position = {3.0F, 5.0F, 3.0F};
            light->transform.rotationDegrees = {-45.0F, 35.0F, 0.0F};
            light->components = {"Directional Light"};
            return runNativeRuntime(scene, renderOptions, windowHidden, frames, capturePath,
                                    statsJson);
        }
        if (validate || printJson || !exportPath.empty() || !renderPath.empty() || !gpuRenderPath.empty()) {
            std::cerr << "Erreur : --scene <fichier> est requis.\n";
            return 2;
        }
        const auto engine = nova::info();
        nova::Scene scene;
        (void)scene.createEntity("Main Camera", "Camera");
        (void)scene.createEntity("Key Light", "Light");
        (void)scene.createEntity("Starter Entity", "Mesh");

        nova::Runtime runtime;
        runtime.initialize();
        const auto frame = runtime.tick(1.0 / 60.0, scene);

        std::cout << "\n  NOVA ENGINE / " << engine.version << "\n"
                  << "  --------------------------------\n"
                  << "  Core API      : " << engine.apiVersion << "\n"
                  << "  Runtime       : " << (runtime.initialized() ? "initialized" : "stopped") << "\n"
                  << "  Scene entities: " << scene.entities().size() << "\n"
                  << "  Visible count : " << frame.visibleEntities << "\n"
                  << "  Frame counter : " << frame.frameNumber << "\n"
                  << "  Renderer      : software 3D rasterizer (z-buffer, lights, PNG output)\n"
                  << "  Workspace     : ready for development\n\n";
        runtime.shutdown();
        return nova::isSupportedApiVersion(engine.apiVersion) ? 0 : 3;
    }

    std::string content;
    std::string error;
    if (!readFile(scenePath, content, error)) {
        std::cerr << "Erreur : " << error << "\n";
        return 1;
    }
    nova::Scene scene;
    if (!nova::sceneFromJson(content, scene, error)) {
        std::cerr << "Scène invalide : " << error << "\n";
        return 1;
    }
    if (runNative) {
        return runNativeRuntime(scene, renderOptions, windowHidden, frames, capturePath, statsJson);
    }
    if (validate) {
        std::cout << "Scène valide : " << scene.name() << " (" << scene.entities().size() << " entité(s)).\n";
    }
    if (printJson) {
        std::cout << nova::sceneToJson(scene);
    }
    if (!renderPath.empty()) {
        std::vector<std::uint8_t> rgba;
        nova::RenderStats stats;
        if (!nova::renderScene(scene, renderOptions, rgba, stats, error)) {
            std::cerr << "Erreur de rendu : " << error << "\n";
            return 1;
        }
        if (!nova::writePngFile(renderPath, stats.width, stats.height, rgba, error)) {
            std::cerr << "Erreur de rendu : " << error << "\n";
            return 1;
        }
        if (statsJson) {
            std::cout << "{\"ok\":true,\"width\":" << stats.width
                      << ",\"height\":" << stats.height
                      << ",\"internalWidth\":" << stats.internalWidth
                      << ",\"internalHeight\":" << stats.internalHeight
                      << ",\"meshes\":" << stats.meshes
                      << ",\"lights\":" << stats.lights
                      << ",\"triangles\":" << stats.triangles
                      << ",\"shadowMaps\":" << stats.shadowMaps
                      << ",\"textures\":" << stats.textures
                      << ",\"bloom\":" << (renderOptions.bloom ? "true" : "false")
                      << ",\"meshPixels\":" << stats.meshPixels
                      << ",\"milliseconds\":" << stats.milliseconds
                      << ",\"camera\":\"" << jsonEscape(stats.cameraName) << "\"}\n";
        } else {
            std::cout << "Rendu 3D : " << renderPath << " (" << stats.width << "×" << stats.height
                      << ", " << stats.triangles << " triangles, " << stats.meshes << " maillage(s), "
                      << stats.lights << " lumière(s), " << stats.milliseconds << " ms).\n";
        }
    }
    if (!gpuRenderPath.empty()) {
        if (backend == nova::GpuBackend::Metal || backend == nova::GpuBackend::Vulkan) {
            std::cerr << "Erreur : le backend " << nova::gpuBackendName(backend)
                      << " n'est pas encore implémenté. Utilisez --backend d3d12 ou --render.\n";
            return 2;
        }
        if (backend == nova::GpuBackend::Software) {
            std::cerr << "Erreur : --render-gpu exige un backend matériel. Utilisez --render pour le logiciel.\n";
            return 2;
        }

        nova::GpuScene gpuScene;
        if (!nova::buildGpuScene(scene, renderOptions, gpuScene, error)) {
            std::cerr << "Erreur de rendu GPU : " << error << "\n";
            return 1;
        }

        std::vector<std::uint8_t> rgba;
        nova::GpuRenderStats stats;
        if (!nova::renderSceneGpu(gpuScene, renderOptions.width, renderOptions.height,
                                  renderOptions.wireframe, rgba, stats, error)) {
            std::cerr << "Erreur de rendu GPU : " << error << "\n";
            return 1;
        }
        if (!nova::writePngFile(gpuRenderPath, stats.width, stats.height, rgba, error)) {
            std::cerr << "Erreur de rendu GPU : " << error << "\n";
            return 1;
        }
        if (statsJson) {
            std::cout << "{\"ok\":true,\"backend\":\"" << jsonEscape(stats.backend)
                      << "\",\"adapter\":\"" << jsonEscape(stats.adapter)
                      << "\",\"width\":" << stats.width
                      << ",\"height\":" << stats.height
                      << ",\"meshes\":" << stats.meshes
                      << ",\"lights\":" << stats.lights
                      << ",\"triangles\":" << stats.triangles
                      << ",\"drawCalls\":" << stats.drawCalls
                      << ",\"shadowMaps\":" << gpuScene.shadowMaps.size()
                      << ",\"textures\":" << gpuScene.textures.size()
                      << ",\"bloom\":" << (gpuScene.bloom ? "true" : "false")
                      << ",\"wireframe\":" << (renderOptions.wireframe ? "true" : "false")
                      << ",\"milliseconds\":" << stats.milliseconds
                      << ",\"camera\":\"" << jsonEscape(gpuScene.cameraName) << "\"}\n";
        } else {
            std::cout << "Rendu GPU : " << gpuRenderPath << " (" << stats.backend << " / " << stats.adapter
                      << ", " << stats.width << "×" << stats.height << ", " << stats.triangles
                      << " triangles, " << stats.meshes << " maillage(s), " << stats.lights
                      << " lumière(s), " << stats.drawCalls << " draw calls, "
                      << stats.milliseconds << " ms).\n";
        }
    }
    if (!exportPath.empty()) {
        if (!writeFile(exportPath, nova::sceneToJson(scene), error)) {
            std::cerr << "Erreur : " << error << "\n";
            return 1;
        }
        std::cout << "Scène exportée : " << exportPath << "\n";
    }
    if (!validate && !printJson && exportPath.empty() && renderPath.empty() && gpuRenderPath.empty()) {
        printSummary(scene);
    }
    return 0;
}
