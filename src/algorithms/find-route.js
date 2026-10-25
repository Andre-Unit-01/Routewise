import { getRoadNeighbors, getPlaces } from "../simulation/road-graph.js";

/**
 * Finds a minimum-edge-count path in the landmark graph using breadth-first
 * search. The returned path excludes `from`; unreachable valid places yield
 * null, while unknown locations are rejected.
 * @param {string} from - Existing landmark at which the search begins.
 * @param {string} to - Existing landmark the search must reach.
 */
export function findRoute(from, to) {
  // Valid names are checked before the graph traversal begins.
  const places = getPlaces();

  if (!places.includes(from)) {
    throw new Error(`Unknown starting location: "${from}".`);
  }

  if (!places.includes(to)) {
    throw new Error(`Unknown destination: "${to}".`);
  }

  if (from === to) {
    return [];
  }

  // The array acts as a FIFO queue; visited-on-enqueue prevents duplicate work.
  // Each entry retains the path used to reach its current graph node.
  const work = [{ at: from, route: [] }];
  // Nodes are marked when queued so cycles cannot enqueue them repeatedly.
  const visited = new Set([from]);

  // Advancing the index consumes this array as a first-in, first-out queue.
  for (let i = 0; i < work.length; i++) {
    // `at` is the node being expanded and `route` is its path from the origin.
    const { at, route } = work[i];

    // Only roads directly connected to the current node are candidate hops.
    for (const neighbor of getRoadNeighbors(at)) {
      if (visited.has(neighbor)) {
        continue;
      }

      // Extend the queued path by one edge to reach this neighbor.
      const newRoute = [...route, neighbor];

      if (neighbor === to) {
        return newRoute;
      }

      visited.add(neighbor);
      work.push({ at: neighbor, route: newRoute });
    }
  }

  return null;
}
