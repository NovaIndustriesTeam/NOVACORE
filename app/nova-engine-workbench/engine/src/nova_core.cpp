#include "nova/nova_core.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <limits>
#include <sstream>
#include <string>
#include <utility>

namespace nova {
namespace {
constexpr std::size_t kMaxEntities = 250;
constexpr std::size_t kMaxComponents = 32;
constexpr std::size_t kMaxJsonBytes = 4U * 1024U * 1024U;
constexpr int kMaxJsonDepth = 64;

constexpr bool isKnownType(const std::string& type) noexcept {
    return type == "Empty" || type == "Mesh" || type == "Camera" || type == "Light" || type == "Audio" || type == "Prefab";
}

struct JsonValue {
    enum class Type { Null, Bool, Number, String, Array, Object };
    Type type{Type::Null};
    bool boolean{false};
    double number{0.0};
    std::string text;
    std::vector<JsonValue> items;
    std::vector<std::pair<std::string, JsonValue>> members;

    [[nodiscard]] const JsonValue* member(std::string_view key) const noexcept {
        const auto it = std::find_if(members.begin(), members.end(), [key](const auto& entry) { return entry.first == key; });
        return it == members.end() ? nullptr : &it->second;
    }
};

class JsonReader {
public:
    explicit JsonReader(std::string_view input) : input_(input) {}

    [[nodiscard]] bool parse(JsonValue& out, std::string& error) {
        if (input_.size() > kMaxJsonBytes) {
            error = "Document JSON trop volumineux (4 Mo maximum).";
            return false;
        }
        skipWhitespace();
        if (!readValue(out, 0)) {
            error = error_.empty() ? "Document JSON invalide." : error_;
            return false;
        }
        skipWhitespace();
        if (position_ != input_.size()) {
            error = "Contenu inattendu après la racine JSON.";
            return false;
        }
        return true;
    }

private:
    [[nodiscard]] bool fail(std::string message) {
        if (error_.empty()) error_ = std::move(message);
        return false;
    }
    void skipWhitespace() noexcept {
        while (position_ < input_.size()) {
            const char c = input_[position_];
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
            ++position_;
        }
    }
    [[nodiscard]] bool consume(char expected) noexcept {
        if (position_ >= input_.size() || input_[position_] != expected) return false;
        ++position_;
        return true;
    }
    [[nodiscard]] bool readValue(JsonValue& out, int depth) {
        if (depth > kMaxJsonDepth) return fail("Profondeur JSON maximale dépassée.");
        skipWhitespace();
        if (position_ >= input_.size()) return fail("Document JSON incomplet.");
        const char c = input_[position_];
        if (c == '{') return readObject(out, depth);
        if (c == '[') return readArray(out, depth);
        if (c == '"') {
            out.type = JsonValue::Type::String;
            return readString(out.text);
        }
        if (input_.compare(position_, 4, "true") == 0) {
            position_ += 4;
            out.type = JsonValue::Type::Bool;
            out.boolean = true;
            return true;
        }
        if (input_.compare(position_, 5, "false") == 0) {
            position_ += 5;
            out.type = JsonValue::Type::Bool;
            out.boolean = false;
            return true;
        }
        if (input_.compare(position_, 4, "null") == 0) {
            position_ += 4;
            out.type = JsonValue::Type::Null;
            return true;
        }
        if (c == '-' || (c >= '0' && c <= '9')) return readNumber(out);
        return fail("Valeur JSON inattendue.");
    }
    [[nodiscard]] bool readObject(JsonValue& out, int depth) {
        if (!consume('{')) return fail("Objet JSON attendu.");
        out.type = JsonValue::Type::Object;
        skipWhitespace();
        if (consume('}')) return true;
        while (true) {
            skipWhitespace();
            std::string key;
            if (!readString(key)) return false;
            skipWhitespace();
            if (!consume(':')) return fail("Deux-points attendu dans l'objet JSON.");
            JsonValue value;
            if (!readValue(value, depth + 1)) return false;
            out.members.emplace_back(std::move(key), std::move(value));
            skipWhitespace();
            if (consume('}')) return true;
            if (!consume(',')) return fail("Virgule ou accolade fermante attendue.");
        }
    }
    [[nodiscard]] bool readArray(JsonValue& out, int depth) {
        if (!consume('[')) return fail("Tableau JSON attendu.");
        out.type = JsonValue::Type::Array;
        skipWhitespace();
        if (consume(']')) return true;
        while (true) {
            JsonValue value;
            if (!readValue(value, depth + 1)) return false;
            out.items.push_back(std::move(value));
            skipWhitespace();
            if (consume(']')) return true;
            if (!consume(',')) return fail("Virgule ou crochet fermant attendu.");
        }
    }
    [[nodiscard]] bool readNumber(JsonValue& out) {
        const std::size_t start = position_;
        if (position_ < input_.size() && input_[position_] == '-') ++position_;
        if (position_ >= input_.size()) return fail("Nombre JSON incomplet.");
        if (input_[position_] == '0') {
            ++position_;
        } else if (input_[position_] >= '1' && input_[position_] <= '9') {
            while (position_ < input_.size() && input_[position_] >= '0' && input_[position_] <= '9') ++position_;
        } else {
            return fail("Nombre JSON invalide.");
        }
        if (position_ < input_.size() && input_[position_] == '.') {
            ++position_;
            if (position_ >= input_.size() || input_[position_] < '0' || input_[position_] > '9') return fail("Fraction JSON invalide.");
            while (position_ < input_.size() && input_[position_] >= '0' && input_[position_] <= '9') ++position_;
        }
        if (position_ < input_.size() && (input_[position_] == 'e' || input_[position_] == 'E')) {
            ++position_;
            if (position_ < input_.size() && (input_[position_] == '+' || input_[position_] == '-')) ++position_;
            if (position_ >= input_.size() || input_[position_] < '0' || input_[position_] > '9') return fail("Exposant JSON invalide.");
            while (position_ < input_.size() && input_[position_] >= '0' && input_[position_] <= '9') ++position_;
        }
        const std::string literal(input_.substr(start, position_ - start));
        char* end = nullptr;
        const double value = std::strtod(literal.c_str(), &end);
        if (end == literal.c_str() || !std::isfinite(value)) return fail("Nombre JSON non fini.");
        out.type = JsonValue::Type::Number;
        out.number = value;
        return true;
    }
    [[nodiscard]] static int hexDigit(char c) noexcept {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }
    [[nodiscard]] bool readHex4(std::uint32_t& value) {
        if (position_ + 4 > input_.size()) return fail("Séquence Unicode incomplète.");
        value = 0;
        for (int index = 0; index < 4; ++index) {
            const int digit = hexDigit(input_[position_ + static_cast<std::size_t>(index)]);
            if (digit < 0) return fail("Séquence Unicode invalide.");
            value = (value << 4U) | static_cast<std::uint32_t>(digit);
        }
        position_ += 4;
        return true;
    }
    static void appendUtf8(std::string& out, std::uint32_t codePoint) {
        if (codePoint <= 0x7FU) {
            out.push_back(static_cast<char>(codePoint));
        } else if (codePoint <= 0x7FFU) {
            out.push_back(static_cast<char>(0xC0U | (codePoint >> 6U)));
            out.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
        } else if (codePoint <= 0xFFFFU) {
            out.push_back(static_cast<char>(0xE0U | (codePoint >> 12U)));
            out.push_back(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3FU)));
            out.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
        } else {
            out.push_back(static_cast<char>(0xF0U | (codePoint >> 18U)));
            out.push_back(static_cast<char>(0x80U | ((codePoint >> 12U) & 0x3FU)));
            out.push_back(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3FU)));
            out.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
        }
    }
    [[nodiscard]] bool readString(std::string& out) {
        if (!consume('"')) return fail("Chaîne JSON attendue.");
        while (position_ < input_.size()) {
            const char c = input_[position_++];
            if (c == '"') return true;
            if (static_cast<unsigned char>(c) < 0x20U) return fail("Caractère de contrôle interdit dans une chaîne JSON.");
            if (c != '\\') {
                out.push_back(c);
                continue;
            }
            if (position_ >= input_.size()) return fail("Échappement JSON incomplet.");
            const char escaped = input_[position_++];
            switch (escaped) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    std::uint32_t codePoint = 0;
                    if (!readHex4(codePoint)) return false;
                    if (codePoint >= 0xD800U && codePoint <= 0xDBFFU) {
                        if (position_ + 2 > input_.size() || input_[position_] != '\\' || input_[position_ + 1] != 'u') return fail("Paire de substitution Unicode incomplète.");
                        position_ += 2;
                        std::uint32_t low = 0;
                        if (!readHex4(low) || low < 0xDC00U || low > 0xDFFFU) return fail("Paire de substitution Unicode invalide.");
                        codePoint = 0x10000U + ((codePoint - 0xD800U) << 10U) + (low - 0xDC00U);
                    } else if (codePoint >= 0xDC00U && codePoint <= 0xDFFFU) {
                        return fail("Paire de substitution Unicode invalide.");
                    }
                    appendUtf8(out, codePoint);
                    break;
                }
                default: return fail("Échappement JSON non pris en charge.");
            }
        }
        return fail("Chaîne JSON non terminée.");
    }

    std::string_view input_;
    std::size_t position_{0};
    std::string error_;
};

