import { getPlaces, getRoadNeighbors } from "./road-graph.js";
import { createParcels } from "./parcels.js";

/**
 * Builds a validated, independent simulation state. Parcel records are copied
 * so subsequent robot moves can use immutable state transitions.
 * @param {string} robotPlace - Initial landmark occupied by the robot.
 * @param {Object[]} parcels - Parcels with IDs, origins, and destinations.
 */
export function createPatersonState(
  robotPlace = "Paterson City Hall",
  parcels = createParcels(),
) {
  // Landmark IDs used to validate the robot and parcel locations.
  const places = getPlaces();
  // Detect parcel identifiers that would make state updates ambiguous.
  const ids = new Set();

  if (!places.includes(robotPlace)) {
    throw new Error(`Unknown robot location: "${robotPlace}".`);
  }

  for (const parcel of parcels) {
    if (!places.includes(parcel.place) || !places.includes(parcel.address)) {
      throw new Error(`Parcel "${parcel.id}" contains an unknown location.`);
    }

    if (parcel.place === parcel.address) {
      throw new Error(`Parcel "${parcel.id}" is already at its destination.`);
    }

    if (ids.has(parcel.id)) {
      throw new Error(`Duplicate parcel ID: "${parcel.id}".`);
    }

    ids.add(parcel.id);
  }

  return {
    robotPlace,
    parcels: parcels.map((parcel) => ({ ...parcel })),
    steps: 0,
    deliveries: 0,
  };
}

/**
 * Move one edge and update parcels carried to or delivered at the new place.
 * @param {Object} state - Current immutable simulation snapshot.
 * @param {string} destination - Directly connected next landmark.
 */
export function moveRobot(state, destination) {
  if (!getRoadNeighbors(state.robotPlace).includes(destination)) {
    throw new Error(
      `No direct road from "${state.robotPlace}" to "${destination}".`,
    );
  }

  // Parcels not yet delivered and the deliveries completed on this move.
  const remainingParcels = [];
  let deliveredThisTurn = 0;

  // Copy each parcel so this transition does not mutate the previous state.
  for (const parcel of state.parcels) {
    // Working copy whose location can advance with the robot.
    const updatedParcel = { ...parcel };

    // Parcels at the old location travel with the robot.
    if (updatedParcel.place === state.robotPlace) {
      updatedParcel.place = destination;
    }

    if (updatedParcel.place === updatedParcel.address) {
      deliveredThisTurn++;
    } else {
      remainingParcels.push(updatedParcel);
    }
  }

  // Return a fresh snapshot so callers can retain earlier states or histories.
  return {
    robotPlace: destination,
    parcels: remainingParcels,
    steps: state.steps + 1,
    deliveries: state.deliveries + deliveredThisTurn,
  };
}
