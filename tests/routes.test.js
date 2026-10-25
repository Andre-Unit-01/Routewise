import test from "node:test";
import assert from "node:assert/strict";
import { findRoute } from "../src/algorithms/find-route.js";
import { routeCost, twoOpt } from "../src/algorithms/two-opt.js";
import {
  getPlaceCoordinates,
  getPlaces,
  hasRoad,
  patersonRoadConnections,
  validateRoadGraph,
} from "../src/simulation/road-graph.js";
import { patersonLandmarks } from "../src/simulation/paterson-landmarks.js";
import {
  districtGridRoads,
  districtLots,
  downtownPatersonRoads,
} from "../src/simulation/paterson-district.js";
import { defaultRoute } from "../src/robots/route-robot.js";
import {
  patersonAddressLocations,
  patersonDeliveryStops,
  patersonRoutingAlgorithm,
  patersonStreetSegments,
  patersonRoute,
} from "../src/simulation/paterson-route.js";
import patersonOsmData from "../src/simulation/paterson-osm-data.json" with { type: "json" };
import {
  hasSceneClearance,
  layoutAddressBuildings,
  layoutParcelDropoffs,
} from "../src/simulation/scene-layout.js";
import {
  getRobotMoveDuration,
  MIN_SIMULATION_STEP_INTERVAL_MS,
  ROBOT_SPEED_SCENE_UNITS_PER_SECOND,
} from "../src/simulation/animation-settings.js";

// Shared geographic helpers let these tests compare generated scene routes
// against the bundled OSM geometry rather than checking only array shapes.
function coordinateKey(coordinate) {
  return coordinate.map((value) => value.toFixed(8)).join(",");
}

function coordinateToMeters([latitude, longitude]) {
  const centerLatitude = 40.9169;
  const centerLongitude = -74.1724;
  return {
    x:
      (longitude - centerLongitude) *
      111320 *
      Math.cos((centerLatitude * Math.PI) / 180),
    z: (centerLatitude - latitude) * 111132,
  };
}

function liesOnSameStreetSegment(first, second, streetSegment) {
  const start = coordinateToMeters(streetSegment.from);
  const end = coordinateToMeters(streetSegment.to);
  const points = [coordinateToMeters(first), coordinateToMeters(second)];
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  return points.every((point) => {
    const progress =
      ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared;
    const distance = Math.hypot(
      point.x - (start.x + progress * dx),
      point.z - (start.z + progress * dz),
    );
    return progress >= -1e-5 && progress <= 1 + 1e-5 && distance < 0.02;
  });
}

test("road graph is valid and bidirectional", () => {
  assert.equal(validateRoadGraph(), true);
});

test("vehicle travel time follows route distance at a fixed speed", () => {
  assert.equal(ROBOT_SPEED_SCENE_UNITS_PER_SECOND, 1.5);
  assert.equal(
    getRobotMoveDuration(patersonRoute[0], patersonRoute[0]),
    MIN_SIMULATION_STEP_INTERVAL_MS,
  );
  const longerMoveDuration = getRobotMoveDuration(
    patersonRoute[0],
    patersonRoute[1],
  );
  assert.ok(longerMoveDuration >= MIN_SIMULATION_STEP_INTERVAL_MS);
  assert.equal(
    getRobotMoveDuration(
      patersonRoute[0],
      patersonRoute[1],
    ),
    longerMoveDuration,
  );
  const origin = [40.9169, -74.1724];
  const shortMove = getRobotMoveDuration(origin, [40.9169, -74.1714]);
  const longMove = getRobotMoveDuration(origin, [40.9169, -74.1704]);
  assert.ok(shortMove > MIN_SIMULATION_STEP_INTERVAL_MS);
  assert.ok(Math.abs(longMove / shortMove - 2) < 0.001);
});

test("every displayed street endpoint connects to another street", () => {
  for (const [index, road] of downtownPatersonRoads.entries()) {
    for (const endpoint of [road.points[0], road.points.at(-1)]) {
      const hasJunction = downtownPatersonRoads.some(
        (otherRoad, otherIndex) =>
          otherIndex !== index &&
          otherRoad.points.some(
            ([latitude, longitude]) =>
              endpoint[0] === latitude && endpoint[1] === longitude,
          ),
      );

      assert.ok(hasJunction, `${road.name} has a dead end at ${endpoint}`);
    }
  }
});