void writeEscapedString(std::ostream& out, std::string_view value) {
    out << '"';
    for (const char c : value) {
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20U) {
                    out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(static_cast<unsigned char>(c)) << std::dec << std::setfill(' ');
                } else {
                    out << c;
                }
        }
    }
    out << '"';
}

void writeNumber(std::ostream& out, float value) {
    std::ostringstream buffer;
    buffer << std::setprecision(9) << value;
    out << buffer.str();
}

void writeVec3(std::ostream& out, const Vec3& value) {
    out << '[';
    writeNumber(out, value.x);
    out << ", ";
    writeNumber(out, value.y);
    out << ", ";
    writeNumber(out, value.z);
    out << ']';
}

bool readVec3(const JsonValue& owner, std::string_view key, Vec3& target, std::string& error) {
    const auto* node = owner.member(key);
    if (!node || node->type != JsonValue::Type::Array || node->items.size() != 3) {
        error = "Transform invalide : " + std::string(key) + " doit contenir trois nombres.";
        return false;
    }
    float values[3] = {0.0F, 0.0F, 0.0F};
    for (std::size_t index = 0; index < 3; ++index) {
        const auto& item = node->items[index];
        if (item.type != JsonValue::Type::Number || !std::isfinite(item.number) || std::abs(item.number) > 1'000'000.0) {
            error = "Transform invalide : " + std::string(key) + " contient une valeur hors limites.";
            return false;
        }
        values[index] = static_cast<float>(item.number);
    }
    target = {values[0], values[1], values[2]};
    return true;
}

bool readNumberField(const JsonValue& owner, std::string_view key, float& target, float minimum,
                     float maximum, bool required, std::string& error) {
    const auto* node = owner.member(key);
    if (!node) {
        if (required) {
            error = "Champ obligatoire manquant : " + std::string(key) + ".";
            return false;
        }
        return true;
    }
    if (node->type != JsonValue::Type::Number || !std::isfinite(node->number) ||
        node->number < static_cast<double>(minimum) || node->number > static_cast<double>(maximum)) {
        error = "Valeur hors limites pour " + std::string(key) + ".";
        return false;
    }
    target = static_cast<float>(node->number);
    return true;
}

std::string asciiLower(std::string_view value) {
    std::string result(value);
    for (char& c : result) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return result;
}

bool entityMentions(const Entity& entity, std::string_view token) {
    const std::string needle = asciiLower(token);
    for (const auto& component : entity.components) {
        if (asciiLower(component).find(needle) != std::string::npos) return true;
    }
    return asciiLower(entity.name).find(needle) != std::string::npos;
}

float idHash(std::string_view value) {
    std::uint32_t hash = 2166136261U;
    for (const char c : value) {
        hash ^= static_cast<std::uint32_t>(static_cast<unsigned char>(c));
        hash *= 16777619U;
    }
    return static_cast<float>(hash & 0xFFFFFFU) / static_cast<float>(0xFFFFFFU);
}

bool parseMaterial(const JsonValue& node, Material& material, std::string& error) {
    if (node.type != JsonValue::Type::Object) {
        error = "Le matériau doit être un objet JSON.";
        return false;
    }
    if (const auto* albedo = node.member("albedo")) {
        if (albedo->type != JsonValue::Type::Array || albedo->items.size() != 3) {
            error = "Matériau invalide : albedo doit contenir trois nombres.";
            return false;
        }
        float values[3] = {material.albedo.x, material.albedo.y, material.albedo.z};
        for (std::size_t index = 0; index < 3; ++index) {
            const auto& item = albedo->items[index];
            if (item.type != JsonValue::Type::Number || !std::isfinite(item.number) ||
                item.number < 0.0 || item.number > 1.0) {
                error = "Matériau invalide : albedo doit rester entre 0 et 1.";
                return false;
            }
            values[index] = static_cast<float>(item.number);
        }
        material.albedo = {values[0], values[1], values[2]};
    }
    if (!readNumberField(node, "metallic", material.metallic, 0.0F, 1.0F, false, error)) return false;
    if (!readNumberField(node, "roughness", material.roughness, 0.04F, 1.0F, false, error)) return false;
    if (!readNumberField(node, "tiling", material.tiling, 1.0F, 64.0F, false, error)) return false;
    if (const auto* pattern = node.member("pattern")) {
        if (pattern->type != JsonValue::Type::String || !parseSurfacePattern(pattern->text, material.pattern)) {
            error = "Motif de surface non pris en charge (none, checker, grid).";
            return false;
        }
    }
    if (const auto* emissive = node.member("emissive")) {
        if (emissive->type != JsonValue::Type::Bool) {
            error = "Matériau invalide : emissive doit être un booléen.";
            return false;
        }
        material.emissive = emissive->boolean;
    }
    if (const auto* texture = node.member("texture")) {
        if (texture->type == JsonValue::Type::Null) {
            material.texture.clear();
        } else if (texture->type == JsonValue::Type::String && isValidTexturePath(texture->text)) {
            material.texture = texture->text;
        } else {
            error = "Matériau invalide : texture doit être un chemin PNG/JPEG relatif.";
            return false;
        }
    }
    if (!isValidMaterial(material)) {
        error = "Matériau hors limites : albedo [0,1], metallic [0,1], roughness [0.04,1], tiling [1,64].";
        return false;
    }
    return true;
}

