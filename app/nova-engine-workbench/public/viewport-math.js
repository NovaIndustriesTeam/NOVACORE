/*
 * Nova Engine — viewport orbit math.
 * Dependency-free helpers shared by the WebGL2 viewport and its regression
 * test (test-viewport.mjs loads this file in a VM sandbox, so the exact code
 * that runs in the browser is the code under test).
 */
(function (scope) {
  'use strict';

  // The editor grid is a single quad on this plane. It is a reference only:
  // it must never hide scene geometry, and the orbit camera must not sink
  // through it (see GRID_FRAGMENT and draw() in viewport-3d.js).
  const GRID_PLANE_Y = 0;
  const CAMERA_FLOOR_MARGIN = 0.08;

  function orbitEye(target, yaw, pitch, distance) {
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    return [
      target[0] + distance * cosPitch * Math.sin(yaw),
      target[1] + distance * sinPitch,
      target[2] + distance * cosPitch * Math.cos(yaw)
    ];
  }

  /*
   * Lowest pitch that keeps the eye above the grid plane. When the pivot is
   * below the plane the designer deliberately panned under the grid, so the
   * pitch is left untouched (-Infinity).
   */
  function minOrbitPitch(targetY, distance, floorY, margin) {
    const floor = Number.isFinite(floorY) ? floorY : GRID_PLANE_Y;
    const gap = Number.isFinite(margin) ? Math.max(0, margin) : CAMERA_FLOOR_MARGIN;
    if (!(targetY >= floor - 1e-6)) return -Infinity;
    const reach = Math.max(Math.abs(distance), 1e-4);
    const ratio = (floor + gap - targetY) / reach;
    return Math.asin(Math.max(-1, Math.min(1, ratio)));
  }

  function clampOrbitPitch(pitch, targetY, distance, floorY, margin) {
    const minimum = minOrbitPitch(targetY, distance, floorY, margin);
    if (!Number.isFinite(pitch)) return Math.max(0, minimum);
    return Math.max(pitch, minimum);
  }

  const api = { GRID_PLANE_Y, CAMERA_FLOOR_MARGIN, orbitEye, minOrbitPitch, clampOrbitPitch };
  scope.NovaViewportMath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
