// Placement limits keep modeled objects inside the scene's ground plane.
const sceneBounds = { minX: -18.2, maxX: 18.2, minZ: -14.2, maxZ: 14.2 };

function seeded(index, salt = 0) {
  // A deterministic pseudo-random fraction keeps layout stable across runs.
  // Raw sine product before keeping only its fractional portion.
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Return the shortest planar distance from a point to a finite segment. */
function distanceToSegment(point, start, end) {
  // Segment direction and squared length support projection of the point.
  // Direction vector from the segment's start to its end.
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  // Squared segment length avoids taking a root for the projection ratio.
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.z - start.z);
  }

  // Clamp the projection to the finite segment rather than its infinite line.
  // Fraction of the segment closest to the point, constrained to its endpoints.
  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + progress * dx),
    point.z - (start.z + progress * dz),
  );
}

/**
 * Check scene bounds, road clearance, and circular obstacle footprints.
 * @param {Object} position - Candidate center in scene x/z coordinates.
 * @param {number} radius - Conservative circular footprint radius.
 * @param {Object[]} roadSegments - Street center lines and half-width inputs.
 * @param {Object[]} occupied - Previously placed centers and radii.
 */
export function hasSceneClearance(position, radius, roadSegments, occupied) {
  // Reject candidates whose circular footprint touches a road corridor.
  // A candidate must remain inside the map boundary with its full radius.
  if (
    position.x - radius <= sceneBounds.minX ||
    position.x + radius >= sceneBounds.maxX ||
    position.z - radius <= sceneBounds.minZ ||
    position.z + radius >= sceneBounds.maxZ
  ) {
    return false;
  }

  // Reject a point that falls within any road's width plus safety margin.
  if (
    roadSegments.some(
      ({ start, end, width }) =>
        distanceToSegment(position, start, end) <= width / 2 + 0.1 + radius,
    )
  ) {
    return false;
  }

  // Existing objects are represented by circles for inexpensive separation.
  return occupied.every(
    ({ position: other, radius: otherRadius }) =>
      Math.hypot(position.x - other.x, position.z - other.z) >
      radius + otherRadius + 0.07,
  );
}

// Try a deterministic, address-centered spiral so layout is stable across runs.
/**
 * Produce repeatable candidate centers around an address coordinate.
 * @param {number[]} coordinate - Address latitude and longitude.
 * @param {number} index - Stable address index used to vary the spiral angle.
 * @param {Function} toWorld - Projection from geographic to scene coordinates.
 */
function placementCandidates(coordinate, index, toWorld) {
  // Project the real address coordinate as the center of the search pattern.
  const origin = toWorld(coordinate);
  // Candidate at the address followed by progressively wider search rings.
  const candidates = [origin];
  const rings = [
    ...Array.from({ length: 9 }, (_, ring) => (ring + 1) * 0.12),
    ...Array.from({ length: 5 }, (_, ring) => 1.2 + ring * 0.12),
  ];
  // Rotate each address's rings deterministically to avoid aligned placements.
  const startAngle = seeded(index, 31) * Math.PI * 2;

  rings.forEach((radius) => {
    for (let direction = 0; direction < 16; direction += 1) {
      const angle = startAngle + (direction / 16) * Math.PI * 2;
      candidates.push({
        x: origin.x + Math.cos(angle) * radius,
        z: origin.z + Math.sin(angle) * radius,
      });
    }
  });

  return candidates;
}

/**
 * Finds clear scene positions for all mapped address buildings.
 * @param {Object[]} addresses - OSM address records and footprints.
 * @param {Object[]} roadSegments - Projected street segments and widths.
 * @param {Object[]} occupied - Existing scene obstacles, updated in place.
 * @param {Function} toWorld - Geographic-to-scene coordinate projection.
 */
export function layoutAddressBuildings(
  addresses,
  roadSegments,
  occupied,
  toWorld,
) {
  // Accepted layout records keyed by address name.
  const positions = new Map();

  addresses.forEach((address, index) => {
    // Convert each OSM footprint into a compact scene-space building size.
    const width = Math.max(0.12, Math.min(0.26, address.footprint[0] * 0.42));
    const depth = Math.max(0.12, Math.min(0.26, address.footprint[1] * 0.42));
    // Circular clearance bound conservatively covers the rectangular footprint.
    const radius = Math.hypot(width + 0.045, depth + 0.045) / 2;
    // First candidate with enough room from roads and previously placed objects.
    const position = placementCandidates(address.coordinates, index, toWorld).find(
      (candidate) =>
        hasSceneClearance(candidate, radius, roadSegments, occupied),
    );
    if (!position) {
      throw new Error(
        `Unable to place address building without overlap: "${address.name}".`,
      );
    }

    occupied.push({ position, radius });
    positions.set(address.name, { index, position, width, depth, radius });
  });

  return positions;
}

