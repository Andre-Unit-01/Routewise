import { getRoadNeighbors } from "../simulation/road-graph.js";

// A deterministic landmark loop used by the route-following strategy; each
// transition must also be an edge in the small landmark road graph.
export const defaultRoute = [
  "Paterson City Hall",
  "First Baptist Church",
  "Lou Costello Memorial Park",
  "Federici Park",
  "Saint Michael the Archangel Church",
  "First Presbyterian Church",
  "Passaic County Court House Annex",
  "Passaic County Court House",
  "Passaic County Superior Court",
  "Passaic County Court House",
  "Passaic County Court House Annex",
  "Saint Paul's Lutheran Church",
  "Paterson Adult & Continuing Education",
  "Old Fabian Theater",
  "Paterson City Hall",
];

/**
 * Chooses the next valid route location and returns the remaining route as
 * strategy memory. Invalid or exhausted routes stop the robot.
 * @param {Object} state - Current robot location and parcel state.
 * @param {Array} memory - Remaining route, defaulting to the fixed route.
 */
export function routeRobot(state, memory = defaultRoute) {
  if (!Array.isArray(memory) || memory.length === 0) {
    return {
      direction: null,
      memory: [],
    };
  }

  // Separate the next requested stop from the later route entries.
  const [next, ...remaining] = memory;

  // If the robot already occupies the first entry, advance to the next stop.
  const direction = next === state.robotPlace
    ? remaining[0]
    : next;

  // Preserve only route entries that have not been consumed yet.
  const nextMemory = next === state.robotPlace
    ? remaining.slice(1)
    : remaining;

  if (!direction || !getRoadNeighbors(state.robotPlace).includes(direction)) {
    return {
      direction: null,
      memory: [],
    };
  }

  return {
    direction,
    memory: nextMemory,
  };
}