bool readBoolField(const JsonValue& owner, std::string_view key, bool& target, bool required, std::string& error) {
    const auto* node = owner.member(key);
    if (!node) {
        if (required) {
            error = "Champ obligatoire manquant : " + std::string(key) + ".";
            return false;
        }
        return true;
    }
    if (node->type != JsonValue::Type::Bool) {
        error = "Champ booléen invalide : " + std::string(key) + ".";
        return false;
    }
    target = node->boolean;
    return true;
}

bool parseLight(const JsonValue& node, Light& light, std::string& error) {
    if (node.type != JsonValue::Type::Object) {
        error = "La lumière doit être un objet JSON.";
        return false;
    }
    if (const auto* type = node.member("type")) {
        if (type->type != JsonValue::Type::String || !parseLightType(type->text, light.type)) {
            error = "Type de lumière non pris en charge (directional, point, spot).";
            return false;
        }
    }
    if (const auto* color = node.member("color")) {
        if (color->type != JsonValue::Type::Array || color->items.size() != 3) {
            error = "Lumière invalide : color doit contenir trois nombres.";
            return false;
        }
        float values[3] = {light.color.x, light.color.y, light.color.z};
        for (std::size_t index = 0; index < 3; ++index) {
            const auto& item = color->items[index];
            if (item.type != JsonValue::Type::Number || !std::isfinite(item.number) ||
                item.number < 0.0 || item.number > 1.0) {
                error = "Lumière invalide : color doit rester entre 0 et 1.";
                return false;
            }
            values[index] = static_cast<float>(item.number);
        }
        light.color = {values[0], values[1], values[2]};
    }
    if (!readNumberField(node, "intensity", light.intensity, 0.0F, 32.0F, false, error)) return false;
    if (!readNumberField(node, "range", light.range, 0.1F, 200.0F, false, error)) return false;
    if (!readNumberField(node, "spotAngle", light.spotAngle, 1.0F, 89.0F, false, error)) return false;
    if (!readBoolField(node, "castShadow", light.castShadow, false, error)) return false;
    if (!isValidLight(light)) {
        error = "Lumière hors limites (intensity [0,32], range [0.1,200], spotAngle [1,89]).";
        return false;
    }
    return true;
}

