/**
 * Improves a closed-loop route by reversing route sections that reduce its cost.
 *
 * The route contains location IDs without a repeated final depot. The distance
 * callback returns the shortest road distance between two locations. The
 * starting location remains anchored while the remaining order is optimized.
 * @param {Array} route - Unique tour stops, without a repeated depot.
 * @param {Function} distance - Returns the road distance between two stops.
 * @param {number} maxPasses - Maximum number of improvement passes.
 */
export function twoOpt(route, distance, maxPasses = 100) {
  if (route.length < 4) return [...route];

  // Current best ordering and its full closed-loop distance.
  let bestRoute = [...route];
  let bestCost = routeCost(bestRoute, distance);
  // Pass control state: continue until a full pass finds no better route.
  let improved = true;
  let passes = 0;

  while (improved && passes < maxPasses) {
    improved = false;
    passes++;

    // `i` and `k` locate the two edges whose connecting section may be reversed.
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let k = i + 2; k < bestRoute.length; k++) {
        // Reversing both edges of this boundary pair would only rotate/reverse
        // the same cyclic loop, so it cannot improve the tour.
        if (i === 0 && k === bestRoute.length - 1) {
          continue;
        }

        // A copy lets a rejected route leave the accepted ordering untouched.
        const candidate = [...bestRoute];
        // These indexes walk inward while reversing the selected subsequence.
        let left = i + 1;
        let right = k;

        while (left < right) {
          [candidate[left], candidate[right]] =
            [candidate[right], candidate[left]];
          left++;
          right--;
        }

        // Only replace the current best when the complete tour is cheaper.
        const candidateCost = routeCost(candidate, distance);

        if (candidateCost < bestCost - 1e-9) {
          bestRoute = candidate;
          bestCost = candidateCost;
          improved = true;
        }
      }
    }
  }

  return bestRoute;
}

/**
 * Sums all consecutive legs, including the closing leg back to the depot.
 * @param {Array} route - Stops in the closed-loop tour.
 * @param {Function} distance - Returns the road distance between two stops.
 */
export function routeCost(route, distance) {
  // Accumulate the distance for every leg in the loop.
  let total = 0;

  // Modulo wraps the final stop back to the route's first stop.
  for (let i = 0; i < route.length; i++) {
    // Endpoints for the current tour leg.
    const from = route[i];
    const to = route[(i + 1) % route.length];

    total += distance(from, to);
  }

  return total;
}
