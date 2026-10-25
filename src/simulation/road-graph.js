import { patersonLandmarks } from "./paterson-landmarks.js";

// Named road links form the compact undirected graph used by example strategies.
// This small named-landmark graph powers the example robot strategies and
// simulation tests; the dashboard's detailed 3D tour uses paterson-route.js.
export const patersonRoadConnections = [
  {
    from: "Paterson City Hall",
    to: "First Baptist Church",
    street: "Washington Street",
  },
  {
    from: "Paterson City Hall",
    to: "Paterson Adult & Continuing Education",
    street: "Ellison Street",
  },
  {
    from: "Paterson City Hall",
    to: "Old Fabian Theater",
    street: "Church Street",
  },
  {
    from: "Old Fabian Theater",
    to: "Masjid Jalalabad",
    street: "Van Houten Street",
  },
  {
    from: "Paterson City Hall",
    to: "Passaic County Court House Annex",
    street: "Hamilton Street",
  },
  {
    from: "First Baptist Church",
    to: "Old Fabian Theater",
    street: "Church Street",
  },
  {
    from: "First Baptist Church",
    to: "Lou Costello Memorial Park",
    street: "Ellison Street",
  },
  {
    from: "Paterson Adult & Continuing Education",
    to: "Saint Paul's Lutheran Church",
    street: "Smith Street",
  },
  {
    from: "Paterson Adult & Continuing Education",
    to: "Old Fabian Theater",
    street: "Church Street",
  },
  {
    from: "Saint Paul's Lutheran Church",
    to: "Passaic County Court House Annex",
    street: "Hamilton Street",
  },
  {
    from: "Passaic County Court House Annex",
    to: "Passaic County Court House",
    street: "Hamilton Street",
  },
  {
    from: "Passaic County Court House Annex",
    to: "First Presbyterian Church",
    street: "Cianci Street",
  },
  {
    from: "Passaic County Court House",
    to: "Passaic County Superior Court",
    street: "Hamilton Street",
  },
  {
    from: "Passaic County Court House",
    to: "First Presbyterian Church",
    street: "Market Street",
  },
  {
    from: "Passaic County Superior Court",
    to: "Saint Michael the Archangel Church",
    street: "Market Street",
  },
  {
    from: "First Presbyterian Church",
    to: "Saint Michael the Archangel Church",
    street: "Cianci Street",
  },
  {
    from: "First Presbyterian Church",
    to: "Paterson Museum",
    street: "Market Street",
  },
  {
    from: "Saint Michael the Archangel Church",
    to: "Federici Park",
    street: "Market Street",
  },
  {
    from: "Federici Park",
    to: "Lou Costello Memorial Park",
    street: "Passaic Street",
  },
  {
    from: "Lou Costello Memorial Park",
    to: "Paterson Museum",
    street: "Market Street",
  },
];

// Initialize an empty adjacency list for every known landmark.
export const roadGraph = Object.fromEntries(
  patersonLandmarks.map(({ name }) => [name, []]),
);

// Store every listed road as an undirected connection.
for (const { from, to } of patersonRoadConnections) {
  roadGraph[from].push(to);
  roadGraph[to].push(from);
}

// Coordinates for graph landmarks, keyed by the same display names.
export const placeCoordinates = Object.fromEntries(
  patersonLandmarks.map(({ name, coordinates }) => [name, coordinates]),
);

/** Returns direct graph neighbors, or an empty array for an unknown name. */
export function getRoadNeighbors(place) {
  return roadGraph[place] ?? [];
}

export function hasRoad(from, to) {
  // Membership means both landmarks share a direct graph edge.
  return getRoadNeighbors(from).includes(to);
}

/** Returns all landmark IDs in graph insertion order. */
export function getPlaces() {
  return Object.keys(roadGraph);
}

export function getPlaceCoordinates(place) {
  // Coordinate lookup is guarded so invalid place names fail explicitly.
  const coordinates = placeCoordinates[place];
  if (!coordinates) {
    throw new Error(`Unknown Paterson location: "${place}".`);
  }

  return [...coordinates];
}

export function validateRoadGraph(graph = roadGraph) {
  // Every edge must reference a known node and have its reverse adjacency.
  for (const [place, neighbors] of Object.entries(graph)) {
    for (const neighbor of neighbors) {
      if (!graph[neighbor]) {
        throw new Error(
          `Unknown location "${neighbor}" connected to "${place}".`,
        );
      }

      if (!graph[neighbor].includes(place)) {
        throw new Error(
          `Road between "${place}" and "${neighbor}" is not bidirectional.`,
        );
      }
    }
  }

  return true;
}
