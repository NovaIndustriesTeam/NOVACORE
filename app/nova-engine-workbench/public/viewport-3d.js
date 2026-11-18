/*
 * Nova Engine — WebGL2 real-time viewport.
 * Renders the same scene document as the C++ software rasterizer, but live in
 * the browser. No external dependency: matrices, primitives and shaders are
 * built here. Falls back to the 2D canvas preview when WebGL2 is unavailable.
 */
(function () {
  'use strict';

  const PI = Math.PI;

  // Orbit helpers live in viewport-math.js so the regression test can exercise
  // the exact same code as the browser (see test-viewport.mjs).
  const { GRID_PLANE_Y, orbitEye, clampOrbitPitch } = window.NovaViewportMath;

  function normalize(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function addScaled(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }

  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
        out[column * 4 + row] = sum;
      }
    }
    return out;
  }
  function translation(x, y, z) {
    const out = identity();
    out[12] = x; out[13] = y; out[14] = z;
    return out;
  }
  function scaling(x, y, z) {
    const out = identity();
    out[0] = x; out[5] = y; out[10] = z;
    return out;
  }
  function rotationX(degrees) {
    const r = degrees * PI / 180, c = Math.cos(r), s = Math.sin(r);
    const out = identity();
    out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
    return out;
  }
  function rotationY(degrees) {
    const r = degrees * PI / 180, c = Math.cos(r), s = Math.sin(r);
    const out = identity();
    out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
    return out;
  }
  function rotationZ(degrees) {
    const r = degrees * PI / 180, c = Math.cos(r), s = Math.sin(r);
    const out = identity();
    out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
    return out;
  }
  function compose(position, rotation, scale) {
    const r = multiply(rotationY(rotation[1]), multiply(rotationX(rotation[0]), rotationZ(rotation[2])));
    return multiply(translation(position[0], position[1], position[2]), multiply(r, scaling(scale[0], scale[1], scale[2])));
  }
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const out = new Float32Array(16);
    out[0] = f / Math.max(aspect, 1e-6);
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }
  function lookAt(eye, target, upHint) {
    const forward = normalize(subtract(target, eye));
    let up = upHint || [0, 1, 0];
    if (Math.abs(dot(forward, normalize(up))) > 0.999) up = [0, 0, 1];
    const right = normalize(cross(forward, up));
    up = cross(right, forward);
    const out = identity();
    out[0] = right[0]; out[1] = up[0]; out[2] = -forward[0];
    out[4] = right[1]; out[5] = up[1]; out[6] = -forward[1];
    out[8] = right[2]; out[9] = up[2]; out[10] = -forward[2];
    out[12] = -dot(right, eye); out[13] = -dot(up, eye); out[14] = dot(forward, eye);
    return out;
  }
  function invert(m) {
    const out = new Float32Array(16);
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!determinant) return null;
    determinant = 1 / determinant;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * determinant;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * determinant;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * determinant;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * determinant;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * determinant;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * determinant;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * determinant;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * determinant;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * determinant;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * determinant;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * determinant;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * determinant;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * determinant;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * determinant;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * determinant;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * determinant;
    return out;
  }
  function transformPoint(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const iw = Math.abs(w) > 1e-9 ? 1 / w : 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw
    ];
  }
  function transformDirection(m, d) {
    return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
  }
  function normalMatrix(model) {
    const a = model[0], b = model[1], c = model[2];
    const d = model[4], e = model[5], f = model[6];
    const g = model[8], h = model[9], i = model[10];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const out = new Float32Array(9);
    if (Math.abs(det) < 1e-12) { out[0] = out[4] = out[8] = 1; return out; }
    const inv = 1 / det;
    out[0] = (e * i - f * h) * inv;
    out[1] = -(b * i - c * h) * inv;
    out[2] = (b * f - c * e) * inv;
    out[3] = -(d * i - f * g) * inv;
    out[4] = (a * i - c * g) * inv;
    out[5] = -(a * f - c * d) * inv;
    out[6] = (d * h - e * g) * inv;
    out[7] = -(a * h - b * g) * inv;
    out[8] = (a * e - b * d) * inv;
    return out;
  }

  function hash32(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index) & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return (hash & 0xffffff) / 0xffffff;
  }
  const PALETTE = [
    [0.42, 0.55, 1.00], [0.58, 0.42, 1.00], [0.24, 0.76, 0.95],
    [0.35, 0.86, 0.66], [1.00, 0.66, 0.34], [0.93, 0.48, 0.86]
  ];
  function srgbToLinear(color) {
    const channel = value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    return [channel(color[0]), channel(color[1]), channel(color[2])];
  }
  function mentions(entity, token) {
    const needle = token.toLowerCase();
    for (const component of entity.components || []) if (String(component).toLowerCase().includes(needle)) return true;
    return String(entity.name || '').toLowerCase().includes(needle);
  }
  const PRIMITIVES = ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'capsule', 'pyramid'];
  function meshKind(entity) {
    // Schema 4 stores an explicit primitive; schema 1-3 documents keep the
    // historical name/component inference used by the C++ engine.
    const explicit = typeof entity.primitive === 'string' ? entity.primitive.toLowerCase() : '';
    if (PRIMITIVES.includes(explicit)) return explicit;
    if (mentions(entity, 'sphere')) return 'sphere';
    if (mentions(entity, 'plane')) return 'plane';
    if (mentions(entity, 'cylinder')) return 'cylinder';
    if (mentions(entity, 'cone')) return 'cone';
    if (mentions(entity, 'torus')) return 'torus';
    if (mentions(entity, 'capsule')) return 'capsule';
    if (mentions(entity, 'pyramid')) return 'pyramid';
    return 'cube';
  }
  function albedoFor(entity) {
    const material = entity.material;
    if (material && Array.isArray(material.albedo) && material.albedo.length === 3) return srgbToLinear(material.albedo);
    if (entity.type === 'Prefab') return srgbToLinear([0.22, 0.78, 0.68]);
    if (entity.type === 'Camera') return srgbToLinear([0.42, 0.82, 1.0]);
    if (entity.type === 'Light') return srgbToLinear([1.0, 0.76, 0.38]);
    if (entity.type === 'Audio') return srgbToLinear([0.62, 0.70, 0.80]);
    if (entity.type === 'Empty') return srgbToLinear([0.50, 0.58, 0.70]);
    if (mentions(entity, 'plane')) return srgbToLinear([0.30, 0.42, 0.60]);
    return srgbToLinear(PALETTE[Math.min(5, Math.floor(hash32(entity.id) * 5.999))]);
  }
  function materialFor(entity) {
    const material = entity.material && typeof entity.material === 'object' ? entity.material : {};
    const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const pattern = ['none', 'checker', 'grid'].indexOf(material.pattern);
    return {
      albedo: albedoFor(entity),
      metallic: Math.min(1, Math.max(0, finite(material.metallic, 0.05))),
      roughness: Math.min(1, Math.max(0.04, finite(material.roughness, 0.42))),
      tiling: Math.min(64, Math.max(1, finite(material.tiling, 4))),
      patternId: pattern < 0 ? 0 : pattern,
      emissive: material.emissive === true,
      texture: typeof material.texture === 'string' ? material.texture : ''
    };
  }
  function attachUvs(data) {
    const count = data.positions.length / 3;
    const uvs = new Float32Array(count * 2);
    for (let index = 0; index < count; index++) {
      const x = data.positions[index * 3], y = data.positions[index * 3 + 1], z = data.positions[index * 3 + 2];
      const nx = Math.abs(data.normals[index * 3]), ny = Math.abs(data.normals[index * 3 + 1]), nz = Math.abs(data.normals[index * 3 + 2]);
      let u, v;
      if (ny >= nx && ny >= nz) { u = x + 0.5; v = z + 0.5; }
      else if (nx >= nz) { u = z + 0.5; v = y + 0.5; }
      else { u = x + 0.5; v = y + 0.5; }
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
    return { ...data, uvs };
  }

  function buildCube() {
    const quads = [
      [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [0, 0, 1]],
      [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0, 0, -1]],
      [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [1, 0, 0]],
      [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-1, 0, 0]],
      [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [0, 1, 0]],
      [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [0, -1, 0]]
    ];
    const positions = [], normals = [], indices = [];
    quads.forEach((quad, face) => {
      const base = face * 4;
      for (let corner = 0; corner < 4; corner++) {
        positions.push(...quad[corner]);
        normals.push(...quad[4]);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
  }
  function buildSphere() {
    const stacks = 18, segments = 28, radius = 0.5;
    const positions = [], normals = [], indices = [];
    for (let stack = 0; stack <= stacks; stack++) {
      const phi = stack / stacks * PI;
      for (let segment = 0; segment <= segments; segment++) {
        const theta = segment / segments * 2 * PI;
        const normal = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
        positions.push(normal[0] * radius, normal[1] * radius, normal[2] * radius);
        normals.push(...normal);
      }
    }
    for (let stack = 0; stack < stacks; stack++) {
      for (let segment = 0; segment < segments; segment++) {
        const a = stack * (segments + 1) + segment;
        const b = a + segments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
  }
  function buildPlane() {
    const positions = new Float32Array([-0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5]);
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    return { positions, normals, indices: new Uint16Array([0, 1, 2, 0, 2, 3]) };
  }
  function buildCylinder() {
    const segments = 24, radius = 0.5, half = 0.5;
    const positions = [], normals = [], indices = [];
    for (let segment = 0; segment < segments; segment++) {
      const a = 2 * PI * segment / segments, b = 2 * PI * (segment + 1) / segments;
      const n0 = [Math.cos(a), 0, Math.sin(a)], n1 = [Math.cos(b), 0, Math.sin(b)];
      const normal = normalize([n0[0] + n1[0], 0, n0[2] + n1[2]]);
      const base = positions.length / 3;
      const points = [
        [n0[0] * radius, -half, n0[2] * radius], [n1[0] * radius, -half, n1[2] * radius],
        [n1[0] * radius, half, n1[2] * radius], [n0[0] * radius, half, n0[2] * radius]
      ];
      for (const point of points) { positions.push(...point); normals.push(...normal); }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    for (let cap = 0; cap < 2; cap++) {
      const y = cap === 0 ? -half : half;
      const normal = [0, cap === 0 ? -1 : 1, 0];
      const center = positions.length / 3;
      positions.push(0, y, 0); normals.push(...normal);
      for (let segment = 0; segment <= segments; segment++) {
        const angle = 2 * PI * segment / segments;
        positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        normals.push(...normal);
      }
      for (let segment = 0; segment < segments; segment++) {
        const first = center + 1 + segment;
        if (cap === 0) indices.push(center, first + 1, first);
        else indices.push(center, first, first + 1);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
  }
  function buildCone() {
    const segments = 24, radius = 0.5, half = 0.5;
    const apex = [0, half, 0];
    const positions = [], normals = [], indices = [];
    for (let segment = 0; segment < segments; segment++) {
      const a = 2 * PI * segment / segments, b = 2 * PI * (segment + 1) / segments;
      const p0 = [Math.cos(a) * radius, -half, Math.sin(a) * radius];
      const p1 = [Math.cos(b) * radius, -half, Math.sin(b) * radius];
      const normal = normalize(cross(subtract(p1, p0), subtract(apex, p0)));
      const base = positions.length / 3;
      positions.push(...p0, ...p1, ...apex);
      normals.push(...normal, ...normal, ...normal);
      indices.push(base, base + 1, base + 2);
    }
    const down = [0, -1, 0];
    const center = positions.length / 3;
    positions.push(0, -half, 0); normals.push(...down);
    for (let segment = 0; segment <= segments; segment++) {
      const angle = 2 * PI * segment / segments;
      positions.push(Math.cos(angle) * radius, -half, Math.sin(angle) * radius);
      normals.push(...down);
    }
    for (let segment = 0; segment < segments; segment++) {
      const first = center + 1 + segment;
      indices.push(center, first, first + 1);
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
  }

  function buildTorus() {
    const majorRadius = 0.34, minorRadius = 0.16;
    const majorSegments = 28, minorSegments = 14;
    const positions = [], normals = [], indices = [];
    for (let major = 0; major <= majorSegments; major++) {
      const u = major / majorSegments * 2 * PI;
      for (let minor = 0; minor <= minorSegments; minor++) {
        const v = minor / minorSegments * 2 * PI;
        const normal = [Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)];
        positions.push(
          Math.cos(u) * majorRadius + normal[0] * minorRadius,
          normal[1] * minorRadius,
          Math.sin(u) * majorRadius + normal[2] * minorRadius
        );
        normals.push(...normal);
      }
    }
    for (let major = 0; major < majorSegments; major++) {
      for (let minor = 0; minor < minorSegments; minor++) {
        const a = major * (minorSegments + 1) + minor;
        const b = a + minorSegments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
  }
  function buildCapsule() {
    // Total height 1: two hemispherical caps (radius 0.3) and a straight side.
    const radius = 0.3, half = 0.2, segments = 24, capRings = 6;
    const rings = [];
    for (let ring = 0; ring <= capRings; ring++) {
      const phi = -PI / 2 + (PI / 2) * ring / capRings;
      rings.push([-half + Math.sin(phi) * radius, Math.cos(phi) * radius, Math.sin(phi)]);
    }
    for (let ring = 1; ring <= capRings; ring++) {
      const phi = (PI / 2) * ring / capRings;
      rings.push([half + Math.sin(phi) * radius, Math.cos(phi) * radius, Math.sin(phi)]);
    }
    const positions = [], normals = [], indices = [];
    for (const [y, ringRadius, normalY] of rings) {
      for (let segment = 0; segment <= segments; segment++) {
        const angle = 2 * PI * segment / segments;
        positions.push(Math.cos(angle) * ringRadius, y, Math.sin(angle) * ringRadius);
        normals.push(Math.cos(angle) * Math.sqrt(Math.max(0, 1 - normalY * normalY)), normalY, Math.sin(angle) * Math.sqrt(Math.max(0, 1 - normalY * normalY)));
      }
    }
    const stride = segments + 1;
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const a = ring * stride + segment;
        const b = a + stride;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
  }
  function buildPyramid() {
    const half = 0.5;
    const apex = [0, half, 0];
    const base = [[-half, -half, half], [half, -half, half], [half, -half, -half], [-half, -half, -half]];
    const positions = [], normals = [], indices = [];
    const pushTriangle = (a, b, c) => {
      const normal = normalize(cross(subtract(b, a), subtract(c, a)));
      const offset = positions.length / 3;
      for (const point of [a, b, c]) { positions.push(...point); normals.push(...normal); }
      indices.push(offset, offset + 1, offset + 2);
    };
    for (let side = 0; side < 4; side++) pushTriangle(base[side], base[(side + 1) % 4], apex);
    pushTriangle(base[0], base[2], base[1]);
    pushTriangle(base[0], base[3], base[2]);
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
  }

  const MESH_BUILDERS = { cube: () => attachUvs(buildCube()), sphere: () => attachUvs(buildSphere()), plane: () => attachUvs(buildPlane()), cylinder: () => attachUvs(buildCylinder()), cone: () => attachUvs(buildCone()), torus: () => attachUvs(buildTorus()), capsule: () => attachUvs(buildCapsule()), pyramid: () => attachUvs(buildPyramid()) };

  const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat3 uNormalMatrix;
uniform float uTiling;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vUv = aUv * uTiling;
  gl_Position = uViewProjection * world;
}`;

  const FRAGMENT_SHADER = `#version 300 es
precision highp float;
#define MAX_LIGHTS 16
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
out vec4 outColor;
uniform vec3 uAlbedo;
uniform float uMetallic;
uniform float uRoughness;
uniform int uPattern;
uniform float uTiling;
uniform float uEmissive;
uniform int uHasTexture;
uniform sampler2D uTexture;
uniform vec3 uCameraPosition;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform float uSelected;
uniform int uLightCount;
uniform int uLightType[MAX_LIGHTS];
uniform vec3 uLightPosition[MAX_LIGHTS];
uniform vec3 uLightDirection[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform float uLightRange[MAX_LIGHTS];
uniform float uLightCosOuter[MAX_LIGHTS];
uniform float uLightCosInner[MAX_LIGHTS];
vec3 applySurfacePattern(vec3 albedo, vec2 uv, int pattern) {
  if (pattern == 1) {
    vec2 cell = floor(uv);
    float parity = mod(abs(cell.x + cell.y), 2.0);
    return parity < 0.5 ? albedo : albedo * 0.45;
  }
  if (pattern == 2) {
    vec2 edgeDistance = abs(fract(uv) - 0.5);
    float edge = max(edgeDistance.x, edgeDistance.y);
    return edge > 0.44 ? clamp(albedo * 1.35 + 0.06, 0.0, 1.0) : albedo * 0.62;
  }
  return albedo;
}
void main() {
  // The scene pass writes linear HDR radiance: exposure and the ACES curve are
  // applied once by the composite pass, exactly like the C++ software/D3D12
  // backends. Emissive materials are unlit, matching shadeFragment().
  vec3 surface = uAlbedo;
  vec2 uv = vUv * clamp(uTiling, 1.0, 64.0);
  if (uHasTexture == 1) surface *= texture(uTexture, uv).rgb;
  else surface = applySurfacePattern(surface, uv, uPattern);
  if (uEmissive > 0.5) { outColor = vec4(surface, 1.0); return; }

  float roughness = clamp(uRoughness, 0.04, 1.0);
  float metallic = clamp(uMetallic, 0.0, 1.0);
  float shininess = max(2.0, pow(2.0, 10.0 * (1.0 - roughness)));
  float specularStrength = (0.04 + 0.46 * (1.0 - roughness)) * (1.0 - metallic * 0.45);
  vec3 specularTint = mix(vec3(1.0), surface, metallic);
  float diffuseWeight = 1.0 - metallic * 0.65;

  vec3 normal = normalize(vNormal);
  vec3 view = normalize(uCameraPosition - vWorld);
  if (dot(normal, view) < 0.0) normal = -normal;
  float ndv = clamp(dot(normal, view), 0.0, 1.0);
  float hemisphere = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = surface * mix(uAmbientGround, uAmbientSky, hemisphere);

  for (int index = 0; index < MAX_LIGHTS; index++) {
    if (index >= uLightCount) break;
    vec3 directionToLight;
    float attenuation = 1.0;
    if (uLightType[index] == 0) {
      directionToLight = -normalize(uLightDirection[index]);
    } else {
      vec3 delta = uLightPosition[index] - vWorld;
      float distanceSquared = dot(delta, delta);
      if (distanceSquared < 1.0e-6) continue;
      float range = max(uLightRange[index], 1.0e-3);
      float rangeSquared = range * range;
      if (distanceSquared > rangeSquared) continue;
      float distance = sqrt(distanceSquared);
      directionToLight = delta / distance;
      attenuation = pow(max(0.0, 1.0 - distanceSquared / rangeSquared), 2.0) / (1.0 + distanceSquared * 0.18);
      if (uLightType[index] == 2) {
        float cosAngle = dot(-directionToLight, normalize(uLightDirection[index]));
        if (cosAngle <= uLightCosOuter[index]) continue;
        float cone = clamp((cosAngle - uLightCosOuter[index]) / max(uLightCosInner[index] - uLightCosOuter[index], 1.0e-4), 0.0, 1.0);
        attenuation *= cone * cone;
      }
    }
    float ndotl = max(dot(normal, directionToLight), 0.0);
    if (ndotl <= 0.0 || attenuation <= 0.0) continue;
    vec3 halfway = normalize(directionToLight + view);
    float spec = pow(max(dot(normal, halfway), 0.0), shininess) * specularStrength;
    color += (surface * (ndotl * diffuseWeight) + specularTint * spec) * uLightColor[index] * attenuation;
  }

  float rim = pow(1.0 - ndv, 3.2);
  color += vec3(0.20, 0.34, 0.55) * (rim * 0.14);
  color += vec3(0.18, 0.72, 1.0) * (uSelected * (rim * 1.4 + 0.06));

  float fog = 1.0 - exp(-distance(uCameraPosition, vWorld) * 0.010);
  color = mix(color, vec3(0.030, 0.052, 0.085), fog * 0.30);
  outColor = vec4(color, 1.0);
}`;

  const LINE_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColor;
uniform mat4 uViewProjection;
out vec3 vColor;
void main() { vColor = aColor; gl_Position = uViewProjection * vec4(aPosition, 1.0); }`;

  const LINE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

  const GRID_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProjection;
out vec3 vWorld;
void main() { vWorld = aPosition; gl_Position = uViewProjection * vec4(aPosition, 1.0); }`;

  const GRID_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vWorld;
out vec4 outColor;
uniform vec3 uCameraPosition;
void main() {
  vec2 uv = vWorld.xz;
  vec2 width = max(fwidth(uv), vec2(1e-5));
  vec2 minor = abs(fract(uv - 0.5) - 0.5) / width;
  float minorLine = 1.0 - min(min(minor.x, minor.y), 1.0);
  vec2 uv10 = uv / 10.0;
  vec2 width10 = max(fwidth(uv10), vec2(1e-6));
  vec2 major = abs(fract(uv10 - 0.5) - 0.5) / width10;
  float majorLine = 1.0 - min(min(major.x, major.y), 1.0);
  // At grazing angles a cell covers less than a pixel: the unfiltered pattern
  // turns into a flat moire wash. Fade the lines out instead of aliasing.
  float minorFade = clamp(1.0 - max(width.x, width.y) * 0.5, 0.0, 1.0);
  float majorFade = clamp(1.0 - max(width10.x, width10.y) * 2.0, 0.0, 1.0);
  float distanceToCamera = distance(vWorld, uCameraPosition);
  float fade = exp(-distanceToCamera * 0.014);
  vec3 color = vec3(0.055, 0.082, 0.120);
  color = mix(color, vec3(0.24, 0.43, 0.70), clamp(minorLine * 0.55 * fade * minorFade, 0.0, 1.0));
  color = mix(color, vec3(0.36, 0.62, 0.95), clamp(majorLine * 0.85 * fade * majorFade, 0.0, 1.0));
  float axisX = 1.0 - min(abs(uv.y) / max(width.y, 1e-5), 1.0);
  float axisZ = 1.0 - min(abs(uv.x) / max(width.x, 1e-5), 1.0);
  color = mix(color, vec3(0.80, 0.30, 0.34), clamp(axisX * 0.95 * fade, 0.0, 1.0));
  color = mix(color, vec3(0.30, 0.48, 0.90), clamp(axisZ * 0.95 * fade, 0.0, 1.0));
  float horizon = smoothstep(30.0, 150.0, distanceToCamera);
  color = mix(color, vec3(0.070, 0.120, 0.200), horizon);
  outColor = vec4(color, 1.0);
}`;

  const SKY_VERTEX = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = position;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

  const SKY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vNdc;
out vec4 outColor;
uniform vec2 uResolution;
void main() {
  float height = clamp((gl_FragCoord.y / max(uResolution.y, 1.0)) * 1.35 - 0.15, 0.0, 1.0);
  vec3 horizon = vec3(0.070, 0.120, 0.200);
  vec3 zenith = vec3(0.010, 0.020, 0.048);
  vec3 color = mix(horizon, zenith, pow(height, 0.62));
  float band = exp(-abs(gl_FragCoord.y / max(uResolution.y, 1.0) - 0.42) * 9.0) * 0.10;
  color += vec3(0.16, 0.10, 0.05) * band;
  outColor = vec4(color, 1.0);
}`;

  const POST_VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

  const BRIGHT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 color = texture(uScene, vUv).rgb;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float weight = smoothstep(uThreshold, uThreshold + max(uKnee, 1.0e-4), luminance);
  outColor = vec4(color * weight, 1.0);
}`;

  const BLUR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uDirection;
const float weights[5] = float[](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
void main() {
  vec3 result = texture(uSource, vUv).rgb * weights[0];
  for (int index = 1; index < 5; index++) {
    vec2 offset = uDirection * float(index);
    result += texture(uSource, vUv + offset).rgb * weights[index];
    result += texture(uSource, vUv - offset).rgb * weights[index];
  }
  outColor = vec4(result, 1.0);
}`;

  const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomIntensity;
uniform float uBloomEnabled;
vec3 acesFilm(vec3 color) {
  vec3 x = max(color, vec3(0.0));
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 linearToSrgb(vec3 color) {
  vec3 low = color * 12.92;
  vec3 high = 1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, vec3(1.0) - step(vec3(0.0031308), color));
}
void main() {
  vec3 color = texture(uScene, vUv).rgb * uExposure;
  if (uBloomEnabled > 0.5) color += texture(uBloom, vUv).rgb * uBloomIntensity * uExposure;
  outColor = vec4(linearToSrgb(acesFilm(color)), 1.0);
}`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} : ${log}`);
    }
    return shader;
  }
  function program(gl, vertexSource, fragmentSource) {
    const result = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(result, vertex);
    gl.attachShader(result, fragment);
    gl.linkProgram(result);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(`Liaison du programme : ${gl.getProgramInfoLog(result)}`);
    return result;
  }

  function create(canvas, options) {
    const settings = options || {};
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' });
    if (!gl) return null;

    const meshProgram = program(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    const lineProgram = program(gl, LINE_VERTEX, LINE_FRAGMENT);
    const gridProgram = program(gl, GRID_VERTEX, GRID_FRAGMENT);
    const skyProgram = program(gl, SKY_VERTEX, SKY_FRAGMENT);
    const brightProgram = program(gl, POST_VERTEX, BRIGHT_FRAGMENT);
    const blurProgram = program(gl, POST_VERTEX, BLUR_FRAGMENT);
    const compositeProgram = program(gl, POST_VERTEX, COMPOSITE_FRAGMENT);

    const meshUniforms = {
      model: gl.getUniformLocation(meshProgram, 'uModel'),
      viewProjection: gl.getUniformLocation(meshProgram, 'uViewProjection'),
      normalMatrix: gl.getUniformLocation(meshProgram, 'uNormalMatrix'),
      albedo: gl.getUniformLocation(meshProgram, 'uAlbedo'),
      metallic: gl.getUniformLocation(meshProgram, 'uMetallic'),
      roughness: gl.getUniformLocation(meshProgram, 'uRoughness'),
      pattern: gl.getUniformLocation(meshProgram, 'uPattern'),
      tiling: gl.getUniformLocation(meshProgram, 'uTiling'),
      emissive: gl.getUniformLocation(meshProgram, 'uEmissive'),
      hasTexture: gl.getUniformLocation(meshProgram, 'uHasTexture'),
      texture: gl.getUniformLocation(meshProgram, 'uTexture'),
      cameraPosition: gl.getUniformLocation(meshProgram, 'uCameraPosition'),
      ambientSky: gl.getUniformLocation(meshProgram, 'uAmbientSky'),
      ambientGround: gl.getUniformLocation(meshProgram, 'uAmbientGround'),
      selected: gl.getUniformLocation(meshProgram, 'uSelected'),
      lightCount: gl.getUniformLocation(meshProgram, 'uLightCount'),
      lightType: gl.getUniformLocation(meshProgram, 'uLightType[0]'),
      lightPosition: gl.getUniformLocation(meshProgram, 'uLightPosition[0]'),
      lightDirection: gl.getUniformLocation(meshProgram, 'uLightDirection[0]'),
      lightColor: gl.getUniformLocation(meshProgram, 'uLightColor[0]'),
      lightRange: gl.getUniformLocation(meshProgram, 'uLightRange[0]'),
      lightCosOuter: gl.getUniformLocation(meshProgram, 'uLightCosOuter[0]'),
      lightCosInner: gl.getUniformLocation(meshProgram, 'uLightCosInner[0]')
    };
    const lineUniforms = { viewProjection: gl.getUniformLocation(lineProgram, 'uViewProjection') };
    const gridUniforms = { viewProjection: gl.getUniformLocation(gridProgram, 'uViewProjection'), cameraPosition: gl.getUniformLocation(gridProgram, 'uCameraPosition') };
    const skyUniforms = { resolution: gl.getUniformLocation(skyProgram, 'uResolution') };
    const brightUniforms = {
      scene: gl.getUniformLocation(brightProgram, 'uScene'),
      threshold: gl.getUniformLocation(brightProgram, 'uThreshold'),
      knee: gl.getUniformLocation(brightProgram, 'uKnee')
    };
    const blurUniforms = {
      source: gl.getUniformLocation(blurProgram, 'uSource'),
      direction: gl.getUniformLocation(blurProgram, 'uDirection')
    };
    const compositeUniforms = {
      scene: gl.getUniformLocation(compositeProgram, 'uScene'),
      bloom: gl.getUniformLocation(compositeProgram, 'uBloom'),
      exposure: gl.getUniformLocation(compositeProgram, 'uExposure'),
      bloomIntensity: gl.getUniformLocation(compositeProgram, 'uBloomIntensity'),
      bloomEnabled: gl.getUniformLocation(compositeProgram, 'uBloomEnabled')
    };

    const MAX_LIGHTS = 16;
    const floatTargets = gl.getExtension('EXT_color_buffer_float');
    let colorFormat = floatTargets ? gl.RGBA16F : gl.RGBA8;
    let colorType = floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    let targets = null;

    const fullscreenArray = gl.createVertexArray();

    const textureCache = new Map();
    function assetUrl(relative) {
      return '/nova-engine/api/assets/' + String(relative).split('/').filter(Boolean).map(encodeURIComponent).join('/');
    }
    function textureFor(path) {
      if (!path) return null;
      const cached = textureCache.get(path);
      if (cached) return cached;
      // A 1x1 white placeholder keeps the sampler complete while the PNG/JPEG
      // downloads; the material falls back to albedo until it is ready.
      const entry = { texture: gl.createTexture(), ready: false, failed: false };
      textureCache.set(path, entry);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (disposed) return;
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        entry.ready = true;
        requestRender();
      };
      image.onerror = () => { entry.failed = true; };
      image.src = assetUrl(path);
      return entry;
    }

    function createColorTarget(width, height) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, colorFormat, width, height, 0, gl.RGBA, colorType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return { texture, framebuffer, width, height };
    }
    function releaseTargets() {
      if (!targets) return;
      gl.deleteFramebuffer(targets.scene.framebuffer);
      gl.deleteTexture(targets.scene.texture);
      gl.deleteFramebuffer(targets.bloomA.framebuffer);
      gl.deleteTexture(targets.bloomA.texture);
      gl.deleteFramebuffer(targets.bloomB.framebuffer);
      gl.deleteTexture(targets.bloomB.texture);
      if (targets.depth) gl.deleteRenderbuffer(targets.depth);
      targets = null;
    }
    function ensureTargets(width, height) {
      if (targets && targets.scene.width === width && targets.scene.height === height) return targets;
      releaseTargets();
      const sceneTarget = createColorTarget(width, height);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && colorFormat !== gl.RGBA8) {
        // Half-float rendering is optional; fall back to RGBA8 when the driver
        // refuses EXT_color_buffer_float render targets.
        gl.deleteFramebuffer(sceneTarget.framebuffer);
        gl.deleteTexture(sceneTarget.texture);
        gl.deleteRenderbuffer(depth);
        colorFormat = gl.RGBA8;
        colorType = gl.UNSIGNED_BYTE;
        return ensureTargets(width, height);
      }
      const bloomWidth = Math.max(1, Math.floor(width / 2));
      const bloomHeight = Math.max(1, Math.floor(height / 2));
      targets = {
        scene: sceneTarget,
        depth,
        bloomA: createColorTarget(bloomWidth, bloomHeight),
        bloomB: createColorTarget(bloomWidth, bloomHeight)
      };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return targets;
    }

    const meshes = {};
    for (const [kind, builder] of Object.entries(MESH_BUILDERS)) {
      const data = builder();
      const vertexArray = gl.createVertexArray();
      const positionBuffer = gl.createBuffer();
      const normalBuffer = gl.createBuffer();
      const uvBuffer = gl.createBuffer();
      const indexBuffer = gl.createBuffer();
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.uvs, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      meshes[kind] = { vertexArray, indexCount: data.indices.length, positions: data.positions };
    }

    const gridArray = gl.createVertexArray();
    const gridBuffer = gl.createBuffer();
    gl.bindVertexArray(gridArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-200, 0, -200, 200, 0, -200, -200, 0, 200, 200, 0, 200]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const lineArray = gl.createVertexArray();
    const lineBuffer = gl.createBuffer();
    gl.bindVertexArray(lineArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    const skyArray = gl.createVertexArray();

    let scene = null;
    let selectedId = null;
    let frameHandle = 0;
    let statsCallback = settings.onStats || null;
    let selectCallback = settings.onSelect || null;
    let disposed = false;
    let cameraSignature = '';
    let orbitInitialized = false;
    let dirty = true;

    // Play mode mutates a snapshot copy of the live entities; stopping restores
    // the authored transforms so the editor document is never dirtied by a run.
    const keys = new Set();
    let playing = false;
    let playSnapshot = null;
    let playHandle = 0;
    let playLast = 0;
    let jumpQueued = false;
    let playYaw = 0;
    let playPitch = 0;
    let playerState = null;
    const rigidStates = new Map();
    let playStats = { active: false, score: 0, collected: 0, totalCollectibles: 0, players: 0, grounded: false, playerPosition: null };
    const playCallback = settings.onPlayStats || null;

    const orbit = { target: [0, 0.8, 0], distance: 9, yaw: 0.62, pitch: 0.34 };
    const state = { eye: [0, 3, 9], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], viewProjection: identity(), cameraPosition: [0, 3, 9], projection: identity(), view: identity() };

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round((canvas.clientWidth || 960) * ratio));
      const height = Math.max(1, Math.round((canvas.clientHeight || 540) * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        dirty = true;
      }
    }

    function sceneBounds() {
      if (!scene) return { center: [0, 0.8, 0], radius: 3, valid: false };
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const entity of scene.entities) {
        if (!entity.visible || (entity.type !== 'Mesh' && entity.type !== 'Prefab')) continue;
        const model = worldMatrix(entity);
        const positions = meshes[meshKind(entity)].positions;
        for (let index = 0; index < positions.length; index += 3) {
          const point = transformPoint(model, [positions[index], positions[index + 1], positions[index + 2]]);
          minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); minZ = Math.min(minZ, point[2]);
          maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]); maxZ = Math.max(maxZ, point[2]);
        }
      }
      if (!Number.isFinite(minX)) return { center: [0, 0.8, 0], radius: 3, valid: false };
      const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
      const radius = Math.max(1.6, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
      return { center, radius, valid: true };
    }

    function worldMatrix(entity) {
      const local = compose(entity.position, entity.rotation, entity.scale);
      if (!entity.parentId) return local;
      const parent = scene.entities.find(candidate => candidate.id === entity.parentId);
      if (!parent || parent.id === entity.id) return local;
      const visited = new Set([entity.id]);
      let matrix = local;
      let current = parent;
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        matrix = multiply(compose(current.position, current.rotation, current.scale), matrix);
        current = current.parentId ? scene.entities.find(candidate => candidate.id === current.parentId) : null;
      }
      return matrix;
    }

    function syncCamera() {
      if (!scene) return;
      const camera = scene.entities.find(entity => entity.visible && entity.type === 'Camera') || null;
      const signature = camera ? `${camera.id}|${camera.position.join(',')}|${camera.rotation.join(',')}` : '';
      if (orbitInitialized && signature === cameraSignature) return;
      cameraSignature = signature;
      if (camera) {
        const model = worldMatrix(camera);
        const eye = transformPoint(model, [0, 0, 0]);
        const forward = normalize(transformDirection(model, [0, 0, -1]));
        const bounds = sceneBounds();
        let target = bounds.valid ? bounds.center.slice() : addScaled(eye, forward, 8);
        let offset = subtract(eye, target);
        let distance = Math.hypot(offset[0], offset[1], offset[2]);
        if (!Number.isFinite(distance) || distance < 0.75) {
          target = addScaled(eye, forward, 6);
          offset = subtract(eye, target);
          distance = 6;
        }
        orbit.target = target;
        orbit.distance = Math.min(200, distance);
        orbit.yaw = Math.atan2(offset[0], offset[2]);
        orbit.pitch = Math.asin(Math.max(-1, Math.min(1, offset[1] / Math.max(distance, 1e-4))));
      } else {
        const bounds = sceneBounds();
        orbit.target = bounds.center.slice();
        orbit.distance = Math.min(80, Math.max(3, bounds.radius * 2.6));
        orbit.yaw = 0.62;
        orbit.pitch = 0.36;
      }
      orbitInitialized = true;
      dirty = true;
    }

    function updateMatrices() {
      const player = playing ? activePlayer() : null;
      if (player) {
        // Play mode is a first-person preview: the controller entity provides the
        // eye position and yaw/pitch, matching Runtime::play in the C++ engine.
        const yaw = playYaw * PI / 180, pitch = playPitch * PI / 180;
        const eye = [player.position[0], player.position[1], player.position[2]];
        const forward = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
        const view = lookAt(eye, addScaled(eye, forward, 4), [0, 1, 0]);
        const projection = perspective(60 * PI / 180, canvas.width / Math.max(1, canvas.height), 0.05, 600);
        state.eye = eye;
        state.view = view;
        state.projection = projection;
        state.viewProjection = multiply(projection, view);
        state.cameraPosition = eye;
        state.right = [view[0], view[4], view[8]];
        state.up = [view[1], view[5], view[9]];
        state.forward = [-view[2], -view[6], -view[10]];
        return;
      }
      // The orbit camera never sinks below the grid plane (viewport-math.js):
      // at a grazing angle the ground plane used to fill the whole viewport
      // and hide the scene.
      orbit.pitch = clampOrbitPitch(orbit.pitch, orbit.target[1], orbit.distance, GRID_PLANE_Y);
      const eye = orbitEye(orbit.target, orbit.yaw, orbit.pitch, orbit.distance);
      const view = lookAt(eye, orbit.target, [0, 1, 0]);
      const projection = perspective(48 * PI / 180, canvas.width / Math.max(1, canvas.height), 0.05, 600);
      state.eye = eye;
      state.view = view;
      state.projection = projection;
      state.viewProjection = multiply(projection, view);
      state.cameraPosition = eye;
      state.right = [view[0], view[4], view[8]];
      state.up = [view[1], view[5], view[9]];
      state.forward = [-view[2], -view[6], -view[10]];
    }

    function lighting() {
      const result = {
        ambientSky: [0.16, 0.22, 0.35],
        ambientGround: [0.035, 0.045, 0.07],
        lights: []
      };
      if (!scene) return result;
      let explicitLight = false;
      for (const entity of scene.entities) {
        if (!entity.visible || entity.type !== 'Light') continue;
        explicitLight = true;
        const model = worldMatrix(entity);
        const position = transformPoint(model, [0, 0, 0]);
        const direction = normalize(transformDirection(model, [0, 0, -1]));
        const scale = Math.max(Math.abs(entity.scale[0]), Math.abs(entity.scale[1]), Math.abs(entity.scale[2]), 0.1);
        const data = entity.light && typeof entity.light === 'object' ? entity.light : null;
        let type = 0;
        let color = [1, 0.94, 0.84];
        let intensity = 1.15;
        let range = Math.min(60, Math.max(2, 8 * scale));
        let spotAngle = 35;
        if (data) {
          const explicitType = typeof data.type === 'string' ? data.type.toLowerCase() : 'directional';
          type = explicitType === 'point' ? 1 : explicitType === 'spot' ? 2 : 0;
          if (Array.isArray(data.color) && data.color.length === 3) color = data.color.slice(0, 3).map(Number);
          intensity = Number.isFinite(Number(data.intensity)) ? Number(data.intensity) : 1;
          range = Number.isFinite(Number(data.range)) ? Number(data.range) : 8;
          spotAngle = Number.isFinite(Number(data.spotAngle)) ? Number(data.spotAngle) : 35;
          if (intensity <= 0) continue;
        } else if (mentions(entity, 'directional') || mentions(entity, 'sun')) {
          type = 0;
          color = [1, 0.91, 0.78];
          intensity = 1.15;
        } else {
          type = 1;
          color = [1, 0.66, 0.32];
          intensity = 1.35;
        }
        const linear = srgbToLinear(color);
        const outer = spotAngle * PI / 180;
        result.lights.push({
          type,
          position,
          direction,
          color: [linear[0] * intensity, linear[1] * intensity, linear[2] * intensity],
          range: Math.max(0.01, range),
          cosOuter: Math.cos(outer),
          cosInner: Math.cos(outer * 0.72)
        });
        if (result.lights.length >= MAX_LIGHTS) break;
      }
      if (!explicitLight) {
        // Historical default rig for documents without any Light entity.
        result.lights.push({
          type: 0, position: [0, 0, 0], direction: normalize([-0.45, -0.8, -0.4]),
          color: srgbToLinear([1.0, 0.94, 0.84]).map(value => value * 1.15),
          range: 8, cosOuter: -1, cosInner: 1
        });
        result.lights.push({
          type: 0, position: [0, 0, 0], direction: normalize([0.55, -0.25, 0.6]),
          color: srgbToLinear([0.32, 0.46, 0.72]).map(value => value * 0.34),
          range: 8, cosOuter: -1, cosInner: 1
        });
      }
      return result;
    }

    function activePlayer() {
      if (!scene) return null;
      return scene.entities.find(entity => entity.controller && entity.visible) || null;
    }
    function emitPlayStats() {
      if (playCallback) playCallback({ ...playStats });
    }
    function spinnerAxis(entity) {
      const axis = entity.spinner && entity.spinner.axis;
      if (Array.isArray(axis) && axis.length === 3 && axis.every(value => Number.isFinite(Number(value)))) {
        return normalize([Number(axis[0]), Number(axis[1]), Number(axis[2])]);
      }
      const name = typeof axis === 'string' ? axis.toLowerCase() : 'y';
      return name === 'x' ? [1, 0, 0] : name === 'z' ? [0, 0, 1] : [0, 1, 0];
    }
    function numberOr(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }

    function startPlay() {
      if (!scene) return false;
      playSnapshot = JSON.parse(JSON.stringify(scene));
      const player = activePlayer();
      playStats = { active: true, score: 0, collected: 0, totalCollectibles: 0, players: player ? 1 : 0, grounded: true, playerPosition: null };
      for (const entity of scene.entities) if (entity.collectible && entity.visible) playStats.totalCollectibles++;
      rigidStates.clear();
      for (const entity of scene.entities) {
        if (entity.rigidbody) rigidStates.set(entity.id, { velocityY: numberOr(entity.rigidbody.velocity && entity.rigidbody.velocity[1], 0) });
      }
      playerState = null;
      if (player) {
        playYaw = numberOr(player.rotation[1], 0);
        playPitch = Math.max(-89, Math.min(89, numberOr(player.rotation[0], 0)));
        const eyeHeight = 1.6;
        const feet = numberOr(player.position[1], 0) >= eyeHeight ? numberOr(player.position[1], 0) - eyeHeight : 0;
        playerState = { feet, velocityY: 0, grounded: true };
        player.position[1] = feet + eyeHeight;
        playStats.playerPosition = player.position.slice();
      }
      keys.clear();
      jumpQueued = false;
      playing = true;
      playLast = performance.now();
      emitPlayStats();
      requestRender();
      if (!playHandle) playHandle = requestAnimationFrame(playFrame);
      return true;
    }

    function stopPlay(restore = true) {
      if (!playing && !playSnapshot) return;
      playing = false;
      if (playHandle) { cancelAnimationFrame(playHandle); playHandle = 0; }
      if (restore && playSnapshot && scene) {
        const originals = new Map(playSnapshot.entities.map(entity => [entity.id, entity]));
        for (const entity of scene.entities) {
          const original = originals.get(entity.id);
          if (!original) continue;
          entity.position = original.position.slice();
          entity.rotation = original.rotation.slice();
          entity.visible = original.visible;
        }
      }
      playSnapshot = null;
      rigidStates.clear();
      playerState = null;
      keys.clear();
      jumpQueued = false;
      playStats = { active: false, score: 0, collected: 0, totalCollectibles: 0, players: 0, grounded: false, playerPosition: null };
      emitPlayStats();
      requestRender();
    }

    function simulate(deltaSeconds) {
      const dt = Math.max(0, Math.min(0.1, deltaSeconds));
      if (dt <= 0) return;
      const steps = Math.min(5, Math.max(1, Math.ceil(dt / 0.02)));
      const step = dt / steps;
      const player = activePlayer();
      for (let iteration = 0; iteration < steps; iteration++) {
        if (player && playerState) {
          const forward = (keys.has('KeyW') || keys.has('KeyZ') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
          const right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') || keys.has('KeyQ') ? 1 : 0);
          const yaw = playYaw * PI / 180;
          const front = [-Math.sin(yaw), -Math.cos(yaw)];
          const side = [Math.cos(yaw), -Math.sin(yaw)];
          let dx = front[0] * forward + side[0] * right;
          let dz = front[1] * forward + side[1] * right;
          const length = Math.hypot(dx, dz);
          if (length > 1) { dx /= length; dz /= length; }
          const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.7 : 1;
          const speed = numberOr(player.controller.speed, 4);
          player.position[0] += dx * speed * sprint * step;
          player.position[2] += dz * speed * sprint * step;
          if (jumpQueued && playerState.grounded) {
            playerState.velocityY = numberOr(player.controller.jumpSpeed, 5);
            playerState.grounded = false;
          }
          jumpQueued = false;
          playerState.velocityY -= 9.81 * step;
          playerState.feet += playerState.velocityY * step;
          if (playerState.feet <= 0 && playerState.velocityY <= 0) {
            playerState.feet = 0;
            playerState.velocityY = 0;
            playerState.grounded = true;
          } else {
            playerState.grounded = false;
          }
          player.position[1] = playerState.feet + 1.6;
          player.rotation[0] = playPitch;
          player.rotation[1] = playYaw;
          playStats.playerPosition = player.position.slice();
          playStats.grounded = playerState.grounded;
        }
        for (const entity of scene.entities) {
          if (entity.rigidbody && entity.visible) {
            const state = rigidStates.get(entity.id) || { velocityY: 0 };
            if (entity.rigidbody.gravity !== false) state.velocityY -= 9.81 * step;
            const halfY = Math.max(0.01, Math.abs(numberOr(entity.scale[1], 1)) * 0.5);
            entity.position[1] += state.velocityY * step;
            if (entity.position[1] - halfY <= 0 && state.velocityY <= 0) {
              entity.position[1] = halfY;
              const bounciness = Math.max(0, Math.min(1, numberOr(entity.rigidbody.bounciness, 0.25)));
              state.velocityY = Math.abs(state.velocityY) > 0.8 ? -state.velocityY * bounciness : 0;
            }
            rigidStates.set(entity.id, state);
          }
          if (entity.spinner) {
            const axis = spinnerAxis(entity);
            const degrees = numberOr(entity.spinner.degreesPerSecond, 45);
            const angle = degrees * step;
            entity.rotation[0] += axis[0] * angle;
            entity.rotation[1] += axis[1] * angle;
            entity.rotation[2] += axis[2] * angle;
          }
          if (entity.collectible && entity.visible && player) {
            const dx = entity.position[0] - player.position[0];
            const dy = entity.position[1] - player.position[1];
            const dz = entity.position[2] - player.position[2];
            const radius = Math.max(0.1, numberOr(entity.collectible.radius, 1));
            if (dx * dx + dy * dy + dz * dz <= radius * radius) {
              entity.visible = false;
              playStats.score += Math.max(1, Math.floor(numberOr(entity.collectible.value, 1)));
              playStats.collected += 1;
            }
          }
        }
      }
      emitPlayStats();
    }

    function playFrame(now) {
      playHandle = 0;
      if (!playing || disposed) return;
      const dt = (now - playLast) / 1000;
      playLast = now;
      simulate(Number.isFinite(dt) ? dt : 0);
      requestRender();
      playHandle = requestAnimationFrame(playFrame);
    }

    function setPlaying(value) {
      if (value) return startPlay();
      stopPlay(true);
      return false;
    }

    function isTypingTarget(target) {
      const tag = String(target && target.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || !!(target && target.isContentEditable);
    }
    function onKeyDown(event) {
      if (!playing || isTypingTarget(event.target)) return;
      const code = event.code;
      if (code === 'Escape') { event.preventDefault(); stopPlay(true); return; }
      if (['KeyW', 'KeyZ', 'KeyA', 'KeyQ', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'].includes(code)) {
        event.preventDefault();
        if (code === 'Space' && !event.repeat) jumpQueued = true;
        keys.add(code);
      }
    }
    function onKeyUp(event) { keys.delete(event.code); }
    function onWindowBlur() { keys.clear(); }

    function pushLine(vertices, a, b, color) {
      vertices.push(a[0], a[1], a[2], color[0], color[1], color[2]);
      vertices.push(b[0], b[1], b[2], color[0], color[1], color[2]);
    }
    function pushBoxEdges(vertices, matrix, min, max, color) {
      const corners = [
        [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
        [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]
      ].map(point => transformPoint(matrix, point));
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      for (const [a, b] of edges) pushLine(vertices, corners[a], corners[b], color);
    }

    function buildOverlayLines() {
      const vertices = [];
      if (!scene) return new Float32Array(0);
      const selectedColor = [0.20, 0.78, 1.0];
      const cameraColor = [0.32, 0.70, 0.95];
      const lightColor = [1.0, 0.72, 0.32];
      for (const entity of scene.entities) {
        if (!entity.visible) continue;
        const selected = entity.id === selectedId;
        const model = worldMatrix(entity);
        if (entity.type === 'Mesh' || entity.type === 'Prefab') {
          if (!selected) continue;
          pushBoxEdges(vertices, model, [-0.52, -0.52, -0.52], [0.52, 0.52, 0.52], selectedColor);
        } else if (entity.type === 'Camera') {
          const camera = scene.entities.find(candidate => candidate.visible && candidate.type === 'Camera');
          if (camera && camera.id === entity.id && !selected) continue;
          const eye = transformPoint(model, [0, 0, 0]);
          const forward = normalize(transformDirection(model, [0, 0, -1]));
          const right = normalize(transformDirection(model, [1, 0, 0]));
          const up = normalize(transformDirection(model, [0, 1, 0]));
          const corners = [
            addScaled(addScaled(addScaled(eye, forward, 1.15), right, 0.55), up, 0.34),
            addScaled(addScaled(addScaled(eye, forward, 1.15), right, -0.55), up, 0.34),
            addScaled(addScaled(addScaled(eye, forward, 1.15), right, -0.55), up, -0.34),
            addScaled(addScaled(addScaled(eye, forward, 1.15), right, 0.55), up, -0.34)
          ];
          const color = selected ? [0.55, 0.92, 1.0] : cameraColor;
          for (const corner of corners) pushLine(vertices, eye, corner, color);
          for (let index = 0; index < 4; index++) pushLine(vertices, corners[index], corners[(index + 1) % 4], color);
          pushLine(vertices, eye, addScaled(eye, up, 0.45), color);
        } else if (entity.type === 'Light') {
          const position = transformPoint(model, [0, 0, 0]);
          const directional = mentions(entity, 'directional') || mentions(entity, 'sun');
          const color = selected ? [1.0, 0.92, 0.62] : lightColor;
          if (directional) {
            const direction = normalize(transformDirection(model, [0, 0, -1]));
            const tip = addScaled(position, direction, 1.4);
            pushLine(vertices, position, tip, color);
            const right = normalize(cross(direction, [0, 1, 0]));
            if (Number.isFinite(right[0])) {
              pushLine(vertices, tip, addScaled(addScaled(tip, direction, -0.35), right, 0.18), color);
              pushLine(vertices, tip, addScaled(addScaled(tip, direction, -0.35), right, -0.18), color);
            }
          } else {
            for (let ray = 0; ray < 6; ray++) {
              const angle = 2 * PI * ray / 6;
              pushLine(vertices, position, [position[0] + Math.cos(angle) * 0.45, position[1], position[2] + Math.sin(angle) * 0.45], color);
            }
            pushLine(vertices, [position[0], position[1] + 0.45, position[2]], [position[0], position[1] - 0.45, position[2]], color);
          }
        } else if (selected && (entity.type === 'Empty' || entity.type === 'Audio')) {
          const position = transformPoint(model, [0, 0, 0]);
          const color = entity.type === 'Audio' ? [0.65, 0.75, 0.9] : [0.45, 0.85, 1.0];
          const extent = entity.type === 'Audio' ? 0.3 : 0.5;
          pushLine(vertices, [position[0] - extent, position[1], position[2]], [position[0] + extent, position[1], position[2]], color);
          pushLine(vertices, [position[0], position[1] - extent, position[2]], [position[0], position[1] + extent, position[2]], color);
          pushLine(vertices, [position[0], position[1], position[2] - extent], [position[0], position[1], position[2] + extent], color);
        }
      }
      return new Float32Array(vertices);
    }

    function draw() {
      frameHandle = 0;
      if (disposed || !scene) return;
      resize();
      updateMatrices();
      const width = canvas.width, height = canvas.height;
      const renderTargets = ensureTargets(width, height);
      const lights = lighting();

      // 1. Linear HDR scene: sky, grid and meshes render into RGBA16F.
      gl.bindFramebuffer(gl.FRAMEBUFFER, renderTargets.scene.framebuffer);
      gl.viewport(0, 0, width, height);
      // gl.clear() honours the depth write mask. The bloom/composite/overlay
      // passes at the end of draw() leave depthMask(false), so without this the
      // depth buffer kept the previous frame and stale depths rejected geometry
      // as soon as the camera moved (meshes vanished during orbiting).
      gl.depthMask(true);
      gl.clearColor(0.02, 0.03, 0.06, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(skyProgram);
      gl.uniform2f(skyUniforms.resolution, width, height);
      gl.bindVertexArray(skyArray);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      // The grid is a reference plane, not geometry: it must never occlude
      // meshes. Without depth writes it is still drawn behind the sky, but a
      // camera at a grazing angle can no longer hide the whole scene behind it.
      gl.depthMask(false);
      gl.useProgram(gridProgram);
      gl.uniformMatrix4fv(gridUniforms.viewProjection, false, state.viewProjection);
      gl.uniform3fv(gridUniforms.cameraPosition, state.cameraPosition);
      gl.bindVertexArray(gridArray);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.depthMask(true);
      gl.useProgram(meshProgram);
      gl.uniformMatrix4fv(meshUniforms.viewProjection, false, state.viewProjection);
      gl.uniform3fv(meshUniforms.cameraPosition, state.cameraPosition);
      gl.uniform3fv(meshUniforms.ambientSky, lights.ambientSky);
      gl.uniform3fv(meshUniforms.ambientGround, lights.ambientGround);
      gl.uniform1i(meshUniforms.lightCount, lights.lights.length);
      if (lights.lights.length) {
        gl.uniform1iv(meshUniforms.lightType, lights.lights.map(light => light.type));
        gl.uniform3fv(meshUniforms.lightPosition, lights.lights.flatMap(light => light.position));
        gl.uniform3fv(meshUniforms.lightDirection, lights.lights.flatMap(light => light.direction));
        gl.uniform3fv(meshUniforms.lightColor, lights.lights.flatMap(light => light.color));
        gl.uniform1fv(meshUniforms.lightRange, lights.lights.map(light => light.range));
        gl.uniform1fv(meshUniforms.lightCosOuter, lights.lights.map(light => light.cosOuter));
        gl.uniform1fv(meshUniforms.lightCosInner, lights.lights.map(light => light.cosInner));
      }
      gl.uniform1i(meshUniforms.texture, 0);
      gl.activeTexture(gl.TEXTURE0);

      let triangleCount = 0;
      let meshCount = 0;
      for (const entity of scene.entities) {
        if (!entity.visible || (entity.type !== 'Mesh' && entity.type !== 'Prefab')) continue;
        const mesh = meshes[meshKind(entity)];
        const model = worldMatrix(entity);
        gl.uniformMatrix4fv(meshUniforms.model, false, model);
        gl.uniformMatrix3fv(meshUniforms.normalMatrix, false, normalMatrix(model));
        const material = materialFor(entity);
        gl.uniform3fv(meshUniforms.albedo, material.albedo);
        gl.uniform1f(meshUniforms.metallic, material.metallic);
        gl.uniform1f(meshUniforms.roughness, material.roughness);
        gl.uniform1i(meshUniforms.pattern, material.patternId);
        gl.uniform1f(meshUniforms.tiling, material.tiling);
        gl.uniform1f(meshUniforms.emissive, material.emissive ? 1 : 0);
        gl.uniform1f(meshUniforms.selected, entity.id === selectedId ? 1 : 0);
        const texture = material.texture ? textureFor(material.texture) : null;
        const useTexture = !!(texture && texture.ready);
        gl.bindTexture(gl.TEXTURE_2D, useTexture ? texture.texture : null);
        gl.uniform1i(meshUniforms.hasTexture, useTexture ? 1 : 0);
        gl.bindVertexArray(mesh.vertexArray);
        gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
        triangleCount += mesh.indexCount / 3;
        meshCount++;
      }

      // 2. Bloom: half-resolution bright pass then separable Gaussian blur.
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, renderTargets.bloomA.framebuffer);
      gl.viewport(0, 0, renderTargets.bloomA.width, renderTargets.bloomA.height);
      gl.useProgram(brightProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, renderTargets.scene.texture);
      gl.uniform1i(brightUniforms.scene, 0);
      gl.uniform1f(brightUniforms.threshold, 1.0);
      gl.uniform1f(brightUniforms.knee, 0.6);
      gl.bindVertexArray(fullscreenArray);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(blurProgram);
      gl.uniform1i(blurUniforms.source, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, renderTargets.bloomB.framebuffer);
      gl.viewport(0, 0, renderTargets.bloomB.width, renderTargets.bloomB.height);
      gl.bindTexture(gl.TEXTURE_2D, renderTargets.bloomA.texture);
      gl.uniform2f(blurUniforms.direction, 1 / renderTargets.bloomA.width, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, renderTargets.bloomA.framebuffer);
      gl.viewport(0, 0, renderTargets.bloomA.width, renderTargets.bloomA.height);
      gl.bindTexture(gl.TEXTURE_2D, renderTargets.bloomB.texture);
      gl.uniform2f(blurUniforms.direction, 0, 1 / renderTargets.bloomB.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 3. Composite: exposure, bloom add and ACES/sRGB to the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(compositeProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, renderTargets.scene.texture);
      gl.uniform1i(compositeUniforms.scene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, renderTargets.bloomA.texture);
      gl.uniform1i(compositeUniforms.bloom, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(compositeUniforms.exposure, 1.0);
      gl.uniform1f(compositeUniforms.bloomIntensity, 0.45);
      gl.uniform1f(compositeUniforms.bloomEnabled, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 4. Selection/editor overlays stay crisp on top of the tone-mapped image.
      const overlay = buildOverlayLines();
      if (overlay.length) {
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.useProgram(lineProgram);
        gl.uniformMatrix4fv(lineUniforms.viewProjection, false, state.viewProjection);
        gl.bindVertexArray(lineArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, overlay, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, overlay.length / 6);
      }
      gl.bindVertexArray(null);
      if (statsCallback) statsCallback({ triangles: triangleCount, meshes: meshCount, lights: lights.lights.length, width, height, backend: 'WebGL2', hdr: colorFormat === gl.RGBA16F, bloom: true });
    }

    function requestRender() {
      dirty = true;
      if (frameHandle || disposed) return;
      frameHandle = requestAnimationFrame(draw);
    }

    function setScene(nextScene) {
      if (playing) stopPlay(true);
      scene = nextScene;
      syncCamera();
      requestRender();
    }
    function setSelection(id) { selectedId = id || null; requestRender(); }
    function capture() {
      if (!scene) return null;
      resize();
      draw();
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0;
      let minX = canvas.width, maxX = -1, minY = canvas.height, maxY = -1;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const index = (y * canvas.width + x) * 4;
          if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 90) {
            lit++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const center = (Math.floor(canvas.height / 2) * canvas.width + Math.floor(canvas.width / 2)) * 4;
      return {
        width: canvas.width,
        height: canvas.height,
        lit,
        bounds: maxX >= 0 ? [minX, minY, maxX, maxY] : null,
        center: [pixels[center], pixels[center + 1], pixels[center + 2], pixels[center + 3]]
      };
    }
    function frameScene() {
      const bounds = sceneBounds();
      orbit.target = bounds.center.slice();
      orbit.distance = Math.min(200, Math.max(2, bounds.radius * 2.7));
      orbitInitialized = true;
      dirty = true;
      requestRender();
    }

    function pick(clientX, clientY) {
      if (!scene) return null;
      resize();
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / Math.max(rect.width, 1) * 2 - 1;
      const y = 1 - (clientY - rect.top) / Math.max(rect.height, 1) * 2;
      updateMatrices();
      const inverse = invert(state.viewProjection);
      if (!inverse) return null;
      const nearPoint = transformPoint(inverse, [x, y, -1]);
      const farPoint = transformPoint(inverse, [x, y, 1]);
      const origin = nearPoint;
      const direction = normalize(subtract(farPoint, nearPoint));
      let bestId = null, bestDistance = Infinity;
      for (const entity of scene.entities) {
        if (!entity.visible) continue;
        const model = worldMatrix(entity);
        const inverseModel = invert(model);
        if (!inverseModel) continue;
        const localOrigin = transformPoint(inverseModel, origin);
        const localDirection = normalize(transformDirection(inverseModel, direction));
        const bounds = entity.type === 'Mesh' || entity.type === 'Prefab'
          ? [[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]]
          : [[-0.36, -0.36, -0.36], [0.36, 0.36, 0.36]];
        let tMin = -Infinity, tMax = Infinity;
        for (let axis = 0; axis < 3; axis++) {
          if (Math.abs(localDirection[axis]) < 1e-9) {
            if (localOrigin[axis] < bounds[0][axis] || localOrigin[axis] > bounds[1][axis]) { tMin = Infinity; break; }
            continue;
          }
          const t1 = (bounds[0][axis] - localOrigin[axis]) / localDirection[axis];
          const t2 = (bounds[1][axis] - localOrigin[axis]) / localDirection[axis];
          tMin = Math.max(tMin, Math.min(t1, t2));
          tMax = Math.min(tMax, Math.max(t1, t2));
        }
        if (tMin <= tMax && tMax > 0 && tMin < bestDistance) { bestDistance = Math.max(tMin, 0); bestId = entity.id; }
      }
      return bestId;
    }

    let dragging = null;
    function onPointerDown(event) {
      if (event.button !== 0 && event.button !== 2 && event.button !== 1) return;
      canvas.setPointerCapture(event.pointerId);
      dragging = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, button: event.button, moved: 0, pan: event.button !== 0 || event.shiftKey };
      canvas.style.cursor = 'grabbing';
    }
    function onPointerMove(event) {
      if (!dragging) return;
      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      dragging.moved += Math.abs(dx) + Math.abs(dy);
      if (playing && activePlayer()) {
        playYaw -= dx * 0.22;
        playPitch = Math.max(-89, Math.min(89, playPitch - dy * 0.22));
      } else if (dragging.pan) {
        const scale = orbit.distance * 0.0022;
        orbit.target = addScaled(orbit.target, state.right, -dx * scale);
        orbit.target = addScaled(orbit.target, state.up, dy * scale);
      } else {
        orbit.yaw -= dx * 0.006;
        orbit.pitch = Math.max(-1.45, Math.min(1.45, orbit.pitch + dy * 0.006));
      }
      requestRender();
    }
    function onPointerUp(event) {
      if (!dragging) return;
      const wasClick = dragging.moved < 5 && dragging.button === 0 && !dragging.pan;
      dragging = null;
      canvas.style.cursor = 'crosshair';
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
      if (wasClick && !playing && selectCallback) {
        const picked = pick(event.clientX, event.clientY);
        if (picked) selectCallback(picked);
      }
    }
    function onWheel(event) {
      event.preventDefault();
      orbit.distance = Math.max(0.8, Math.min(220, orbit.distance * Math.exp(event.deltaY * 0.0012)));
      requestRender();
    }
    function onContextMenu(event) { event.preventDefault(); }
    function onDoubleClick() { if (!playing) frameScene(); }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    const observer = new ResizeObserver(() => { resize(); requestRender(); });
    observer.observe(canvas);
    const onWindowResize = () => { resize(); requestRender(); };
    window.addEventListener('resize', onWindowResize);
    canvas.style.touchAction = 'none';

    requestRender();

    return {
      setScene,
      setSelection,
      frameScene,
      requestRender,
      resize,
      pick,
      capture,
      setPlaying,
      getPlayStats: () => ({ ...playStats }),
      isPlaying: () => playing,
      getStats: () => ({ backend: 'WebGL2', hdr: colorFormat === gl.RGBA16F, bloom: true }),
      dispose() {
        if (playing) stopPlay(true);
        disposed = true;
        observer.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContextMenu);
        canvas.removeEventListener('dblclick', onDoubleClick);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('resize', onWindowResize);
        if (frameHandle) cancelAnimationFrame(frameHandle);
        if (playHandle) cancelAnimationFrame(playHandle);
        releaseTargets();
        for (const entry of textureCache.values()) {
          gl.deleteTexture(entry.texture);
        }
        textureCache.clear();
        for (const name of ['meshProgram', 'lineProgram', 'gridProgram', 'skyProgram', 'brightProgram', 'blurProgram', 'compositeProgram']) {
          const value = { meshProgram, lineProgram, gridProgram, skyProgram, brightProgram, blurProgram, compositeProgram }[name];
          if (value) gl.deleteProgram(value);
        }
        gl.deleteVertexArray(fullscreenArray);
      }
    };
  }

  window.NovaViewport3D = { create };
})();
