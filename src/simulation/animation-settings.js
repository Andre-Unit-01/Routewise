// These constants define the relationship between rendered scene distance and
// route-step timing; the minimum prevents zero-length hops from stalling.
export const MIN_SIMULATION_STEP_INTERVAL_MS = 80;
export const ROBOT_SPEED_SCENE_UNITS_PER_SECOND = 1.5;

const districtCenter = [40.9169, -74.1724];
// Longitude degrees shrink by latitude; this factor converts longitude offsets
// into approximate local meters around the district center.
const metersPerDegreeLongitude =
  111320 * Math.cos((districtCenter[0] * Math.PI) / 180);
// Approximate local meters represented by one latitude degree.
const metersPerDegreeLatitude = 111132;
// Keep world-space travel aligned with the scene's geographic projection.
const sceneScale = 0.012;

/**
 * Converts geographic displacement to a run duration at the configured speed.
 * @param {number[]} from - Origin latitude/longitude in decimal degrees.
 * @param {number[]} to - Destination latitude/longitude in decimal degrees.
 * @returns {number} Duration in milliseconds, subject to the configured floor.
 */
export function getRobotMoveDuration(from, to) {
  // Match the latitude/longitude projection and scale used by the 3D scene.
  // Horizontal and vertical offsets in scene units.
  const distanceX =
    (to[1] - from[1]) * metersPerDegreeLongitude * sceneScale;
  const distanceZ =
    (from[0] - to[0]) * metersPerDegreeLatitude * sceneScale;
  // Euclidean length of this projected route segment.
  const distance = Math.hypot(distanceX, distanceZ);
  return Math.max(
    MIN_SIMULATION_STEP_INTERVAL_MS,
    (distance / ROBOT_SPEED_SCENE_UNITS_PER_SECOND) * 1000,
  );
}
