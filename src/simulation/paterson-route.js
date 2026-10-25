import patersonOsmData from "./paterson-osm-data.json" with { type: "json" };
import { twoOpt } from "../algorithms/two-opt.js";

// Convert the bundled geographic map to a local meter-based graph for planar
// intersections, shortest paths, and the TSP distance matrix.
const districtCenter = [40.9169, -74.1724];
// Projection constants approximate local meters around Paterson's center.
const metersPerDegreeLongitude =
  111320 * Math.cos((districtCenter[0] * Math.PI) / 180);
const metersPerDegreeLatitude = 111132;
// Source collections extracted from the committed OSM snapshot.
const { addresses: patersonAddresses, roads } = patersonOsmData;

// Adapt raw address records to the names used by the planner and scene.
export const patersonAddressLocations = patersonAddresses.map((address) => ({
  ...address,
  name: `${address.number} ${address.street}`,
}));

/** Project WGS84 coordinates into local meter-like x/z coordinates. */
function toLocal([latitude, longitude]) {
  return {
    x: (longitude - districtCenter[1]) * metersPerDegreeLongitude,
    z: (districtCenter[0] - latitude) * metersPerDegreeLatitude,
  };
}

/** Convert local planar coordinates back to latitude and longitude. */
function toCoordinate({ x, z }) {
  return [
    districtCenter[0] - z / metersPerDegreeLatitude,
    districtCenter[1] + x / metersPerDegreeLongitude,
  ];
}

/** Return the crossing point when two finite road segments intersect. */
function segmentIntersection(first, second) {
  const firstX = first.end.x - first.start.x;
  const firstZ = first.end.z - first.start.z;
  const secondX = second.end.x - second.start.x;
  const secondZ = second.end.z - second.start.z;
  const denominator = firstX * secondZ - firstZ * secondX;
  if (Math.abs(denominator) < 1e-8) return null;

  const offsetX = second.start.x - first.start.x;
  const offsetZ = second.start.z - first.start.z;
  const firstProgress =
    (offsetX * secondZ - offsetZ * secondX) / denominator;
  const secondProgress =
    (offsetX * firstZ - offsetZ * firstX) / denominator;
  if (
    firstProgress < -1e-8 ||
    firstProgress > 1 + 1e-8 ||
    secondProgress < -1e-8 ||
    secondProgress > 1 + 1e-8
  ) {
    return null;
  }

  return {
    progress: Math.max(0, Math.min(1, firstProgress)),
    point: {
      x: first.start.x + firstX * firstProgress,
      z: first.start.z + firstZ * firstProgress,
    },
  };
}

/**
 * Turns OSM road segments into a traversable graph: split crossings, prune
 * degree-one branches, connect disconnected components with synthetic links,
 * then snap each address to its nearest remaining road edge.
 */
/**
 * Build the retained street graph and associate each delivery with a graph node.
 * @param {Object[]} deliveryLocations - Address records to snap to road edges.
 */
