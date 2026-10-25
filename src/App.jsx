import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  patersonAddressLocations,
  patersonDeliveryStops,
  patersonRoute,
  patersonRoutingAlgorithm,
} from "./simulation/paterson-route.js";
import { getRobotMoveDuration } from "./simulation/animation-settings.js";

// Load the WebGL scene only when the dashboard renders it, keeping Three.js
// out of the initial application chunk until the simulation view is needed.
const PatersonDistrictScene = lazy(
  () => import("./PatersonDistrictScene.jsx"),
);

// The dashboard's address deliveries are fixed to the stops in the generated
// street tour; this list provides stable IDs for the table and scene markers.
// Each object keeps the address key and its stable table/mesh identifier.
const initialParcels = Object.keys(patersonDeliveryStops).map(
  (destination, index) => ({
    id: index + 1,
    destination,
  }),
);

// Route waypoint for each address, used to derive delivery progress.
const deliveryStopIndexes = new Map(
  initialParcels.map(({ destination }) => {
    const stopIndex = patersonDeliveryStops[destination]?.stopIndex;
    if (!Number.isInteger(stopIndex)) {
      throw new Error(`Missing robot delivery stop for "${destination}".`);
    }
    return [destination, stopIndex];
  }),
);
// Last delivery waypoint determines when the simulation can stop.
const finalDeliveryStopIndex = Math.max(...deliveryStopIndexes.values());
// Address order sorted by the tour's waypoint indexes.
const deliverySequence = [...initialParcels].sort(
  (first, second) =>
    deliveryStopIndexes.get(first.destination) -
    deliveryStopIndexes.get(second.destination),
);
// Reverse index lets parcel rendering find an address's rank in the tour.
const deliveryRanks = new Map(
  deliverySequence.map(({ destination }, index) => [destination, index]),
);

// Delivery stops are sorted by route order, so binary search finds the number
// completed without scanning and sorting all addresses on each route step.
/**
 * @param {number} step - Current waypoint index in the street tour.
 * @returns {number} Number of addresses whose route stop has been reached.
 */
