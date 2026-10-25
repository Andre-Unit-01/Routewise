import { createPatersonState, moveRobot } from "./paterson-state.js";
import { createParcels } from "./parcels.js";
import { randomRobot } from "../robots/random-robot.js";
import { routeRobot } from "../robots/route-robot.js";
import { smartRobot } from "../robots/smart-robot.js";

// Public strategy keys map to the decision function called by the runner.
const robotStrategies = {
  random: randomRobot,
  route: routeRobot,
  smart: smartRobot,
};

/**
 * Runs a strategy synchronously until all parcels are delivered, it stops
 * making valid moves, or the step limit is reached. `onStep` receives copies
 * of each resulting state for observers such as visualizers or benchmarks.
 * @param {Object} options - Strategy, parcel input, limit, RNG, and callback.
 * @returns {Object} Summary, final state, and recorded movement snapshots.
 */
export function runSimulation({
  strategy = "smart",
  parcelCount = 5,
  parcels: suppliedParcels,
  maxSteps = 1000,
  random = Math.random,
  onStep = null,
} = {}) {
  if (!Number.isInteger(parcelCount) || parcelCount < 0) {
    throw new Error("parcelCount must be a non-negative integer.");
  }

  if (!Number.isInteger(maxSteps) || maxSteps < 0) {
    throw new Error("maxSteps must be a non-negative integer.");
  }

  // Resolve the selected strategy once before entering the simulation loop.
  const robot = robotStrategies[strategy];

  if (!robot) {
    throw new Error(`Unknown robot strategy: "${strategy}".`);
  }

  // Copy supplied tasks or create a new randomized set for this run.
  const parcels = suppliedParcels
    ? suppliedParcels.map((parcel) => ({ ...parcel }))
    : createParcels(parcelCount, random);

  // State is replaced after each valid move; memory belongs to the strategy.
  let state = createPatersonState("Paterson City Hall", parcels);
  let memory = strategy === "route" ? undefined : [];
  // Collect immutable step snapshots for callers that need playback or metrics.
  const history = [];

  while (state.parcels.length > 0 && state.steps < maxSteps) {
    // Only the random strategy receives the injected RNG as an extra argument.
    const decision = strategy === "random"
      ? robot(state, memory, random)
      : robot(state, memory);

    if (!decision?.direction) break;

    memory = decision.memory;

    // Retain the prior position to annotate the resulting history entry.
    const previousState = state;
    state = moveRobot(state, decision.direction);

    // Keep the history independent from future state changes by copying parcels.
    const snapshot = {
      ...state,
      parcels: state.parcels.map((parcel) => ({ ...parcel })),
      movedFrom: previousState.robotPlace,
      movedTo: state.robotPlace,
    };

    history.push(snapshot);
    onStep?.(snapshot);
  }

  return {
    strategy,
    steps: state.steps,
    deliveries: state.deliveries,
    remainingParcels: state.parcels.length,
    completed: state.parcels.length === 0,
    history,
    finalState: state,
  };
}
