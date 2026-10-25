import { getPlaces } from "./road-graph.js";

/**
 * Creates a parcel only when both endpoints exist and are distinct.
 * @param {string} from - Landmark where the parcel starts.
 * @param {string} to - Different landmark where it must be delivered.
 * @param {string} id - Stable identifier; defaults to a UUID.
 */
export function createParcel(from, to, id = crypto.randomUUID()) {
  // Snapshot of valid landmark IDs used to validate both parcel endpoints.
  const places = getPlaces();

  if (!places.includes(from)) {
    throw new Error(`Unknown parcel location: "${from}".`);
  }

  if (!places.includes(to)) {
    throw new Error(`Unknown parcel destination: "${to}".`);
  }

  if (from === to) {
    throw new Error("Parcel location and destination must be different.");
  }

  return {
    id,
    place: from,
    address: to,
  };
}

/**
 * Generates parcels with different origin/destination locations.
 * @param {number} count - Number of parcels to create.
 * @param {Function} random - Random source used to select locations.
 */
export function createParcels(count = 5, random = Math.random) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Parcel count must be a non-negative integer.");
  }

  // Available graph locations and the output collection.
  const places = getPlaces();
  const parcels = [];

  // Each iteration selects one origin and one distinct destination.
  for (let i = 0; i < count; i++) {
    // Index of the selected origin.
    const placeIndex = Math.floor(random() * places.length);
    // Draw from one fewer destination, then skip over the origin index so a
    // generated parcel can never start at its own destination.
    let destinationIndex = Math.floor(random() * (places.length - 1));

    if (destinationIndex >= placeIndex) {
      destinationIndex++;
    }

    parcels.push(
      createParcel(
        places[placeIndex],
        places[destinationIndex],
        `parcel-${i + 1}`,
      ),
    );
  }

  return parcels;
}

/**
 * Reports delivery only when the parcel is both carried and at its address.
 * @param {Object} parcel - Parcel with current location and destination.
 * @param {string} robotPlace - Current landmark occupied by the robot.
 */
export function deliverParcel(parcel, robotPlace) {
  if (parcel.place !== robotPlace) {
    return {
      ...parcel,
      delivered: false,
    };
  }

  if (parcel.address !== robotPlace) {
    return {
      ...parcel,
      delivered: false,
    };
  }

  return {
    ...parcel,
    delivered: true,
  };
}