bool parseRigidbody(const JsonValue& node, Rigidbody& body, std::string& error) {
    if (node.type != JsonValue::Type::Object) {
        error = "Rigidbody doit être un objet JSON.";
        return false;
    }
    if (const auto* velocity = node.member("velocity")) {
        if (velocity->type != JsonValue::Type::Null && !readVec3(node, "velocity", body.velocity, error)) return false;
    }
    if (!readNumberField(node, "mass", body.mass, 0.01F, 10'000.0F, false, error)) return false;
    if (!readNumberField(node, "bounciness", body.bounciness, 0.0F, 1.0F, false, error)) return false;
    if (!readBoolField(node, "gravity", body.gravity, false, error)) return false;
    return true;
}

bool parseController(const JsonValue& node, Controller& controller, std::string& error) {
    if (node.type != JsonValue::Type::Object) {
        error = "Controller doit être un objet JSON.";
        return false;
    }
    if (!readNumberField(node, "speed", controller.speed, 0.1F, 60.0F, false, error)) return false;
    if (!readNumberField(node, "jumpSpeed", controller.jumpSpeed, 0.0F, 40.0F, false, error)) return false;
    return true;
}

bool parseSpinner(const JsonValue& node, Spinner& spinner, std::string& error) {
    if (node.type != JsonValue::Type::Object) {
        error = "Spinner doit être un objet JSON.";
        return false;
    }
    if (const auto* axis = node.member("axis")) {
        if (axis->type == JsonValue::Type::String) {
            const std::string value = asciiLower(axis->text);
            if (value == "x") spinner.axis = {1, 0, 0};
            else if (value == "y") spinner.axis = {0, 1, 0};
            else if (value == "z") spinner.axis = {0, 0, 1};
            else { error = "Axe de rotation non pris en charge (x, y, z)."; return false; }
        } else if (axis->type == JsonValue::Type::Array) {
            if (!readVec3(node, "axis", spinner.axis, error)) return false;
        } else {
            error = "Axe de rotation invalide.";
            return false;
        }
    }
    if (!readNumberField(node, "degreesPerSecond", spinner.degreesPerSecond, -1440.0F, 1440.0F, false, error)) return false;
    return true;
}

bool parseCollectible(const JsonValue& node, Collectible& collectible, std::string& error) {
    if (node.type != JsonValue::Type::Object) {
        error = "Collectible doit être un objet JSON.";
        return false;
    }
    if (!readNumberField(node, "radius", collectible.radius, 0.1F, 50.0F, false, error)) return false;
    if (const auto* value = node.member("value")) {
        if (value->type != JsonValue::Type::Number || !std::isfinite(value->number) ||
            value->number < 1.0 || value->number > 1000.0 || std::floor(value->number) != value->number) {
            error = "Valeur de collectible invalide (entier entre 1 et 1000).";
            return false;
        }
        collectible.value = static_cast<int>(value->number);
    }
    return true;
}

bool readStringField(const JsonValue& owner, std::string_view key, std::string& target, std::size_t maxLength, bool required, std::string& error) {
    const auto* node = owner.member(key);
    if (!node) {
        if (required) {
            error = "Champ obligatoire manquant : " + std::string(key) + ".";
            return false;
        }
        return true;
    }
    if (node->type != JsonValue::Type::String || node->text.size() > maxLength) {
        error = "Champ texte invalide : " + std::string(key) + ".";
        return false;
    }
    target = node->text;
    return true;
}

bool parseSceneEntity(const JsonValue& node, Entity& entity, std::string& error) {
    if (node.type != JsonValue::Type::Object) {
        error = "Chaque entité doit être un objet JSON.";
        return false;
    }
    if (!readStringField(node, "id", entity.id, 80, true, error)) return false;
    if (entity.id.empty()) {
        error = "Chaque entité doit avoir un identifiant.";
        return false;
    }
    if (!readStringField(node, "name", entity.name, 100, true, error)) return false;
    if (entity.name.empty()) {
        error = "Chaque entité doit avoir un nom.";
        return false;
    }
    if (!readStringField(node, "type", entity.type, 24, true, error)) return false;
    if (!isKnownType(entity.type)) {
        error = "Type d'entité non pris en charge : " + entity.type + ".";
        return false;
    }
    if (!readVec3(node, "position", entity.transform.position, error)) return false;
    if (!readVec3(node, "rotation", entity.transform.rotationDegrees, error)) return false;
    if (!readVec3(node, "scale", entity.transform.scale, error)) return false;
    if (!isValidTransform(entity.transform)) {
        error = "Transform invalide pour " + entity.name + " (échelle non nulle attendue).";
        return false;
    }
    if (const auto* visible = node.member("visible")) {
        if (visible->type != JsonValue::Type::Bool) {
            error = "Visibilité invalide pour " + entity.name + ".";
            return false;
        }
        entity.visible = visible->boolean;
    }
    if (const auto* components = node.member("components")) {
        if (components->type != JsonValue::Type::Array || components->items.size() > kMaxComponents) {
            error = "Composants invalides pour " + entity.name + ".";
            return false;
        }
        for (const auto& component : components->items) {
            if (component.type != JsonValue::Type::String || component.text.size() > 80) {
                error = "Composant invalide pour " + entity.name + ".";
                return false;
            }
            entity.components.push_back(component.text);
        }
    }
    if (const auto* material = node.member("material")) {
        if (material->type != JsonValue::Type::Null) {
            Material parsed;
            if (!parseMaterial(*material, parsed, error)) return false;
            entity.material = parsed;
        }
    }
    if (const auto* primitive = node.member("primitive")) {
        if (primitive->type == JsonValue::Type::Null) {
            entity.primitiveExplicit = false;
        } else if (primitive->type == JsonValue::Type::String && parsePrimitive(primitive->text, entity.primitive)) {
            entity.primitiveExplicit = true;
        } else {
            error = "Primitive non prise en charge (cube, sphere, plane, cylinder, cone, torus, capsule, pyramid).";
            return false;
        }
    }
    if (const auto* light = node.member("light")) {
        if (light->type != JsonValue::Type::Null) {
            Light parsed;
            if (!parseLight(*light, parsed, error)) return false;
            entity.light = parsed;
        }
    }
    if (const auto* body = node.member("rigidbody")) {
        if (body->type != JsonValue::Type::Null) {
            Rigidbody parsed;
            if (!parseRigidbody(*body, parsed, error)) return false;
            entity.rigidbody = parsed;
        }
    }
    if (const auto* controller = node.member("controller")) {
        if (controller->type != JsonValue::Type::Null) {
            Controller parsed;
            if (!parseController(*controller, parsed, error)) return false;
            entity.controller = parsed;
        }
    }
    if (const auto* spinner = node.member("spinner")) {
        if (spinner->type != JsonValue::Type::Null) {
            Spinner parsed;
            if (!parseSpinner(*spinner, parsed, error)) return false;
            entity.spinner = parsed;
        }
    }
    if (const auto* collectible = node.member("collectible")) {
        if (collectible->type != JsonValue::Type::Null) {
            Collectible parsed;
            if (!parseCollectible(*collectible, parsed, error)) return false;
            entity.collectible = parsed;
        }
    }
    if (const auto* parent = node.member("parentId")) {
        if (parent->type == JsonValue::Type::Null) {
            entity.parentId = std::nullopt;
        } else if (parent->type == JsonValue::Type::String && parent->text.size() <= 80 && !parent->text.empty()) {
            entity.parentId = parent->text;
        } else {
            error = "Parent invalide pour " + entity.name + ".";
            return false;
        }
    }
    return true;
}
}  // namespace

const char* surfacePatternName(SurfacePattern pattern) noexcept {
    switch (pattern) {
        case SurfacePattern::Checker: return "checker";
        case SurfacePattern::Grid: return "grid";
        case SurfacePattern::None: return "none";
    }
    return "none";
}

bool parseSurfacePattern(std::string_view name, SurfacePattern& pattern) noexcept {
    if (name == "none") {
        pattern = SurfacePattern::None;
        return true;
    }
    if (name == "checker") {
        pattern = SurfacePattern::Checker;
        return true;
    }
    if (name == "grid") {
        pattern = SurfacePattern::Grid;
        return true;
    }
    return false;
}

const char* primitiveName(Primitive primitive) noexcept {
    switch (primitive) {
        case Primitive::Cube: return "cube";
        case Primitive::Sphere: return "sphere";
        case Primitive::Plane: return "plane";
        case Primitive::Cylinder: return "cylinder";
        case Primitive::Cone: return "cone";
        case Primitive::Torus: return "torus";
        case Primitive::Capsule: return "capsule";
        case Primitive::Pyramid: return "pyramid";
    }
    return "cube";
}

bool parsePrimitive(std::string_view name, Primitive& primitive) noexcept {
    const std::string value = asciiLower(name);
    if (value == "cube" || value == "box") { primitive = Primitive::Cube; return true; }
    if (value == "sphere") { primitive = Primitive::Sphere; return true; }
    if (value == "plane" || value == "quad") { primitive = Primitive::Plane; return true; }
    if (value == "cylinder") { primitive = Primitive::Cylinder; return true; }
    if (value == "cone") { primitive = Primitive::Cone; return true; }
    if (value == "torus" || value == "donut") { primitive = Primitive::Torus; return true; }
    if (value == "capsule") { primitive = Primitive::Capsule; return true; }
    if (value == "pyramid") { primitive = Primitive::Pyramid; return true; }
    return false;
}

const char* lightTypeName(LightType type) noexcept {
    switch (type) {
        case LightType::Directional: return "directional";
        case LightType::Point: return "point";
        case LightType::Spot: return "spot";
    }
    return "directional";
}

bool parseLightType(std::string_view name, LightType& type) noexcept {
    if (name == "directional" || name == "sun") { type = LightType::Directional; return true; }
    if (name == "point" || name == "omni") { type = LightType::Point; return true; }
    if (name == "spot" || name == "spotlight") { type = LightType::Spot; return true; }
    return false;
}

Material defaultMaterialFor(const Entity& entity) noexcept {
    Material material;
    material.roughness = 0.42F;
    material.metallic = 0.05F;
    if (entity.type == "Prefab") {
        material.albedo = {0.22F, 0.78F, 0.68F};
    } else if (entity.type == "Camera") {
        material.albedo = {0.42F, 0.82F, 1.0F};
    } else if (entity.type == "Light") {
        material.albedo = {1.0F, 0.76F, 0.38F};
        material.emissive = true;
    } else if (entity.type == "Audio") {
        material.albedo = {0.62F, 0.70F, 0.80F};
    } else if (entity.type == "Empty") {
        material.albedo = {0.50F, 0.58F, 0.70F};
    } else if (entityMentions(entity, "plane")) {
        material.albedo = {0.30F, 0.42F, 0.60F};
    } else {
        static const Vec3 palette[] = {
            {0.42F, 0.55F, 1.00F},  // Nova blue
            {0.58F, 0.42F, 1.00F},  // violet
            {0.24F, 0.76F, 0.95F},  // cyan
            {0.35F, 0.86F, 0.66F},  // teal
            {1.00F, 0.66F, 0.34F},  // amber
            {0.93F, 0.48F, 0.86F},  // magenta
        };
        const auto index = static_cast<std::size_t>(idHash(entity.id) * 5.999F);
        material.albedo = palette[std::min<std::size_t>(index, 5)];
    }
    return material;
}

Primitive primitiveFor(const Entity& entity) noexcept {
    if (entity.primitiveExplicit) return entity.primitive;
    std::string text = asciiLower(entity.name);
    for (const auto& component : entity.components) {
        text += ' ';
        text += asciiLower(component);
    }
    if (text.find("torus") != std::string::npos || text.find("donut") != std::string::npos) return Primitive::Torus;
    if (text.find("capsule") != std::string::npos) return Primitive::Capsule;
    if (text.find("pyramid") != std::string::npos) return Primitive::Pyramid;
    if (text.find("sphere") != std::string::npos) return Primitive::Sphere;
    if (text.find("plane") != std::string::npos || text.find("ground") != std::string::npos) return Primitive::Plane;
    if (text.find("cylinder") != std::string::npos) return Primitive::Cylinder;
    if (text.find("cone") != std::string::npos) return Primitive::Cone;
    return Primitive::Cube;
}

bool isValidMaterial(const Material& material) noexcept {
    const auto channel = [](float value) {
        return std::isfinite(value) && value >= 0.0F && value <= 1.0F;
    };
    if (!channel(material.albedo.x) || !channel(material.albedo.y) || !channel(material.albedo.z)) return false;
    if (!channel(material.metallic)) return false;
    if (!std::isfinite(material.roughness) || material.roughness < 0.04F || material.roughness > 1.0F) return false;
    if (!std::isfinite(material.tiling) || material.tiling < 1.0F || material.tiling > 64.0F) return false;
    if (!material.texture.empty() && !isValidTexturePath(material.texture)) return false;
    return true;
}

bool isValidTexturePath(std::string_view path) noexcept {
    if (path.empty()) return true;
    if (path.size() > 160) return false;
    if (path.find("..") != std::string_view::npos) return false;
    if (path.front() == '/' || path.front() == '\\' || path.find(':') != std::string_view::npos) return false;
    for (const char c : path) {
        const bool safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                          c == '.' || c == '_' || c == '-' || c == '/';
        if (!safe) return false;
    }
    std::size_t dot = path.find_last_of('.');
    if (dot == std::string_view::npos) return false;
    const std::string extension = asciiLower(path.substr(dot + 1));
    return extension == "png" || extension == "jpg" || extension == "jpeg";
}

bool isValidLight(const Light& light) noexcept {
    const auto channel = [](float value) { return std::isfinite(value) && value >= 0.0F && value <= 1.0F; };
    if (!channel(light.color.x) || !channel(light.color.y) || !channel(light.color.z)) return false;
    if (!std::isfinite(light.intensity) || light.intensity < 0.0F || light.intensity > 32.0F) return false;
    if (!std::isfinite(light.range) || light.range < 0.1F || light.range > 200.0F) return false;
    if (!std::isfinite(light.spotAngle) || light.spotAngle < 1.0F || light.spotAngle > 89.0F) return false;
    return true;
}

EngineInfo info() noexcept { return {"Nova Engine", "0.8.0", 6}; }
bool isSupportedApiVersion(int version) noexcept { return version >= 1 && version <= 6; }

std::string Scene::createEntity(std::string name, std::string type) {
    if (name.empty()) name = "Entity";
    if (type.empty()) type = "Empty";
    std::string id;
    do {
        id = "entity-" + std::to_string(nextId_++);
    } while (findEntity(id) != nullptr);
    entities_.push_back(Entity{id, std::nullopt, std::move(name), std::move(type), Transform{}, true, {}});
    return id;
}

bool Scene::insertEntity(Entity entity) {
    if (entity.id.empty() || findEntity(entity.id) != nullptr) return false;
    if (entity.id.rfind("entity-", 0) == 0) {
        const std::string suffix = entity.id.substr(7);
        char* end = nullptr;
        const unsigned long long value = std::strtoull(suffix.c_str(), &end, 10);
        if (end != suffix.c_str() && *end == '\0' && value >= nextId_) nextId_ = value + 1;
    }
    entities_.push_back(std::move(entity));
    return true;
}

bool Scene::duplicateEntity(const std::string& id, std::optional<std::string> newName) {
    const auto* source = findEntity(id);
    if (!source) return false;
    Entity copy = *source;
    const std::string baseName = newName && !newName->empty() ? *newName : source->name + " Copy";
    copy.name = baseName.size() > 100 ? baseName.substr(0, 100) : baseName;
    copy.id.clear();
    do {
        copy.id = "entity-" + std::to_string(nextId_++);
    } while (findEntity(copy.id) != nullptr);
    copy.transform.position.x += 1.0F;
    entities_.push_back(std::move(copy));
    return true;
}

bool Scene::renameEntity(const std::string& id, std::string name) {
    auto* entity = findEntity(id);
    if (!entity || name.empty() || name.size() > 100) return false;
    entity->name = std::move(name);
    return true;
}

bool Scene::removeEntity(const std::string& id) {
    const auto it = std::find_if(entities_.begin(), entities_.end(), [&id](const Entity& entity) { return entity.id == id; });
    if (it == entities_.end()) return false;
    for (auto& entity : entities_) {
        if (entity.parentId && *entity.parentId == id) entity.parentId = std::nullopt;
    }
    entities_.erase(it);
    return true;
}

Entity* Scene::findEntity(const std::string& id) noexcept {
    const auto it = std::find_if(entities_.begin(), entities_.end(), [&id](const Entity& entity) { return entity.id == id; });
    return it == entities_.end() ? nullptr : &*it;
}

const Entity* Scene::findEntity(const std::string& id) const noexcept {
    const auto it = std::find_if(entities_.begin(), entities_.end(), [&id](const Entity& entity) { return entity.id == id; });
    return it == entities_.end() ? nullptr : &*it;
}

std::vector<Entity>& Scene::entities() noexcept { return entities_; }
const std::vector<Entity>& Scene::entities() const noexcept { return entities_; }
std::size_t Scene::visibleEntityCount() const noexcept {
    return static_cast<std::size_t>(std::count_if(entities_.begin(), entities_.end(), [](const Entity& entity) { return entity.visible; }));
}

bool Scene::setParent(const std::string& childId, std::optional<std::string> parentId) noexcept {
    auto* child = findEntity(childId);
    if (!child || (parentId && (!findEntity(*parentId) || *parentId == childId))) return false;
    for (auto current = parentId; current; ) {
        if (*current == childId) return false;
        const auto* entity = findEntity(*current);
        current = entity ? entity->parentId : std::nullopt;
    }
    child->parentId = std::move(parentId);
    return true;
}

Transform combineTransforms(const Transform& parent, const Transform& local) noexcept {
    return {{parent.position.x + local.position.x * parent.scale.x, parent.position.y + local.position.y * parent.scale.y, parent.position.z + local.position.z * parent.scale.z},
            {parent.rotationDegrees.x + local.rotationDegrees.x, parent.rotationDegrees.y + local.rotationDegrees.y, parent.rotationDegrees.z + local.rotationDegrees.z},
            {parent.scale.x * local.scale.x, parent.scale.y * local.scale.y, parent.scale.z * local.scale.z}};
}

std::optional<Transform> Scene::worldTransform(const std::string& id) const noexcept {
    const auto* entity = findEntity(id);
    if (!entity || !isValidTransform(entity->transform)) return std::nullopt;
    Transform result = entity->transform;
    for (auto parentId = entity->parentId; parentId; ) {
        const auto* parent = findEntity(*parentId);
        if (!parent || !isValidTransform(parent->transform)) return std::nullopt;
        result = combineTransforms(parent->transform, result);
        parentId = parent->parentId;
    }
    return result;
}

const std::string& Scene::name() const noexcept { return name_; }
void Scene::setName(std::string name) { name_ = std::move(name); }
const std::optional<std::string>& Scene::updatedAt() const noexcept { return updatedAt_; }
void Scene::setUpdatedAt(std::optional<std::string> value) { updatedAt_ = std::move(value); }
void Scene::clear() noexcept {
    entities_.clear();
    nextId_ = 1;
    updatedAt_.reset();
}

namespace {
struct SimBox {
    Vec3 min{};
    Vec3 max{};
    bool valid{false};
};

SimBox boxFor(const Scene& scene, const Entity& entity) {
    SimBox box;
    const auto world = scene.worldTransform(entity.id);
    if (!world) return box;
    const Vec3& position = world->position;
    const Vec3& scale = world->scale;
    const Primitive primitive = primitiveFor(entity);
    float halfY = std::abs(scale.y) * 0.5F;
    if (primitive == Primitive::Plane) halfY = 0.005F;
    box.min = {position.x - std::abs(scale.x) * 0.5F, position.y - halfY, position.z - std::abs(scale.z) * 0.5F};
    box.max = {position.x + std::abs(scale.x) * 0.5F, position.y + halfY, position.z + std::abs(scale.z) * 0.5F};
    box.valid = true;
    return box;
}

bool overlapsXz(const SimBox& a, const SimBox& b, float padding) noexcept {
    return a.min.x <= b.max.x + padding && a.max.x >= b.min.x - padding &&
           a.min.z <= b.max.z + padding && a.max.z >= b.min.z - padding;
}

bool isSolidMesh(const Entity& entity) noexcept {
    if (!entity.visible) return false;
    if (entity.type != "Mesh" && entity.type != "Prefab") return false;
    if (entity.collectible) return false;
    return true;
}

Vec3 inputDirection(float yawDegrees, float forward, float right) noexcept {
    constexpr float pi = 3.14159265358979323846F;
    const float yaw = yawDegrees * pi / 180.0F;
    const Vec3 front{-std::sin(yaw), 0.0F, -std::cos(yaw)};
    const Vec3 side{std::cos(yaw), 0.0F, -std::sin(yaw)};
    Vec3 result{front.x * forward + side.x * right, 0.0F, front.z * forward + side.z * right};
    const float len = std::sqrt(result.x * result.x + result.z * result.z);
    if (len > 1.0F) {
        result.x /= len;
        result.z /= len;
    }
    return result;
}
}  // namespace

void Runtime::initialize() noexcept { initialized_ = true; stats_ = {}; playStats_ = {}; bodies_.clear(); }
void Runtime::shutdown() noexcept { initialized_ = false; stopPlay(); }
bool Runtime::initialized() const noexcept { return initialized_; }
FrameStats Runtime::tick(double deltaSeconds, const Scene& scene) noexcept {
    if (!initialized_) return stats_;
    ++stats_.frameNumber;
    stats_.deltaSeconds = std::isfinite(deltaSeconds) ? std::clamp(deltaSeconds, 0.0, 0.25) : 0.0;
    stats_.visibleEntities = scene.visibleEntityCount();
    return stats_;
}
const FrameStats& Runtime::stats() const noexcept { return stats_; }

bool Runtime::startPlay(const Scene& scene) {
    playStats_ = PlayStats{};
    playStats_.active = true;
    bodies_.clear();
    jumpLatch_ = false;
    playerEyeHeight_ = 1.6F;
    for (const auto& entity : scene.entities()) {
        if (entity.collectible && entity.visible) ++playStats_.totalCollectibles;
        if (entity.controller) {
            ++playStats_.players;
            yaw_ = entity.transform.rotationDegrees.y;
            pitch_ = entity.transform.rotationDegrees.x;
            playStats_.playerPosition = entity.transform.position;
        }
        if (entity.rigidbody) {
            BodyState state;
            state.id = entity.id;
            state.velocityY = entity.rigidbody->velocity.y;
            bodies_.push_back(std::move(state));
        }
    }
    return playStats_.players > 0;
}

void Runtime::stopPlay() noexcept {
    playStats_.active = false;
    bodies_.clear();
    jumpLatch_ = false;
}

bool Runtime::playing() const noexcept { return playStats_.active; }

Runtime::BodyState* Runtime::body(const std::string& id) noexcept {
    const auto it = std::find_if(bodies_.begin(), bodies_.end(), [&id](const BodyState& state) { return state.id == id; });
    return it == bodies_.end() ? nullptr : &*it;
}

void Runtime::play(Scene& scene, const PlayInput& input, double deltaSeconds) {
    if (!playStats_.active) return;
    const float dt = static_cast<float>(std::isfinite(deltaSeconds) ? std::clamp(deltaSeconds, 0.0, 0.1) : 0.0);
    if (dt <= 0.0F) return;

    yaw_ += input.lookYaw;
    pitch_ = std::clamp(pitch_ + input.lookPitch, -89.0F, 89.0F);

    Entity* player = nullptr;
    for (auto& entity : scene.entities()) {
        if (entity.controller.has_value()) {
            player = &entity;
            break;
        }
    }

    const int steps = std::clamp(static_cast<int>(std::ceil(dt / 0.02F)), 1, 5);
    const float step = dt / static_cast<float>(steps);

    std::vector<SimBox> solids;
    for (const auto& entity : scene.entities()) {
        if (isSolidMesh(entity)) {
            const SimBox box = boxFor(scene, entity);
            if (box.valid) solids.push_back(box);
        }
    }

    for (int iteration = 0; iteration < steps; ++iteration) {
        // Character controller: horizontal move with axis-separated blocking,
        // gravity, jump and ground/box landing.
        if (player) {
            const Vec3 direction = inputDirection(yaw_, input.moveForward, input.moveRight);
            const float speed = player->controller->speed;
            const Vec3 feetBefore{player->transform.position.x,
                                  player->transform.position.y - playerEyeHeight_,
                                  player->transform.position.z};

            float targetX = feetBefore.x + direction.x * speed * step;
            float targetZ = feetBefore.z + direction.z * speed * step;
            for (const auto& solid : solids) {
                if (feetBefore.y + 1.7F <= solid.min.y || feetBefore.y >= solid.max.y) continue;
                if (targetX + 0.35F > solid.min.x - 0.001F && targetX - 0.35F < solid.max.x + 0.001F &&
                    feetBefore.z + 0.35F > solid.min.z && feetBefore.z - 0.35F < solid.max.z) {
                    targetX = direction.x > 0.0F ? solid.min.x - 0.351F : solid.max.x + 0.351F;
                }
            }
            for (const auto& solid : solids) {
                if (feetBefore.y + 1.7F <= solid.min.y || feetBefore.y >= solid.max.y) continue;
                if (targetZ + 0.35F > solid.min.z - 0.001F && targetZ - 0.35F < solid.max.z + 0.001F &&
                    targetX + 0.35F > solid.min.x && targetX - 0.35F < solid.max.x) {
                    targetZ = direction.z > 0.0F ? solid.min.z - 0.351F : solid.max.z + 0.351F;
                }
            }

            BodyState* state = body(player->id);
            if (!state) {
                bodies_.push_back({player->id, 0.0F, true});
                state = &bodies_.back();
            }
            if (input.jump && !jumpLatch_ && state->grounded) {
                state->velocityY = player->controller->jumpSpeed;
                state->grounded = false;
            }
            jumpLatch_ = input.jump;

            state->velocityY -= 9.81F * step;
            float feet = feetBefore.y + state->velocityY * step;

            float groundLevel = 0.0F;
            for (const auto& solid : solids) {
                const bool above = targetX + 0.35F > solid.min.x && targetX - 0.35F < solid.max.x &&
                                   targetZ + 0.35F > solid.min.z && targetZ - 0.35F < solid.max.z;
                if (!above) continue;
                const float top = solid.max.y;
                if (feetBefore.y >= top - 0.2F && feet <= top + 0.02F && top > groundLevel) {
                    groundLevel = top;
                }
            }
            if (feet <= groundLevel + 0.001F && state->velocityY <= 0.0F) {
                feet = groundLevel;
                state->velocityY = 0.0F;
                state->grounded = true;
            } else {
                state->grounded = false;
            }
            player->transform.position = {targetX, feet + playerEyeHeight_, targetZ};
            player->transform.rotationDegrees = {pitch_, yaw_, 0.0F};
            playStats_.playerGrounded = state->grounded;
            playStats_.playerPosition = player->transform.position;
        }

        // Rigidbodies: gravity, ground/box landing and bounciness.
        for (auto& entity : scene.entities()) {
            if (!entity.rigidbody || !entity.visible) continue;
            BodyState* state = body(entity.id);
            if (!state) {
                bodies_.push_back({entity.id, entity.rigidbody->velocity.y, false});
                state = &bodies_.back();
            }
            if (entity.rigidbody->gravity) state->velocityY -= 9.81F * step;
            float centerY = entity.transform.position.y + state->velocityY * step;
            const SimBox box = boxFor(scene, entity);
            const float halfY = std::max(0.01F, (box.max.y - box.min.y) * 0.5F);
            float bottom = centerY - halfY;
            float groundLevel = 0.0F;
            for (const auto& solid : solids) {
                if (!overlapsXz(box, solid, 0.0F)) continue;
                if (bottom >= solid.max.y - 0.2F && solid.max.y > groundLevel) groundLevel = solid.max.y;
            }
            if (bottom <= groundLevel + 0.001F && state->velocityY <= 0.0F) {
                centerY = groundLevel + halfY;
                if (std::abs(state->velocityY) > 0.8F) {
                    state->velocityY = -state->velocityY * entity.rigidbody->bounciness;
                } else {
                    state->velocityY = 0.0F;
                    state->grounded = true;
                }
            }
            entity.transform.position.y = centerY;
        }

        for (auto& entity : scene.entities()) {
            if (!entity.spinner) continue;
            const Vec3 axis = entity.spinner->axis;
            const float lengthAxis = std::sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
            if (lengthAxis < 1.0e-5F) continue;
            const float angle = entity.spinner->degreesPerSecond * step;
            entity.transform.rotationDegrees.x += axis.x / lengthAxis * angle;
            entity.transform.rotationDegrees.y += axis.y / lengthAxis * angle;
            entity.transform.rotationDegrees.z += axis.z / lengthAxis * angle;
        }

        // Collectibles are triggers: touching one hides it and adds its value.
        for (auto& entity : scene.entities()) {
            if (!entity.collectible || !entity.visible) continue;
            if (!player) continue;
            const Vec3 delta{entity.transform.position.x - player->transform.position.x,
                             entity.transform.position.y - player->transform.position.y,
                             entity.transform.position.z - player->transform.position.z};
            const float radius = entity.collectible->radius;
            if (delta.x * delta.x + delta.y * delta.y + delta.z * delta.z <= radius * radius) {
                entity.visible = false;
                playStats_.score += entity.collectible->value;
                ++playStats_.collected;
            }
        }
    }
}

const PlayStats& Runtime::playStats() const noexcept { return playStats_; }

bool isValidTransform(const Transform& t) noexcept {
    const auto finiteVec = [](const Vec3& v) { return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z); };
    if (!finiteVec(t.position) || !finiteVec(t.rotationDegrees) || !finiteVec(t.scale)) return false;
    constexpr float maxMagnitude = 1'000'000.0F;
    const auto bounded = [maxMagnitude](const Vec3& v) { return std::abs(v.x) <= maxMagnitude && std::abs(v.y) <= maxMagnitude && std::abs(v.z) <= maxMagnitude; };
    return bounded(t.position) && bounded(t.rotationDegrees) && bounded(t.scale) && t.scale.x != 0.0F && t.scale.y != 0.0F && t.scale.z != 0.0F;
}