function countCompletedDeliveries(step) {
  // Search interval within the sorted delivery sequence.
  let low = 0;
  let high = deliverySequence.length;

  while (low < high) {
    // Midpoint stop is compared against the current route waypoint.
    const middle = Math.floor((low + high) / 2);
    if (deliveryStopIndexes.get(deliverySequence[middle].destination) <= step) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

/** Renders the dashboard and coordinates run state with the route scene. */
function App() {
  // `running` controls the timeout; `step` is the current route waypoint.
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  // Derive dashboard counts and parcel statuses from the current waypoint.
  const delivered = countCompletedDeliveries(step);
  const isComplete = delivered === initialParcels.length;
  // Memoize parcel data so route-only updates do not rebuild statuses.
  const parcels = useMemo(
    () =>
      initialParcels.map((parcel) => {
        const rank = deliveryRanks.get(parcel.destination);
        return {
          ...parcel,
          status:
            rank < delivered
              ? "Delivered"
              : rank === delivered
                ? "In transit"
                : "Waiting",
        };
      }),
    [delivered],
  );

  // A single timeout advances one route waypoint at a time; duration is based
  // on the geographic distance between consecutive points.
  // Keep the displayed route index within the closed coordinate array.
  const positionIndex = step % patersonRoute.length;

  useEffect(() => {
    if (!running || isComplete) return undefined;

    // Schedule the next single waypoint; the cleanup cancels it on pause or
    // before the effect schedules the following step.
    const timer = window.setTimeout(() => {
      const nextStep = Math.min(step + 1, finalDeliveryStopIndex);
      setStep(nextStep);
      if (nextStep === finalDeliveryStopIndex) setRunning(false);
    }, getRobotMoveDuration(
      patersonRoute[positionIndex],
      patersonRoute[(positionIndex + 1) % patersonRoute.length],
    ));

    return () => window.clearTimeout(timer);
  }, [isComplete, positionIndex, running, step]);

  /** Stop advancing the route and return the dashboard to its initial step. */
  function resetSimulation() {
    setRunning(false);
    setStep(0);
  }

  return (
    <div className="app-shell">
      <main className="main-content" id="dashboard">
        <div className="top-controls" aria-label="Simulation controls">
          <button
            className="primary-button"
            disabled={isComplete}
            onClick={() =>
              setRunning((current) => (isComplete ? false : !current))
            }
          >
            {isComplete
              ? "✓  Simulation complete"
              : running
                ? "Ⅱ  Pause simulation"
                : "▶  Start simulation"}
          </button>
          <button className="secondary-button" onClick={resetSimulation}>
            ↻ Reset run
          </button>
        </div>

        <section className="metrics-grid" aria-label="Simulation statistics">
          <article className="metric-card">
            <div className="metric-top">
              <span>Deliveries completed</span>
              <span className="metric-icon green">✓</span>
            </div>
            <div className="metric-value">
              {delivered}
              <span> / {initialParcels.length}</span>
            </div>
            <div className="metric-caption">Parcel delivery progress</div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${(delivered / initialParcels.length) * 100}%`,
                }}
              />
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span>Robot steps</span>
              <span className="metric-icon blue">↗</span>
            </div>
            <div className="metric-value">{step}</div>
            <div className="metric-caption">Movement steps taken</div>
            <div className="metric-footnote">Updates during the demo</div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span>Selected algorithm</span>
              <span className="metric-icon purple">◎</span>
            </div>
            <div className="strategy-metric">
              TSP · 2-opt heuristic
            </div>
            <div className="metric-caption">One robot, short road tour</div>
            <div className="metric-footnote">
              {initialParcels.length} mapped Paterson addresses
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span>Simulation status</span>
              <span
                className={`metric-icon ${running || isComplete ? "green" : "amber"}`}
              >
                ●
              </span>
            </div>
            <div className="strategy-metric">
              {isComplete ? "Completed" : running ? "Running" : "Paused"}
            </div>
            <div className="metric-caption">Current execution state</div>
            <div className="metric-footnote">
              {isComplete
                ? "All parcels delivered; robot stopped"
                : running
                  ? "Robot is moving"
                  : "Ready when you are"}
            </div>
          </article>
        </section>

        <section id="simulation">
          <article className="panel map-panel">
            <div className="panel-heading">
              <div>
                <h2>Downtown Paterson district</h2>
                <p>
                  A street-distance {patersonRoutingAlgorithm} tour visiting{" "}
                  {patersonAddressLocations.length} real, address-tagged
                  Paterson destinations. Each parcel is placed beside its
                  addressed building.
                </p>
              </div>
              <span className={`live-badge ${running ? "is-running" : ""}`}>
                <span /> {running ? "LIVE" : "IDLE"}
              </span>
            </div>

            <div className="map-legend">
              <span>
                <i className="legend-parcel" /> Parcel
              </span>
              <span>
                <i className="legend-robot" /> Robot
              </span>
              <span>
                <i className="legend-building" /> Buildings
              </span>
            </div>

            <Suspense
              fallback={
                <div className="scene-loading" role="status">
                  Loading 3D district…
                </div>
              }
            >
              <PatersonDistrictScene
                positionIndex={positionIndex}
                parcels={parcels}
                running={running}
              />
            </Suspense>

            <div className="map-footer">
              <span>
                <span className="status-dot" /> Downtown district online
              </span>
              <span>
                Drag to orbit · scroll to zoom · parcels remain beside buildings
              </span>
            </div>
            <div className="map-attribution">
              Address and street map data © OpenStreetMap contributors (ODbL)
              · Building footprints are modeled where OSM has address nodes
            </div>
          </article>

        </section>

        <section className="panel deliveries-panel" id="parcels">
          <div className="panel-heading">
            <div>
              <h2>Delivery queue</h2>
              <p>Track parcel progress across Paterson</p>
            </div>
            <span className="count-badge">{parcels.length} parcels</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PARCEL</th>
                  <th>DESTINATION</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {parcels.map((parcel) => (
                  <tr key={parcel.id}>
                    <td>
                      <span className="parcel-id">
                        PKG-{String(parcel.id).padStart(3, "0")}
                      </span>
                    </td>
                    <td>{parcel.destination}</td>
                    <td>
                      <span
                        className={`parcel-status ${parcel.status.toLowerCase().replace(" ", "-")}`}
                      >
                        <span />
                        {parcel.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="app-footer">
          <span>
            RouteWise <span className="footer-separator">·</span> Delivery
            simulation lab
          </span>
          <span>
            React + Vite <span className="footer-separator">·</span> Prototype
          </span>
        </footer>
      </main>
    </div>
  );
}

export default App;
