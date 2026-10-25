import test from "node:test";
import assert from "node:assert/strict";
import {
  createPatersonState,
  moveRobot,
} from "../src/simulation/paterson-state.js";
import { createParcel, createParcels } from "../src/simulation/parcels.js";

// These tests cover the separate landmark-graph simulator used by the robot
// strategies, not the dashboard's address-based OSM tour.
test("parcel creation records its origin and destination", () => {
  const parcel = createParcel(
    "Paterson City Hall",
    "Paterson Museum",
    "parcel-1",
  );

  assert.equal(parcel.place, "Paterson City Hall");
  assert.equal(parcel.address, "Paterson Museum");
  assert.equal(parcel.id, "parcel-1");
});

test("parcel generation creates the requested number", () => {
  const parcels = createParcels(5, () => 0.25);

  assert.equal(parcels.length, 5);
});

test("robot delivers a parcel when it reaches its destination", () => {
  const state = createPatersonState("Paterson City Hall", [
    {
      id: "parcel-1",
      place: "Paterson City Hall",
      address: "First Baptist Church",
    },
  ]);

  const next = moveRobot(state, "First Baptist Church");

  assert.equal(next.robotPlace, "First Baptist Church");
  assert.equal(next.steps, 1);
  assert.equal(next.deliveries, 1);
  assert.equal(next.parcels.length, 0);
});

test("robot cannot move along a nonexistent road", () => {
  const state = createPatersonState("Paterson City Hall", []);

  assert.throws(
    () => moveRobot(state, "Paterson Museum"),
    /No direct road/,
  );
});