bool validateScene(const Scene& scene, std::string& error) {
    if (scene.name().empty() || scene.name().size() > 120) {
        error = "Le nom de scène doit contenir entre 1 et 120 caractères.";
        return false;
    }
    if (scene.entities().size() > kMaxEntities) {
        error = "Une scène ne peut pas dépasser 250 entités.";
        return false;
    }
    std::size_t lightCount = 0;
    for (const auto& entity : scene.entities()) {
        if (entity.id.empty() || entity.id.size() > 80) {
            error = "Identifiant d'entité invalide.";
            return false;
        }
        if (entity.name.empty() || entity.name.size() > 100) {
            error = "Nom d'entité invalide.";
            return false;
        }
        if (!isKnownType(entity.type)) {
            error = "Type d'entité non pris en charge : " + entity.type + ".";
            return false;
        }
        if (!isValidTransform(entity.transform)) {
            error = "Transform invalide pour " + entity.name + ".";
            return false;
        }
        if (entity.material && !isValidMaterial(*entity.material)) {
            error = "Matériau invalide pour " + entity.name + ".";
            return false;
        }
        if (entity.light) {
            if (!isValidLight(*entity.light)) {
                error = "Lumière invalide pour " + entity.name + ".";
                return false;
            }
            ++lightCount;
        }
        if (entity.rigidbody) {
            const auto& body = *entity.rigidbody;
            const auto finite = [](const Vec3& v) { return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z); };
            if (!finite(body.velocity) || !std::isfinite(body.mass) || body.mass < 0.01F || body.mass > 10'000.0F ||
                !std::isfinite(body.bounciness) || body.bounciness < 0.0F || body.bounciness > 1.0F) {
                error = "Rigidbody invalide pour " + entity.name + ".";
                return false;
            }
        }
        if (entity.controller) {
            if (!std::isfinite(entity.controller->speed) || entity.controller->speed < 0.1F ||
                entity.controller->speed > 60.0F || !std::isfinite(entity.controller->jumpSpeed) ||
                entity.controller->jumpSpeed < 0.0F || entity.controller->jumpSpeed > 40.0F) {
                error = "Controller invalide pour " + entity.name + ".";
                return false;
            }
        }
        if (entity.spinner) {
            const auto& axis = entity.spinner->axis;
            const bool finiteAxis = std::isfinite(axis.x) && std::isfinite(axis.y) && std::isfinite(axis.z);
            if (!finiteAxis || (std::abs(axis.x) + std::abs(axis.y) + std::abs(axis.z)) < 1.0e-4F ||
                !std::isfinite(entity.spinner->degreesPerSecond) ||
                std::abs(entity.spinner->degreesPerSecond) > 1440.0F) {
                error = "Spinner invalide pour " + entity.name + ".";
                return false;
            }
        }
        if (entity.collectible) {
            if (!std::isfinite(entity.collectible->radius) || entity.collectible->radius < 0.1F ||
                entity.collectible->radius > 50.0F || entity.collectible->value < 1 || entity.collectible->value > 1000) {
                error = "Collectible invalide pour " + entity.name + ".";
                return false;
            }
        }
        if (entity.components.size() > kMaxComponents) {
            error = "Trop de composants pour " + entity.name + ".";
            return false;
        }
        for (const auto& component : entity.components) {
            if (component.size() > 80) {
                error = "Composant trop long pour " + entity.name + ".";
                return false;
            }
        }
        if (entity.parentId) {
            if (*entity.parentId == entity.id || !scene.findEntity(*entity.parentId)) {
                error = "Parent introuvable pour " + entity.name + ".";
                return false;
            }
            std::vector<std::string> visited{entity.id};
            std::optional<std::string> current = entity.parentId;
            while (current) {
                if (std::find(visited.begin(), visited.end(), *current) != visited.end()) {
                    error = "La hiérarchie contient un cycle.";
                    return false;
                }
                visited.push_back(*current);
                const auto* parent = scene.findEntity(*current);
                current = parent ? parent->parentId : std::nullopt;
            }
        }
    }
    if (lightCount > 16) {
        error = "Une scène ne peut pas dépasser 16 lumières.";
        return false;
    }
    return true;
}