test("the district has a connected road grid and lots across the landscape", () => {
  assert.equal(districtGridRoads.length, 7);
  assert.ok(districtLots.length > 300);

  const perimeter = districtGridRoads[0].points;
  const isOnPerimeter = ([latitude, longitude]) =>
    perimeter.slice(1).some((end, index) => {
      const start = perimeter[index];
      const onHorizontal =
        Math.abs(latitude - start[0]) < 1e-10 &&
        Math.abs(latitude - end[0]) < 1e-10 &&
        longitude >= Math.min(start[1], end[1]) - 1e-10 &&
        longitude <= Math.max(start[1], end[1]) + 1e-10;
      const onVertical =
        Math.abs(longitude - start[1]) < 1e-10 &&
        Math.abs(longitude - end[1]) < 1e-10 &&
        latitude >= Math.min(start[0], end[0]) - 1e-10 &&
        latitude <= Math.max(start[0], end[0]) + 1e-10;
      return onHorizontal || onVertical;
    });

  for (const road of districtGridRoads) {
    assert.ok(road.points.length >= 2);
    assert.ok(
      road.points.every(
        ([latitude, longitude]) =>
          latitude > 40.912 &&
          latitude < 40.922 &&
          longitude > -74.181 &&
          longitude < -74.164,
      ),
    );
    if (road !== districtGridRoads[0]) {
      assert.ok(
        isOnPerimeter(road.points[0]),
        `${road.name} start joins perimeter`,
      );
      assert.ok(
        isOnPerimeter(road.points.at(-1)),
        `${road.name} end joins perimeter`,
      );
    }
  }

  const latitudes = districtLots.map(([latitude]) => latitude);
  const longitudes = districtLots.map(([, longitude]) => longitude);
  assert.ok(Math.max(...latitudes) - Math.min(...latitudes) > 0.0064);
  assert.ok(Math.max(...longitudes) - Math.min(...longitudes) > 0.013);
  assert.deepEqual(patersonRoute[0], patersonRoute.at(-1));
});

test("robot visits each parcel destination on the road before delivery", () => {
  const stops = Object.values(patersonDeliveryStops);
  assert.equal(stops.length, 123);
  assert.equal(patersonAddressLocations.length, 123);
  assert.equal(patersonRoutingAlgorithm, "TSP (nearest-neighbor + 2-opt)");
  assert.deepEqual(
    Object.keys(patersonDeliveryStops).sort(),
    patersonAddressLocations.map(({ name }) => name).sort(),
  );
  assert.equal(
    new Set(patersonAddressLocations.map(({ osmId }) => osmId)).size,
    123,
  );
  assert.ok(
    patersonAddressLocations.every(
      ({ osmId, osmType, coordinates, city, country, number, street }) =>
        Number.isInteger(osmId) &&
        ["node", "way", "relation"].includes(osmType) &&
        coordinates.length === 2 &&
        city === "Paterson" &&
        country === "US" &&
        number.length > 0 &&
        street.length > 0,
    ),
  );
  assert.equal(new Set(stops.map(({ stopIndex }) => stopIndex)).size, 123);
  assert.deepEqual(
    Object.keys(patersonDeliveryStops).sort(),
    patersonAddressLocations.map(({ name }) => name).sort(),
  );
  assert.ok(
    stops.every(
      ({ stopIndex, coordinates, addressCoordinates, footprint, osmId }) =>
        Number.isInteger(stopIndex) &&
        patersonRoute[stopIndex] === coordinates &&
        addressCoordinates.length === 2 &&
        footprint.length === 2 &&
        Number.isInteger(osmId),
    ),
  );
  for (const [name, { coordinates }] of Object.entries(patersonDeliveryStops)) {
    const [latitude, longitude] = patersonAddressLocations.find(
      (address) => address.name === name,
    ).coordinates;
    const distance = Math.hypot(
      (latitude - coordinates[0]) * 111132,
      (longitude - coordinates[1]) *
        111320 *
        Math.cos((latitude * Math.PI) / 180),
    );
    assert.ok(
      distance < 100,
      `${name} was snapped ${distance}m from its place`,
    );
  }

  const latitudes = stops.map((stop) => stop.coordinates[0]);
  const longitudes = stops.map((stop) => stop.coordinates[1]);
  assert.ok(Math.max(...latitudes) - Math.min(...latitudes) > 0.01);
  assert.ok(Math.max(...longitudes) - Math.min(...longitudes) > 0.02);
});

