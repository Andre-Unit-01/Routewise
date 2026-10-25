import test from "node:test";
import assert from "node:assert/strict";
import { compareRobots } from "../src/benchmarks/compare-robots.js";

// Validate the benchmark's output contract and input guard without requiring
// particular stochastic outcomes from any one robot strategy.
test("benchmark returns results for each strategy", () => {
  const results = compareRobots({
    strategies: ["random", "route", "smart"],
    parcelCount: 2,
    trials: 2,
    maxSteps: 100,
    random: () => 0.25,
  });

  for (const strategy of ["random", "route", "smart"]) {
    assert.ok(results[strategy]);
    assert.equal(results[strategy].trials, 2);
    assert.ok(results[strategy].averageSteps >= 0);
    assert.ok(results[strategy].completionRate >= 0);
    assert.ok(results[strategy].completionRate <= 1);
  }
});

test("benchmark rejects an invalid trial count", () => {
  assert.throws(() => compareRobots({ trials: 0 }), /trials/);
});
