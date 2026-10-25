import { findRoute } from "../algorithms/find-route.js";

/**
 * Targets a parcel already carried by the robot before collecting another
 * parcel. The graph search returns the next single road hop toward that target.
 * @param {Object} state - Current robot location and remaining parcels.
 */
export function smartRobot(state) {
  if (state.parcels.length === 0) {
    return null;
  }

  // Prefer a parcel already picked up by the robot.
  const carrying = state.parcels.filter(
    (parcel) => parcel.place === state.robotPlace,
  );

  // Otherwise, target the origin of the first parcel still waiting.
  const target = carrying.length > 0
    ? carrying[0].address
    : state.parcels[0].place;

  // Find the full landmark path; the strategy returns only the next hop.
  const route = findRoute(state.robotPlace, target);

  return route?.[0] ?? null;
}