test("all routed locations stay on real OSM street segments", () => {
  assert.equal(patersonOsmData.roads.length, 1050);
  for (const [index, point] of patersonRoute.slice(1).entries()) {
    const previous = patersonRoute[index];
    assert.ok(
      patersonStreetSegments.some((segment) =>
        liesOnSameStreetSegment(previous, point, segment),
      ),
      `TSP tour leaves the street network at ${coordinateKey(previous)} to ${coordinateKey(point)}`,
    );
  }
});

// The 3D map removes leaf branches and adds connectors between retained
// components; this checks the exact displayed graph stays connected and leafy.
test("the displayed street network is connected with no dead ends", () => {
  const adjacency = new Map();
  const key = (coordinate) =>
    coordinate.map((value) => value.toFixed(5)).join(",");

  for (const segment of patersonStreetSegments) {
    const from = key(segment.from);
    const to = key(segment.to);
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  }

  assert.ok(adjacency.size > 0);
  for (const [node, neighbors] of adjacency) {
    assert.ok(neighbors.size >= 2, `street node ${node} is a dead end`);
  }

  const visited = new Set();
  const queue = [adjacency.keys().next().value];
  visited.add(queue[0]);
  while (queue.length > 0) {
    const node = queue.pop();
    for (const neighbor of adjacency.get(node)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  assert.equal(
    visited.size,
    adjacency.size,
    "street network has disconnected sections",
  );
});

test("address buildings and tree placement clear streets and other buildings", () => {
  const streetWidths = {
    primary: 18,
    secondary: 17,
    tertiary: 15,
    residential: 12,
    service: 10,
  };
  const sceneRoadSegments = patersonStreetSegments.map((segment) => {
    const start = coordinateToMeters(segment.from);
    const end = coordinateToMeters(segment.to);
    return {
      start: { x: start.x * 0.012, z: start.z * 0.012 },
      end: { x: end.x * 0.012, z: end.z * 0.012 },
      width: (streetWidths[segment.type] ?? 8) * 0.012,
    };
  });
  const toScene = (coordinate) => {
    const point = coordinateToMeters(coordinate);
    return { x: point.x * 0.012, z: point.z * 0.012 };
  };
  const layout = layoutAddressBuildings(
    patersonAddressLocations,
    sceneRoadSegments,
    [],
    toScene,
  );
  assert.equal(layout.size, 123);

  const occupied = [];
  for (const address of patersonAddressLocations) {
    const building = layout.get(address.name);
    assert.ok(building);
    assert.ok(
      hasSceneClearance(
        building.position,
        building.radius,
        sceneRoadSegments,
        occupied,
      ),
      `${address.name} overlaps a street or previously placed building`,
    );
    occupied.push({
      position: building.position,
      radius: building.radius,
    });
    assert.equal(
      hasSceneClearance(building.position, 0.2, sceneRoadSegments, occupied),
      false,
      `a tree cannot be placed on ${address.name}`,
    );
  }
});

test("parcels sit beside their buildings without overlapping streets or buildings", () => {
  const streetWidths = {
    primary: 18,
    secondary: 17,
    tertiary: 15,
    residential: 12,
    service: 10,
  };
  const sceneRoadSegments = patersonStreetSegments.map((segment) => {
    const start = coordinateToMeters(segment.from);
    const end = coordinateToMeters(segment.to);
    return {
      start: { x: start.x * 0.012, z: start.z * 0.012 },
      end: { x: end.x * 0.012, z: end.z * 0.012 },
      width: (streetWidths[segment.type] ?? 8) * 0.012,
    };
  });
  const toScene = (coordinate) => {
    const point = coordinateToMeters(coordinate);
    return { x: point.x * 0.012, z: point.z * 0.012 };
  };
  const buildings = layoutAddressBuildings(
    patersonAddressLocations,
    sceneRoadSegments,
    [],
    toScene,
  );
  const occupied = [...buildings.values()].map(({ position, radius }) => ({
    position,
    radius,
  }));
  const parcels = patersonAddressLocations.map(({ name }, index) => ({
    id: index + 1,
    destination: name,
  }));
  const roadPositions = new Map(
    Object.entries(patersonDeliveryStops).map(([name, stop]) => [
      name,
      toScene(stop.coordinates),
    ]),
  );
  const parcelPositions = layoutParcelDropoffs(
    parcels,
    buildings,
    roadPositions,
    sceneRoadSegments,
    occupied,
  );

  assert.equal(parcelPositions.size, 123);
  for (const parcel of parcels) {
    const position = parcelPositions.get(parcel.id);
    const building = buildings.get(parcel.destination);
    assert.ok(position);
    assert.ok(
      hasSceneClearance(
        position,
        Math.hypot(0.125, 0.11) / 2,
        sceneRoadSegments,
        [],
      ),
      `${parcel.destination} parcel overlaps a street`,
    );

    const gapX = Math.max(
      0,
      Math.abs(position.x - building.position.x) -
        (0.125 + building.width) / 2,
    );
    const gapZ = Math.max(
      0,
      Math.abs(position.z - building.position.z) -
        (0.11 + building.depth) / 2,
    );
    assert.ok(Math.hypot(gapX, gapZ) >= 0.011);
    assert.ok(Math.hypot(gapX, gapZ) < 0.02);

    for (const other of buildings.values()) {
      assert.ok(
        Math.abs(position.x - other.position.x) >=
          (0.125 + other.width) / 2 ||
          Math.abs(position.z - other.position.z) >=
            (0.11 + other.depth) / 2,
        `${parcel.destination} parcel overlaps a building`,
      );
    }
  }
});

test("route between connected locations uses valid roads", () => {
  const route = findRoute("Paterson City Hall", "Paterson Museum");

  assert.ok(Array.isArray(route));

  let current = "Paterson City Hall";

  for (const next of route) {
    assert.equal(hasRoad(current, next), true);
    current = next;
  }

  assert.equal(current, "Paterson Museum");
});

test("route from a location to itself is empty", () => {
  assert.deepEqual(findRoute("Paterson City Hall", "Paterson City Hall"), []);
});

test("2-opt improves a closed route while retaining its starting location", () => {
  const distances = [
    [0, 10, 1, 10],
    [10, 0, 10, 1],
    [1, 10, 0, 10],
    [10, 1, 10, 0],
  ];
  const initialRoute = [0, 1, 2, 3];
  const improvedRoute = twoOpt(
    initialRoute,
    (from, to) => distances[from][to],
  );

  assert.equal(improvedRoute[0], initialRoute[0]);
  assert.ok(
    routeCost(improvedRoute, (from, to) => distances[from][to]) <
      routeCost(initialRoute, (from, to) => distances[from][to]),
  );
});

test("unknown locations throw an error", () => {
  assert.throws(() => findRoute("Atlantis", "Paterson City Hall"), /Unknown/);
});

test("all mapped Paterson landmarks have coordinates in Passaic County", () => {
  for (const place of getPlaces()) {
    const [latitude, longitude] = getPlaceCoordinates(place);
    assert.ok(latitude > 40.91 && latitude < 40.92);
    assert.ok(longitude > -74.18 && longitude < -74.17);
  }
});

test("every mapped landmark is connected to the downtown road network", () => {
  const reachable = new Set(["Paterson City Hall"]);
  const queue = ["Paterson City Hall"];

  while (queue.length > 0) {
    const place = queue.shift();
    for (const neighbor of getPlaces().filter((candidate) =>
      hasRoad(place, candidate),
    )) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  assert.deepEqual(
    [...reachable].sort(),
    patersonLandmarks.map(({ name }) => name).sort(),
  );
  assert.ok(
    patersonRoadConnections.every(
      ({ from, to, street }) =>
        getPlaces().includes(from) &&
        getPlaces().includes(to) &&
        street.length > 0,
    ),
  );
});

test("the default robot loop follows valid Paterson road connections", () => {
  for (let index = 0; index < defaultRoute.length - 1; index += 1) {
    assert.equal(
      hasRoad(defaultRoute[index], defaultRoute[index + 1]),
      true,
      `${defaultRoute[index]} to ${defaultRoute[index + 1]}`,
    );
  }
});