function buildStreetNetwork(deliveryLocations) {
  const segments = roads.flatMap((road) =>
    road.points.slice(1).map((coordinate, index) => ({
      start: toLocal(road.points[index]),
      end: toLocal(coordinate),
      type: road.type,
      splitPoints: [
        { progress: 0, point: toLocal(road.points[index]) },
        { progress: 1, point: toLocal(coordinate) },
      ],
    })),
  );

  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < segments.length;
      secondIndex += 1
    ) {
      const crossing = segmentIntersection(
        segments[firstIndex],
        segments[secondIndex],
      );
      if (!crossing) continue;

      segments[firstIndex].splitPoints.push(crossing);
      const secondLength = Math.hypot(
        segments[secondIndex].end.x - segments[secondIndex].start.x,
        segments[secondIndex].end.z - segments[secondIndex].start.z,
      );
      const secondProgress =
        Math.hypot(
          crossing.point.x - segments[secondIndex].start.x,
          crossing.point.z - segments[secondIndex].start.z,
        ) / secondLength;
      segments[secondIndex].splitPoints.push({
        progress: secondProgress,
        point: crossing.point,
      });
    }
  }

  const nodes = new Map();
  const edges = new Map();
  /** Reuse graph nodes at matching rounded local coordinates. */
  function getNode(point) {
    const key = `${point.x.toFixed(3)},${point.z.toFixed(3)}`;
    let node = nodes.get(key);
    if (!node) {
      node = { key, point, edges: [] };
      nodes.set(key, node);
    }
    return node;
  }

  for (const segment of segments) {
    segment.splitPoints.sort((first, second) => first.progress - second.progress);
    const splitPoints = segment.splitPoints.filter(
      (splitPoint, index, all) =>
        index === 0 ||
        Math.abs(splitPoint.progress - all[index - 1].progress) > 1e-8,
    );
    for (let index = 1; index < splitPoints.length; index += 1) {
      const start = getNode(splitPoints[index - 1].point);
      const end = getNode(splitPoints[index].point);
      if (start.key === end.key) continue;

      const key = [start.key, end.key].sort().join("|");
      if (edges.has(key)) continue;

      const edge = { start, end, type: segment.type };
      edges.set(key, edge);
      start.edges.push(edge);
      end.edges.push(edge);
    }
  }

  const remainingEdges = new Set(edges.values());
  // Repeatedly remove degree-zero/one branches; removing one edge can expose
  // another dead end farther back along the same branch.
  const deadEnds = [...nodes.values()]
    .filter((node) => node.edges.length < 2)
    .map((node) => node);
  while (deadEnds.length > 0) {
    const node = deadEnds.pop();
    const activeEdges = node.edges.filter((edge) => remainingEdges.has(edge));
    if (activeEdges.length >= 2) continue;

    for (const edge of activeEdges) {
      remainingEdges.delete(edge);
      const next = edge.start === node ? edge.end : edge.start;
      next.edges.splice(next.edges.indexOf(edge), 1);
      node.edges.splice(node.edges.indexOf(edge), 1);
      if (next.edges.length < 2) deadEnds.push(next);
    }
  }

  for (const edge of edges.values()) {
    if (remainingEdges.has(edge)) continue;
    edge.start.edges = edge.start.edges.filter((candidate) => candidate !== edge);
    edge.end.edges = edge.end.edges.filter((candidate) => candidate !== edge);
  }
  for (const [key, node] of nodes) {
    if (node.edges.length === 0) nodes.delete(key);
  }

  // Keep every retained road component reachable to the tour by adding a
  // straight connector between its closest node and the connected network.
  const components = [];
  const unvisited = new Set(nodes.values());
  while (unvisited.size > 0) {
    const component = [];
    const queue = [unvisited.values().next().value];
    unvisited.delete(queue[0]);
    while (queue.length > 0) {
      const node = queue.pop();
      component.push(node);
      for (const edge of node.edges) {
        const next = edge.start === node ? edge.end : edge.start;
        if (!unvisited.delete(next)) continue;
        queue.push(next);
      }
    }
    components.push(component);
  }

  components.sort((first, second) => second.length - first.length);
  const connectedNodes = [...(components.shift() ?? [])];
  while (components.length > 0) {
    const component = components.shift();
    let closest = null;
    for (const from of connectedNodes) {
      for (const to of component) {
        const distance = Math.hypot(
          from.point.x - to.point.x,
          from.point.z - to.point.z,
        );
        if (!closest || distance < closest.distance) {
          closest = { from, to, distance };
        }
      }
    }
    if (!closest) {
      throw new Error("Unable to connect isolated street sections.");
    }

    const connector = {
      start: closest.from,
      end: closest.to,
      type: "residential",
    };
    remainingEdges.add(connector);
    closest.from.edges.push(connector);
    closest.to.edges.push(connector);
    connectedNodes.push(...component);
  }

  const stopNodes = new Map();
  for (const location of deliveryLocations) {
    const target = toLocal(location.coordinates);
    let nearest = null;
    for (const edge of remainingEdges) {
      const dx = edge.end.point.x - edge.start.point.x;
      const dz = edge.end.point.z - edge.start.point.z;
      const lengthSquared = dx * dx + dz * dz;
      const progress = Math.max(
        0,
        Math.min(
          1,
          ((target.x - edge.start.point.x) * dx +
            (target.z - edge.start.point.z) * dz) /
            lengthSquared,
        ),
      );
      const point = {
        x: edge.start.point.x + dx * progress,
        z: edge.start.point.z + dz * progress,
      };
      const distance = Math.hypot(target.x - point.x, target.z - point.z);
      if (!nearest || distance < nearest.distance) {
        nearest = { edge, point, distance };
      }
    }

    if (!nearest) {
      throw new Error(`Unable to snap "${location.name}" to a connected street.`);
    }

    const stopNode = getNode(nearest.point);
    if (stopNode !== nearest.edge.start && stopNode !== nearest.edge.end) {
      remainingEdges.delete(nearest.edge);
      nearest.edge.start.edges.splice(
        nearest.edge.start.edges.indexOf(nearest.edge),
        1,
      );
      nearest.edge.end.edges.splice(
        nearest.edge.end.edges.indexOf(nearest.edge),
        1,
      );
      const startEdge = {
        start: nearest.edge.start,
        end: stopNode,
        type: nearest.edge.type,
      };
      const endEdge = {
        start: stopNode,
        end: nearest.edge.end,
        type: nearest.edge.type,
      };
      remainingEdges.add(startEdge);
      remainingEdges.add(endEdge);
      nearest.edge.start.edges.push(startEdge);
      stopNode.edges.push(startEdge, endEdge);
      nearest.edge.end.edges.push(endEdge);
    }
    stopNodes.set(location.name, stopNode);
  }

  return { nodes, edges: [...remainingEdges], stopNodes };
}