std::string sceneToJson(const Scene& scene) {
    std::ostringstream out;
    out << "{\n";
    out << "  \"schemaVersion\": 4,\n";
    out << "  \"name\": ";
    writeEscapedString(out, scene.name());
    out << ",\n  \"updatedAt\": ";
    if (scene.updatedAt()) {
        writeEscapedString(out, *scene.updatedAt());
    } else {
        out << "null";
    }
    out << ",\n  \"entities\": [";
    if (scene.entities().empty()) {
        out << "]\n";
    } else {
        out << '\n';
        const auto& entities = scene.entities();
        for (std::size_t index = 0; index < entities.size(); ++index) {
            const auto& entity = entities[index];
            out << "    {\n      \"id\": ";
            writeEscapedString(out, entity.id);
            out << ",\n      \"name\": ";
            writeEscapedString(out, entity.name);
            out << ",\n      \"type\": ";
            writeEscapedString(out, entity.type);
            out << ",\n      \"position\": ";
            writeVec3(out, entity.transform.position);
            out << ",\n      \"rotation\": ";
            writeVec3(out, entity.transform.rotationDegrees);
            out << ",\n      \"scale\": ";
            writeVec3(out, entity.transform.scale);
            out << ",\n      \"visible\": " << (entity.visible ? "true" : "false") << ",\n      \"components\": [";
            for (std::size_t componentIndex = 0; componentIndex < entity.components.size(); ++componentIndex) {
                if (componentIndex > 0) out << ", ";
                writeEscapedString(out, entity.components[componentIndex]);
            }
            out << "],\n      \"material\": ";
            if (entity.material) {
                out << "{\n        \"albedo\": ";
                writeVec3(out, entity.material->albedo);
                out << ",\n        \"metallic\": ";
                writeNumber(out, entity.material->metallic);
                out << ",\n        \"roughness\": ";
                writeNumber(out, entity.material->roughness);
                out << ",\n        \"tiling\": ";
                writeNumber(out, entity.material->tiling);
                out << ",\n        \"pattern\": ";
                writeEscapedString(out, surfacePatternName(entity.material->pattern));
                out << ",\n        \"emissive\": " << (entity.material->emissive ? "true" : "false");
                out << ",\n        \"texture\": ";
                writeEscapedString(out, entity.material->texture);
                out << "\n      }";
            } else {
                out << "null";
            }
            out << ",\n      \"primitive\": ";
            writeEscapedString(out, primitiveName(primitiveFor(entity)));
            out << ",\n      \"light\": ";
            if (entity.light) {
                out << "{\n        \"type\": ";
                writeEscapedString(out, lightTypeName(entity.light->type));
                out << ",\n        \"color\": ";
                writeVec3(out, entity.light->color);
                out << ",\n        \"intensity\": ";
                writeNumber(out, entity.light->intensity);
                out << ",\n        \"range\": ";
                writeNumber(out, entity.light->range);
                out << ",\n        \"spotAngle\": ";
                writeNumber(out, entity.light->spotAngle);
                out << ",\n        \"castShadow\": " << (entity.light->castShadow ? "true" : "false") << "\n      }";
            } else {
                out << "null";
            }
            out << ",\n      \"rigidbody\": ";
            if (entity.rigidbody) {
                out << "{\n        \"velocity\": ";
                writeVec3(out, entity.rigidbody->velocity);
                out << ",\n        \"mass\": ";
                writeNumber(out, entity.rigidbody->mass);
                out << ",\n        \"bounciness\": ";
                writeNumber(out, entity.rigidbody->bounciness);
                out << ",\n        \"gravity\": " << (entity.rigidbody->gravity ? "true" : "false") << "\n      }";
            } else {
                out << "null";
            }
            out << ",\n      \"controller\": ";
            if (entity.controller) {
                out << "{\n        \"speed\": ";
                writeNumber(out, entity.controller->speed);
                out << ",\n        \"jumpSpeed\": ";
                writeNumber(out, entity.controller->jumpSpeed);
                out << "\n      }";
            } else {
                out << "null";
            }
            out << ",\n      \"spinner\": ";
            if (entity.spinner) {
                out << "{\n        \"axis\": ";
                writeVec3(out, entity.spinner->axis);
                out << ",\n        \"degreesPerSecond\": ";
                writeNumber(out, entity.spinner->degreesPerSecond);
                out << "\n      }";
            } else {
                out << "null";
            }
            out << ",\n      \"collectible\": ";
            if (entity.collectible) {
                out << "{\n        \"radius\": ";
                writeNumber(out, entity.collectible->radius);
                out << ",\n        \"value\": " << entity.collectible->value << "\n      }";
            } else {
                out << "null";
            }
            out << ",\n      \"parentId\": ";
            if (entity.parentId) {
                writeEscapedString(out, *entity.parentId);
            } else {
                out << "null";
            }
            out << "\n    }" << (index + 1 < entities.size() ? "," : "") << '\n';
        }
        out << "  ]\n";
    }
    out << "}\n";
    return out.str();
}

