import { getRoadNeighbors } from "../simulation/road-graph.js";

/**
 * Selects one directly connected neighbor uniformly at random. The memory
 * parameter is returned unchanged to match the strategy interface.
 * @param {Object} state - Current robot location and parcel state.
 * @param {Array} memory - Strategy memory carried between decisions.
 * @param {Function} random - Random source that returns a value in [0, 1).
 */
export function randomRobot(state, memory = [], random = Math.random) {
  // Only direct road neighbors are legal next moves.
  const options = getRoadNeighbors(state.robotPlace);

  if (options.length === 0) {
    return { direction: null, memory: [] };
  }

  // Convert the random sample into the index of a legal neighbor.
  const index = Math.floor(random() * options.length);

  return {
    direction: options[index],
    memory,
  };
}