/** Dijkstra shortest paths from one terminal, retaining predecessor links. */
function shortestPathsFrom(network, source) {
  const distances = new Map([[source, 0]]);
  const previous = new Map();
  // The binary min-heap makes Dijkstra's next-node selection efficient while
  // retaining each node's predecessor for later route reconstruction.
  const queue = [];
  /** Insert a node/distance pair into the binary min-heap. */
  function enqueue(node, distance) {
    let index = queue.length;
    queue.push({ node, distance });
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (queue[parentIndex].distance <= distance) break;
      queue[index] = queue[parentIndex];
      index = parentIndex;
    }
    queue[index] = { node, distance };
  }
  /** Remove and return the closest node/distance pair from the heap. */
  function dequeue() {
    const first = queue[0];
    const last = queue.pop();
    if (queue.length > 0) {
      let index = 0;
      while (index * 2 + 1 < queue.length) {
        let childIndex = index * 2 + 1;
        if (
          childIndex + 1 < queue.length &&
          queue[childIndex + 1].distance < queue[childIndex].distance
        ) {
          childIndex += 1;
        }
        if (queue[childIndex].distance >= last.distance) break;
        queue[index] = queue[childIndex];
        index = childIndex;
      }
      queue[index] = last;
    }
    return first;
  }

  enqueue(source, 0);
  while (queue.length > 0) {
    const { node: current, distance } = dequeue();
    if (distance !== distances.get(current)) continue;

    for (const edge of current.edges) {
      const next = edge.start === current ? edge.end : edge.start;
      const weight = Math.hypot(
        edge.end.point.x - edge.start.point.x,
        edge.end.point.z - edge.start.point.z,
      );
      const candidate = distance + weight;
      if (candidate < (distances.get(next) ?? Infinity)) {
        distances.set(next, candidate);
        previous.set(next, current);
        enqueue(next, candidate);
      }
    }
  }

  return { distances, previous };
}

/** Reconstruct a source-to-target node sequence from Dijkstra predecessors. */
function recoverPath(source, target, previous) {
  const path = [target];
  let current = target;
  while (current !== source) {
    current = previous.get(current);
    if (!current) {
      throw new Error("Delivery locations are disconnected on the street graph.");
    }
    path.push(current);
  }
  return path.reverse();
}

