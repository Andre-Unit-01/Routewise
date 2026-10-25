import { createParcels } from "../simulation/parcels.js";
import { runSimulation } from "../simulation/run-simulation.js";

/**
 * Averages strategy outcomes over repeated simulations. Each run uses the
 * supplied random source and returns steps, completion rate, and deliveries.
 * @param {Object} options - Strategy names, task count, trials, and RNG.
 * @returns {Object} Per-strategy averages and completion rates.
 */
export function compareRobots({
  strategies = ["random", "route", "smart"],
  parcelCount = 5,
  trials = 100,
  maxSteps = 1000,
  random = Math.random,
} = {}) {
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error("trials must be a positive integer.");
  }

  // Aggregate metrics keyed by each strategy name.
  const results = {};

  // Evaluate every requested strategy independently.
  for (const strategy of strategies) {
    // Totals collected across the requested number of runs.
    let totalSteps = 0;
    let completedTrials = 0;
    let totalDeliveries = 0;

    // Each trial contributes one simulation outcome to the aggregate.
    for (let trial = 0; trial < trials; trial++) {
      // This sample determines the count only; runSimulation generates the
      // actual parcel set for each strategy from the random source.
      const parcels = createParcels(parcelCount, random);

      // Outcome summary returned by the simulation runner.
      const result = runSimulation({
        strategy,
        parcelCount: parcels.length,
        maxSteps,
        random,
      });

      totalSteps += result.steps;
      totalDeliveries += result.deliveries;

      if (result.completed) {
        completedTrials++;
      }
    }

    results[strategy] = {
      averageSteps: totalSteps / trials,
      completionRate: completedTrials / trials,
      averageDeliveries: totalDeliveries / trials,
      trials,
    };
  }

  return results;
}
