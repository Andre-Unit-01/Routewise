// Hand-authored district geometry retained as static layout/test data; the
// interactive map renders the OSM-derived network in paterson-route.js.
// Geographic origin and scale shared with the scene's local projection.
const districtCenter = [40.9169, -74.1724];
const sceneScale = 0.012;
const metersPerDegreeLongitude =
  111320 * Math.cos((districtCenter[0] * Math.PI) / 180);

// Convert a scene-space point back into geographic coordinates for test data.
function coordinateFromWorld(x, z) {
  return [
    districtCenter[0] - z / (sceneScale * 111132),
    districtCenter[1] + x / (sceneScale * metersPerDegreeLongitude),
  ];
}

// Extents and interior grid lines for the hand-authored district layout.
const districtBounds = { west: -8, east: 8, north: -4.9, south: 4.9 };
const districtGridCoordinates = {
  x: [-7.2, -4.8, 4.8, 7.2],
  z: [-2.4, 2.4],
};

export const districtGridRoads = [
  {
    name: "District perimeter",
    type: "residential",
    points: [
      coordinateFromWorld(districtBounds.west, districtBounds.north),
      coordinateFromWorld(districtBounds.east, districtBounds.north),
      coordinateFromWorld(districtBounds.east, districtBounds.south),
      coordinateFromWorld(districtBounds.west, districtBounds.south),
      coordinateFromWorld(districtBounds.west, districtBounds.north),
    ],
  },
  ...districtGridCoordinates.x.map((x, index) => ({
    name: `North-South Street ${index + 1}`,
    type: "residential",
    points: [
      coordinateFromWorld(x, districtBounds.north),
      coordinateFromWorld(x, districtBounds.south),
    ],
  })),
  ...districtGridCoordinates.z.map((z, index) => ({
    name: `East-West Street ${index + 1}`,
    type: "residential",
    points: [
      coordinateFromWorld(districtBounds.west, z),
      coordinateFromWorld(districtBounds.east, z),
    ],
  })),
];

// Smaller hand-authored street sample retained for map connectivity tests.
export const downtownPatersonRoads = [
  {
    name: "Church Street",
    type: "residential",
    points: [
      [40.918936, -74.170398],
      [40.918868, -74.170402],
      [40.918838, -74.170404],
      [40.918284, -74.17044],
      [40.91821, -74.170445],
    ],
  },
  {
    name: "Broadway",
    type: "primary",
    points: [
      [40.918991, -74.171969],
      [40.918939, -74.170481],
      [40.918936, -74.170398],
    ],
  },
  {
    name: "Washington Street",
    type: "residential",
    points: [
      [40.918991, -74.171969],
      [40.918929, -74.172029],
      [40.918921, -74.172035],
      [40.918882, -74.17206],
      [40.918358, -74.172087],
      [40.918336, -74.172093],
      [40.918266, -74.172111],
    ],
  },
  {
    name: "Van Houten Street",
    type: "primary",
    points: [
      [40.91821, -74.170445],
      [40.918212, -74.170502],
      [40.918266, -74.172111],
    ],
  },
];

// Generated sample lot coordinates for the hand-authored district grid.
export const districtLots = [];

// Generate evenly spaced parcel/lot sample coordinates within the district.
for (let z = -4.5, row = 0; z <= 4.5; z += 0.62, row += 1) {
  for (let x = -7.6; x <= 7.6; x += 0.62) {
    districtLots.push(coordinateFromWorld(x + (row % 2) * 0.12, z));
  }
}