/**
 * Places each parcel immediately beside its destination building, preferring
 * the side facing the mapped delivery stop while avoiding roads and obstacles.
 */
export function layoutParcelDropoffs(
  parcels,
  buildings,
  roadPositions,
  roadSegments,
  occupied,
) {
  const parcelSize = { width: 0.125, depth: 0.11 };
  // Final candidate coordinates keyed by parcel ID.
  const placed = new Map();
  // Used to keep parcels for nearby addresses from occupying the same space.
  const parcelOccupied = [];
  // Snapshot entries once so every parcel can be checked against other buildings.
  const buildingEntries = [...buildings.entries()];
  // Remove address buildings from circle obstacles; they use rectangular checks.
  const obstacleEntries = occupied.filter(
    ({ position }) =>
      !buildingEntries.some(
        ([, building]) =>
          Math.hypot(
            position.x - building.position.x,
            position.z - building.position.z,
          ) < 1e-6,
      ),
  );

  for (const parcel of parcels) {
    // Find the building footprint and snapped road stop for this destination.
    const building = buildings.get(parcel.destination);
    const roadPosition = roadPositions.get(parcel.destination);
    if (!building || !roadPosition) {
      throw new Error(
        `Unable to place parcel at Paterson address "${parcel.destination}".`,
      );
    }

    // Direction from building center toward the assigned road stop.
    const towardRoadX = roadPosition.x - building.position.x;
    const towardRoadZ = roadPosition.z - building.position.z;
    // Try the road-facing side first, then the other sides as fallbacks.
    const sides = Math.abs(towardRoadX) >= Math.abs(towardRoadZ)
      ? [
          { x: Math.sign(towardRoadX) || 1, z: 0 },
          { x: 0, z: 1 },
          { x: 0, z: -1 },
          { x: -(Math.sign(towardRoadX) || 1), z: 0 },
        ]
      : [
          { x: 0, z: Math.sign(towardRoadZ) || 1 },
          { x: 1, z: 0 },
          { x: -1, z: 0 },
          { x: 0, z: -(Math.sign(towardRoadZ) || 1) },
        ];
    // Filled by the first legal candidate found around this building.
    let position;

    for (const side of sides) {
      // Choose the building/parcel extents along and across the selected side.
      const horizontal = side.x !== 0;
      const halfBuilding = horizontal ? building.width / 2 : building.depth / 2;
      const halfParcel = horizontal
        ? parcelSize.width / 2
        : parcelSize.depth / 2;
      // Keep a small visible gap between the parcel and building footprints.
      const offsetDistance = halfBuilding + halfParcel + 0.012;
      const alongExtent = horizontal
        ? Math.max(0, building.depth / 2 - parcelSize.depth / 2)
        : Math.max(0, building.width / 2 - parcelSize.width / 2);
      for (const along of [0, alongExtent, -alongExtent]) {
        // Candidate center aligned with the building center or either side edge.
        const candidate = {
          x: building.position.x + side.x * offsetDistance +
            (horizontal ? 0 : along),
          z: building.position.z + side.z * offsetDistance +
            (horizontal ? along : 0),
        };
        // Axis-aligned building footprints use rectangle intersection checks.
        const overlapsBuilding = buildingEntries.some(([, other]) =>
          Math.abs(candidate.x - other.position.x) <
            (parcelSize.width + other.width) / 2 &&
          Math.abs(candidate.z - other.position.z) <
            (parcelSize.depth + other.depth) / 2,
        );
        // Trees and other circular props are checked using their radii.
        const overlapsObstacle = obstacleEntries.some(
          ({ position: obstacle, radius }) =>
            Math.hypot(candidate.x - obstacle.x, candidate.z - obstacle.z) <=
            Math.hypot(parcelSize.width, parcelSize.depth) / 2 + radius,
        );
        // Keep delivered boxes separated from parcels already assigned.
        const overlapsParcel = parcelOccupied.some(
          ({ position: other }) =>
            Math.abs(candidate.x - other.x) <
              parcelSize.width + 0.01 &&
            Math.abs(candidate.z - other.z) < parcelSize.depth + 0.01,
        );
        // Accept only a candidate clear of buildings, props, parcels, and roads.
        if (
          overlapsBuilding ||
          overlapsObstacle ||
          overlapsParcel ||
          !hasSceneClearance(
            candidate,
            Math.hypot(parcelSize.width, parcelSize.depth) / 2,
            roadSegments,
            [],
          )
        ) {
          continue;
        }

        position = candidate;
        break;
      }
      if (position) break;
    }

    if (!position) {
      throw new Error(
        `Unable to place parcel beside its address building: "${parcel.destination}".`,
      );
    }

    placed.set(parcel.id, position);
    parcelOccupied.push({ position });
  }

  return placed;
}