// Greedy initial ordering is fast and gives 2-opt a complete tour to improve.
/** Build the nearest-neighbor stop order with depot index zero fixed first. */
function createNearestNeighborOrder(distanceMatrix, stopCount) {
  const order = [0];
  const remaining = new Set(
    Array.from({ length: stopCount }, (_, index) => index + 1),
  );

  while (remaining.size > 0) {
    const current = order.at(-1);
    let nearest = null;
    for (const candidate of remaining) {
      if (
        nearest === null ||
        distanceMatrix[current][candidate] <
          distanceMatrix[current][nearest]
      ) {
        nearest = candidate;
      }
    }
    order.push(nearest);
    remaining.delete(nearest);
  }

  return order;
}

/** Build the OSM graph, optimize stop order, and expand it into street points. */
function createStreetTour() {
  const network = buildStreetNetwork(patersonAddressLocations);
  const center = toLocal(districtCenter);
  const start = [...network.nodes.values()].reduce((nearest, node) =>
    Math.hypot(node.point.x - center.x, node.point.z - center.z) <
    Math.hypot(nearest.point.x - center.x, nearest.point.z - center.z)
      ? node
      : nearest,
  );

  const terminals = [
    start,
    ...patersonAddressLocations.map(({ name }) => network.stopNodes.get(name)),
  ];
  if (terminals.some((node) => !node)) {
    throw new Error("Unable to locate every Paterson address on the streets.");
  }
  // Compute one shortest-path tree per depot/address, then reuse it both for
  // pairwise tour distances and for expanding each selected TSP leg.
  const pathsFromTerminals = terminals.map((source) =>
    shortestPathsFrom(network, source),
  );
  const distanceMatrix = terminals.map((_, fromIndex) =>
    terminals.map((target, toIndex) =>
      fromIndex === toIndex
        ? 0
        : pathsFromTerminals[fromIndex].distances.get(target),
    ),
  );
  const nearestNeighborOrder = createNearestNeighborOrder(
    distanceMatrix,
    patersonAddressLocations.length,
  );
  const order = twoOpt(
    nearestNeighborOrder,
    (from, to) => distanceMatrix[from][to],
  );
  // The optimizer uses a non-repeated depot; append it to close the street tour.
  const tourOrder = [...order, 0];
  const route = [toCoordinate(start.point)];
  const stopIndexes = new Map();
  for (let index = 1; index < tourOrder.length; index += 1) {
    const fromIndex = tourOrder[index - 1];
    const toIndex = tourOrder[index];
    const path = recoverPath(
      terminals[fromIndex],
      terminals[toIndex],
      pathsFromTerminals[fromIndex].previous,
    );
    if (toIndex > 0 && path.length === 1) {
      route.push(toCoordinate(path[0].point));
    } else {
      route.push(...path.slice(1).map((node) => toCoordinate(node.point)));
    }
    if (toIndex > 0) {
      stopIndexes.set(patersonAddressLocations[toIndex - 1].name, route.length - 1);
    }
  }

  return {
    route,
    addressStopIndexes: stopIndexes,
    segments: network.edges.map(({ start: from, end: to, type }) => ({
      from: toCoordinate(from.point),
      to: toCoordinate(to.point),
      type,
    })),
  };
}

// Build the expensive static street tour once when this module is imported.
const streetTour = createStreetTour();
// `patersonRoute` is a sequence of geographic coordinates, closed at its start;
// delivery stop indexes map named addresses to exact points on that sequence.
export const patersonRoute = streetTour.route;
export const patersonStreetSegments = streetTour.segments;
export const patersonRoutingAlgorithm = "TSP (nearest-neighbor + 2-opt)";
// Per-address metadata joins OSM identity/footprint to its route waypoint.
export const patersonDeliveryStops = Object.fromEntries(
  patersonAddressLocations.map(({ name, coordinates, footprint, osmId }) => {
    const baseStopIndex = streetTour.addressStopIndexes.get(name);
    return [
      name,
      {
        stopIndex: baseStopIndex,
        coordinates: patersonRoute[baseStopIndex],
        addressCoordinates: coordinates,
        footprint,
        osmId,
      },
    ];
  }),
);