bool sceneFromJson(std::string_view json, Scene& scene, std::string& error) {
    JsonValue root;
    std::string parseError;
    if (!JsonReader(json).parse(root, parseError)) {
        error = "JSON invalide : " + parseError;
        return false;
    }
    if (root.type != JsonValue::Type::Object) {
        error = "La scène doit être un objet JSON.";
        return false;
    }
    const auto* schema = root.member("schemaVersion");
    if (!schema || schema->type != JsonValue::Type::Number || (schema->number != 1.0 && schema->number != 2.0 && schema->number != 3.0 && schema->number != 4.0)) {
        error = "Version de schéma de scène non prise en charge.";
        return false;
    }
    Scene parsed;
    std::string sceneName;
    if (!readStringField(root, "name", sceneName, 120, true, error)) return false;
    if (sceneName.empty()) {
        error = "Le nom de scène doit contenir entre 1 et 120 caractères.";
        return false;
    }
    parsed.setName(sceneName);
    if (const auto* updated = root.member("updatedAt")) {
        if (updated->type == JsonValue::Type::String && updated->text.size() <= 64) {
            parsed.setUpdatedAt(updated->text);
        } else if (updated->type != JsonValue::Type::Null) {
            error = "Date de mise à jour invalide.";
            return false;
        }
    }
    const auto* entities = root.member("entities");
    if (!entities || entities->type != JsonValue::Type::Array) {
        error = "La propriété entities doit être un tableau.";
        return false;
    }
    if (entities->items.size() > kMaxEntities) {
        error = "Une scène ne peut pas dépasser 250 entités.";
        return false;
    }
    for (const auto& item : entities->items) {
        Entity entity;
        if (!parseSceneEntity(item, entity, error)) return false;
        const std::string entityId = entity.id;
        if (!parsed.insertEntity(std::move(entity))) {
            error = "Identifiant d'entité dupliqué : " + entityId + ".";
            return false;
        }
    }
    if (!validateScene(parsed, error)) return false;
    scene = std::move(parsed);
    return true;
}
}  // namespace nova
