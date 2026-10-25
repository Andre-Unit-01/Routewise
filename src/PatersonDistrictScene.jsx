import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import deliveryModelUrl from "../kenney_car-kit/Models/GLB format/delivery.glb?url";
import kenneyRoofTile from "../kenney_tiny-city/Tiles/tile_0001.png";
import {
  patersonAddressLocations,
  patersonDeliveryStops,
  patersonRoute,
  patersonStreetSegments,
} from "./simulation/paterson-route.js";
import patersonOsmData from "./simulation/paterson-osm-data.json" with {
  type: "json",
};
import {
  hasSceneClearance,
  layoutParcelDropoffs,
  layoutAddressBuildings,
} from "./simulation/scene-layout.js";
import {
  getRobotMoveDuration,
  MIN_SIMULATION_STEP_INTERVAL_MS,
} from "./simulation/animation-settings.js";

// Keep this projection and scale aligned with paterson-route.js and the
// animation timing helper so geographic route distance matches rendered motion.
const center = [40.9169, -74.1724];
// Approximate meters represented by one longitude degree at the district.
const metersPerDegreeLongitude = 111320 * Math.cos((center[0] * Math.PI) / 180);
// Convert local geographic offsets into Three.js scene units.
const sceneScale = 0.012;
/** Project latitude/longitude into the scene's x/z plane. */
const toWorld = ([lat, lon], height = 0) =>
  new THREE.Vector3(
    (lon - center[1]) * metersPerDegreeLongitude * sceneScale,
    height,
    (center[0] - lat) * 111132 * sceneScale,
  );

// OSM road classes map to scene-space widths, with an 8 m default for others.
const roadWidths = {
  primary: 18,
  secondary: 17,
  tertiary: 15,
  residential: 12,
  service: 10,
};
// Shared parcel footprint used by both placement validation and rendering.
const parcelDimensions = { width: 0.125, depth: 0.11 };
// Vertical layers keep road shoulder, asphalt, and vehicle visibly separated.
const roadSurfaceHeight = 0.056;
const roadShoulderHeight = 0.018;
const robotRoadHeight = roadSurfaceHeight + 0.001;

// Palette cycles across modeled buildings to add visual variation.
const buildingStyles = [
  { wall: "#e5c9a5", roof: "#964e3f", trim: "#f2e3c8" },
  { wall: "#d5b89d", roof: "#6c3f38", trim: "#ead9bd" },
  { wall: "#c9c2ad", roof: "#5c6670", trim: "#e9e2cc" },
  { wall: "#ead8bd", roof: "#865348", trim: "#fff0d3" },
  { wall: "#d0aa87", roof: "#765249", trim: "#f3d9b6" },
  { wall: "#c8c9be", roof: "#667078", trim: "#ece9d8" },
];

/** Create a standard Three.js surface material for a scene color. */
const material = (color, roughness = 0.88) =>
  new THREE.MeshStandardMaterial({ color, roughness });

/** Load a nearest-filtered texture for the pixel-art rooftop style. */
function loadPixelTexture(loader, url) {
  const texture = loader.load(url, undefined, undefined, (error) => {
    console.error(`Unable to load scene texture "${url}".`, error);
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

// Stable scene variation comes from index/salt rather than runtime randomness.
function seeded(index, salt = 0) {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Smoothly approach a target angle while choosing the shortest rotation. */
function dampAngle(current, target, smoothing, delta) {
  const difference = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  return current + difference * (1 - Math.exp(-smoothing * delta));
}

/** Return deterministic dimensions and tower styling for a generic building. */
function buildingDimensions(index) {
  const tower = index % 13 === 4 || index % 17 === 8;
  return {
    tower,
    width: tower ? 0.26 + seeded(index, 3) * 0.1 : 0.2 + seeded(index, 3) * 0.11,
    depth: tower ? 0.24 + seeded(index, 4) * 0.09 : 0.19 + seeded(index, 4) * 0.1,
  };
}

/** Convert retained geographic street edges and widths into scene coordinates. */
function createRoadSegments() {
  return patersonStreetSegments.map(({ from, to, type }) => ({
    start: toWorld(from),
    end: toWorld(to),
    width: (roadWidths[type] ?? 8) * sceneScale,
  }));
}

/** Add the two merged surface layers that render the road network. */
function addRoadNetwork(scene, roadSegments) {
  // Build each road layer as one indexed buffer instead of one mesh per segment;
  // endpoint disks cover gaps where street segments meet at a junction.
  function makeSurface(widthScale, height, surfaceMaterial) {
    const positions = [];
    const indices = [];
    const junctions = new Map();
    roadSegments.forEach(({ start, end, width }) => {
      const halfWidth = (width * widthScale) / 2;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.002) return;

      const normalX = (-dz / length) * halfWidth;
      const normalZ = (dx / length) * halfWidth;
      const base = positions.length / 3;
      positions.push(
        start.x + normalX, height, start.z + normalZ,
        start.x - normalX, height, start.z - normalZ,
        end.x + normalX, height, end.z + normalZ,
        end.x - normalX, height, end.z - normalZ,
      );
      indices.push(
        base, base + 2, base + 1,
        base + 1, base + 2, base + 3,
      );

      for (const point of [start, end]) {
        const key = `${point.x.toFixed(3)},${point.z.toFixed(3)}`;
        const junction = junctions.get(key);
        if (!junction || junction.radius < halfWidth) {
          junctions.set(key, {
            point,
            radius: halfWidth,
          });
        }
      }
    });

    junctions.forEach(({ point, radius }) => {
      const base = positions.length / 3;
      const sides = 12;
      positions.push(point.x, height, point.z);
      for (let side = 0; side < sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        positions.push(
          point.x + Math.cos(angle) * radius,
          height,
          point.z + Math.sin(angle) * radius,
        );
      }
      for (let side = 0; side < sides; side += 1) {
        const current = base + 1 + side;
        const next = base + 1 + ((side + 1) % sides);
        indices.push(base, next, current);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, surfaceMaterial);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  makeSurface(1.15, roadShoulderHeight, material("#d6cdb9"));
  makeSurface(1, roadSurfaceHeight, material("#555c61", 0.96));
}

/** Add one modeled building and collect its window transforms for instancing. */
function addBuilding(scene, position, index, windowInstances, footprint, roofMaterial) {
  const style = buildingStyles[index % buildingStyles.length];
  const { tower, width, depth } = footprint
    ? { tower: false, width: footprint.width, depth: footprint.depth }
    : buildingDimensions(index);
  const floors = tower ? 5 + Math.floor(seeded(index, 1) * 7) : 1 + Math.floor(seeded(index, 2) * 3);
  const floorHeight = tower ? 0.095 : 0.105;
  const height = floors * floorHeight;
  const group = new THREE.Group();

  const yard = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.05, 0.014, depth + 0.05),
    material(index % 9 === 0 ? "#a6d982" : "#91c878"),
  );
  yard.position.set(position.x, -0.015, position.z);
  yard.receiveShadow = true;
  scene.add(yard);

  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.018, 0.055, depth + 0.018),
    material("#b9b4a5"),
  );
  foundation.position.y = 0.035;
  group.add(foundation);

  const facade = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material(style.wall),
  );
  facade.position.y = 0.065 + height / 2;
  facade.castShadow = true;
  facade.receiveShadow = true;
  group.add(facade);

  const roofHeight = tower ? 0.055 : 0.048;
  const texturedRoofMaterial = roofMaterial.clone();
  texturedRoofMaterial.color.set(style.roof);
  const roof = new THREE.Mesh(
    tower
      ? new THREE.BoxGeometry(width + 0.05, roofHeight, depth + 0.05)
      : new THREE.ConeGeometry(Math.max(width, depth) * 0.79, roofHeight, 4),
    texturedRoofMaterial,
  );
  roof.position.y = 0.065 + height + roofHeight / 2;
  if (!tower) roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.02, 0.025, depth + 0.025),
    material(style.trim),
  );
  trim.position.y = 0.065 + Math.min(height, 0.18);
  group.add(trim);

  const floorsVisible = Math.max(1, floors);
  for (let floor = 0; floor < floorsVisible; floor += 1) {
    const windowY = 0.065 + floor * floorHeight + floorHeight * 0.58;
    const windowsAcross = tower ? 3 : 2;
    for (let window = 0; window < windowsAcross; window += 1) {
      const x = ((window + 1) / (windowsAcross + 1) - 0.5) * width;
      const frontWindow = new THREE.Matrix4().compose(
        new THREE.Vector3(position.x + x, windowY, position.z + depth / 2 + 0.008),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1, 1),
      );
      windowInstances.push(frontWindow);

      const sideWindow = new THREE.Matrix4().compose(
        new THREE.Vector3(position.x + width / 2 + 0.008, windowY, position.z + x * (depth / width)),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
        new THREE.Vector3(1, 1, 1),
      );
      windowInstances.push(sideWindow);
    }
  }

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(0.022, width * 0.2), Math.min(0.08, height * 0.68), 0.009),
    material("#684531"),
  );
  door.position.set(0, 0.065 + Math.min(0.045, height * 0.3), depth / 2 + 0.006);
  group.add(door);

  if (tower) {
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.07, 0.035, 0.09),
      material(index % 2 === 0 ? "#b64f4c" : "#3f7188"),
    );
    awning.position.set(0, 0.15, depth / 2 + 0.055);
    group.add(awning);
    const rooftop = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.42, 0.12, depth * 0.45),
      material("#777b78"),
    );
    rooftop.position.y = 0.065 + height + 0.13;
    group.add(rooftop);
  } else if (seeded(index, 13) > 0.52) {
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.82, 0.018, 0.045),
      material(index % 2 === 0 ? "#b64f4c" : "#3f7188"),
    );
    awning.position.set(0, 0.15, depth / 2 + 0.022);
    group.add(awning);
  }

  group.position.set(position.x, 0, position.z);
  scene.add(group);
}

/** Create the vehicle root and its ground shadow before the GLB model loads. */
function makeRobot() {
  const group = new THREE.Group();
  group.name = "delivery-vehicle";
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 16),
    new THREE.MeshBasicMaterial({
      color: "#26343a",
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  group.add(shadow);
  return group;
}

/** Place cleared tree candidates and render repeated parts as instanced meshes. */
function addTreeSet(scene, roadSegments, occupied) {
  const shared = {
    trunkGeometry: new THREE.CylinderGeometry(0.025, 0.04, 0.24, 7),
    trunkMaterial: material("#735638"),
    foliageGeometry: new THREE.ConeGeometry(0.14, 0.3, 7),
    foliageMaterials: ["#16884b", "#219c51", "#30a75a"].map((color) =>
      material(color),
    ),
  };
  const treeRadius = 0.2;
  let placedTrees = 0;
  const roadPoints = patersonOsmData.roads.flatMap(({ points }) =>
    points.map((coordinate) => toWorld(coordinate)),
  );
  const bounds = roadPoints.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      maxX: Math.max(result.maxX, point.x),
      minZ: Math.min(result.minZ, point.z),
      maxZ: Math.max(result.maxZ, point.z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  const candidates = [];
  // Trees share geometry and material; instance matrices reduce per-tree
  // draw calls while retaining deterministic variation in size and foliage.
  const trunkMatrices = [];
  const foliageMatrices = shared.foliageMaterials.map(() => []);
  const transform = new THREE.Object3D();
  let index = 0;
  for (let z = bounds.minZ + 0.45; z < bounds.maxZ; z += 0.9) {
    for (let x = bounds.minX + 0.45; x < bounds.maxX; x += 0.9) {
      const jitter = (seeded(index, 7) - 0.5) * 0.24;
      candidates.push({
        index,
        position: new THREE.Vector3(x + jitter, 0, z - jitter),
      });
      index += 1;
    }
  }

  candidates.forEach(({ index: candidateIndex, position: candidate }) => {
    if (seeded(candidateIndex, 11) < 0.28) return;
    const position = hasSceneClearance(
      candidate,
      treeRadius,
      roadSegments,
      occupied,
    )
      ? candidate
      : null;
    if (!position) return;

    const scale = 0.72 + seeded(placedTrees, 5) * 0.64;
    transform.position.set(position.x, 0.12 * scale, position.z);
    transform.scale.setScalar(scale);
    transform.updateMatrix();
    trunkMatrices.push(transform.matrix.clone());
    for (let tier = 0; tier < 3; tier += 1) {
      transform.position.y = (0.28 + tier * 0.15) * scale;
      transform.scale.setScalar(scale * (1 - tier * 0.12));
      transform.updateMatrix();
      foliageMatrices[(placedTrees + tier) % foliageMatrices.length].push(
        transform.matrix.clone(),
      );
    }
    occupied.push({ position, radius: treeRadius });
    placedTrees += 1;
  });

  const trunks = new THREE.InstancedMesh(
    shared.trunkGeometry,
    shared.trunkMaterial,
    trunkMatrices.length,
  );
  trunkMatrices.forEach((matrix, instanceIndex) =>
    trunks.setMatrixAt(instanceIndex, matrix),
  );
  trunks.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  scene.add(trunks);

  foliageMatrices.forEach((matrices, materialIndex) => {
    if (matrices.length === 0) return;
    const foliage = new THREE.InstancedMesh(
      shared.foliageGeometry,
      shared.foliageMaterials[materialIndex],
      matrices.length,
    );
    matrices.forEach((matrix, instanceIndex) =>
      foliage.setMatrixAt(instanceIndex, matrix),
    );
    foliage.instanceMatrix.needsUpdate = true;
    foliage.castShadow = true;
    scene.add(foliage);
  });
}

/** Build shared box meshes and initialize one hidden/shown instance per parcel. */
function addParcelInstances(scene, parcels, positions, statuses) {
  const instanceMeshes = [
    {
      geometry: new THREE.BoxGeometry(
        parcelDimensions.width,
        0.095,
        parcelDimensions.depth,
      ),
      parcelMaterial: material("#c9854d"),
      height: 0.065,
    },
    {
      geometry: new THREE.BoxGeometry(0.022, 0.098, 0.11),
      parcelMaterial: material("#f4dfb4"),
      height: 0.065,
    },
    {
      geometry: new THREE.BoxGeometry(0.125, 0.018, 0.11),
      parcelMaterial: material("#f4dfb4"),
      height: 0.114,
    },
  ].map(({ geometry, parcelMaterial, height }) => {
    const mesh = new THREE.InstancedMesh(
      geometry,
      parcelMaterial,
      parcels.length,
    );
    mesh.castShadow = true;
    mesh.userData.parcelHeight = height;
    scene.add(mesh);
    return mesh;
  });

  // Three boxes make up each parcel; zero-scale instances stay allocated but
  // are invisible until the corresponding delivery is completed.
  const parcelMeshes = new Map();
  const transform = new THREE.Object3D();
  parcels.forEach((parcel, index) => {
    const position = positions.get(parcel.id);
    if (!position) {
      throw new Error(`Missing building-side position for parcel ${parcel.id}.`);
    }
    parcelMeshes.set(parcel.id, { index, meshes: instanceMeshes });
    const visible = statuses.get(parcel.id) === "Delivered";
    instanceMeshes.forEach((mesh) => {
      transform.position.set(
        position.x,
        position.y + mesh.userData.parcelHeight,
        position.z,
      );
      transform.scale.setScalar(visible ? 1 : 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
  });
  instanceMeshes.forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
  });
  return { parcelMeshes, instanceMeshes };
}

/** Set all box components for one parcel at a world position and visibility. */
function setParcelInstance(instanceMeshes, index, position, visible) {
  // Update only this parcel's transforms rather than rebuilding the shared
  // instance buffers or changing the scene's object count.
  const transform = new THREE.Object3D();
  for (const mesh of instanceMeshes) {
    transform.position.set(
      position.x,
      position.y + mesh.userData.parcelHeight,
      position.z,
    );
    transform.scale.setScalar(visible ? 1 : 0);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Layout address buildings, render them, and batch their window meshes. */
function addAddressBuildings(scene, roadSegments, occupied, roofMaterial) {
  const windows = [];
  const layout = layoutAddressBuildings(
    patersonAddressLocations,
    roadSegments,
    occupied,
    toWorld,
  );
  const positions = new Map();
  layout.forEach((building, name) => {
    const position = new THREE.Vector3(
      building.position.x,
      0,
      building.position.z,
    );
    addBuilding(scene, position, building.index, windows, building, roofMaterial);
    positions.set(name, { ...building, position });
  });

  const windowGeometry =   new THREE.BoxGeometry(0.016, 0.024, 0.006);
  const windowMesh = new THREE.InstancedMesh(
    windowGeometry,
    material("#87d5df", 0.35),
    windows.length,
  );
  windows.forEach((matrix, index) => windowMesh.setMatrixAt(index, matrix));
  windowMesh.instanceMatrix.needsUpdate = true;
  windowMesh.castShadow = true;
  scene.add(windowMesh);
  return positions;
}

/** Add the fixed street lamps used as scene decoration. */
function addStreetFurniture(scene) {
  const lampMaterial = material("#3f4e50");
  const lampGeometry = new THREE.CylinderGeometry(0.012, 0.018, 0.38, 6);
  const lampHeadGeometry = new THREE.BoxGeometry(0.09, 0.028, 0.045);
  const lampHeadMaterial = material("#e8d99b");
  const lightLocations = [
    [40.91718, -74.1754],
    [40.91655, -74.1734],
    [40.91788, -74.1726],
    [40.91625, -74.1709],
    [40.91505, -74.1724],
    [40.9180, -74.1700],
    [40.91695, -74.1692],
    [40.9157, -74.1755],
  ];
  lightLocations.forEach((coordinate) => {
    const position = toWorld(coordinate);
    const pole = new THREE.Mesh(lampGeometry, lampMaterial);
    pole.position.set(position.x, 0.19, position.z);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(lampHeadGeometry, lampHeadMaterial);
    head.position.set(position.x + 0.035, 0.39, position.z);
    scene.add(head);
  });
}

/** Dispose unique mesh resources and textures owned by a scene subtree. */
function disposeScene(scene) {
  const disposedMaterials = new Set();
  const disposedTextures = new Set();
  scene.traverse((object) => {
    if (!object.isMesh && !object.isSprite) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((item) => {
      if (item.map && !disposedTextures.has(item.map)) {
        item.map.dispose();
        disposedTextures.add(item.map);
      }
      if (disposedMaterials.has(item)) return;
      item.dispose();
      disposedMaterials.add(item);
    });
  });
}

/**
 * Owns the Three.js scene lifecycle. React supplies route-stop and delivery
 * changes; the renderer animates the car through refs without per-frame React
 * state updates and renders only while moving or handling camera interaction.
 */
export default function PatersonDistrictScene({
  positionIndex,
  parcels,
}) {
  const containerRef = useRef(null);
  const parcelMeshesRef = useRef(new Map());
  const parcelDestinationsRef = useRef(
    parcels.map(({ id, destination }) => ({ id, destination })),
  );
  const parcelStatusesRef = useRef(
    new Map(parcels.map((parcel) => [parcel.id, parcel.status])),
  );
  const pendingDeliveriesRef = useRef(new Map());
  const parcelPositionsRef = useRef(new Map());
  const routeTargetRef = useRef(toWorld(patersonRoute[positionIndex]));
  const routeNextRef = useRef(
    toWorld(patersonRoute[(positionIndex + 1) % patersonRoute.length]),
  );
  const lastPositionIndexRef = useRef(positionIndex);
  const robotMoveRef = useRef(null);
  const invalidateRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const pendingDeliveries = pendingDeliveriesRef.current;
    if (!container) return undefined;

    // The scene is constructed once per mounted component; map geometry,
    // building layout, and parcel drop-off positions remain static for the run.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#c6e4df");
    scene.fog = new THREE.Fog("#c6e4df", 320, 1400);
    const textureLoader = new THREE.TextureLoader();
    const roofTexture = loadPixelTexture(textureLoader, kenneyRoofTile);
    const roofMaterial = new THREE.MeshStandardMaterial({
      map: roofTexture,
      roughness: 0.88,
    });

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2500);
    camera.position
      .copy(routeTargetRef.current)
      .add(new THREE.Vector3(1, 1.5, 1.8));

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(routeTargetRef.current);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.1;
    controls.maxDistance = Infinity;
    controls.zoomSpeed = 1.25;
    controls.zoomToCursor = true;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.update();

    scene.add(new THREE.HemisphereLight("#f5fff8", "#536354", 1.8));
    const sunlight = new THREE.DirectionalLight("#fff1d5", 2.4);
    sunlight.position.set(-7, 12, 7);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.camera.left = -24;
    sunlight.shadow.camera.right = 24;
    sunlight.shadow.camera.top = 24;
    sunlight.shadow.camera.bottom = -24;
    sunlight.shadow.bias = -0.0004;
    scene.add(sunlight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 30),
      material("#b9d99d"),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.035;
    ground.receiveShadow = true;
    scene.add(ground);

    const roadSegments = createRoadSegments();
    addRoadNetwork(scene, roadSegments);

    const occupied = [];
    const addressBuildingPositions = addAddressBuildings(
      scene,
      roadSegments,
      occupied,
      roofMaterial,
    );
    addTreeSet(scene, roadSegments, occupied);
    addStreetFurniture(scene);
      const parcelRoadPositions = new Map(
        Object.entries(patersonDeliveryStops).map(([name, stop]) => [
          name,
          toWorld(stop.coordinates),
        ]),
      );
      const parcelPositions = new Map(
        [...layoutParcelDropoffs(
          parcelDestinationsRef.current,
          addressBuildingPositions,
          parcelRoadPositions,
          roadSegments,
          occupied,
        )].map(([id, position]) => [
          id,
          new THREE.Vector3(position.x, 0.06, position.z),
        ]),
      );
      parcelPositionsRef.current = parcelPositions;

    const robot = makeRobot();
    robot.position.copy(routeTargetRef.current);
    robot.position.y = robotRoadHeight;
    scene.add(robot);
    const wheelNames = [
      "wheel-front-left",
      "wheel-front-right",
      "wheel-back-left",
      "wheel-back-right",
    ];
    const wheels = [];
    const frontWheels = [];
    const gltfLoader = new GLTFLoader();
    let modelDisposed = false;
    gltfLoader.load(
      deliveryModelUrl,
      ({ scene: vehicleModel }) => {
        if (modelDisposed) {
          disposeScene(vehicleModel);
          return;
        }
        vehicleModel.scale.setScalar(0.05);
        vehicleModel.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = true;
          object.receiveShadow = true;
          if (wheelNames.includes(object.name)) {
            wheels.push(object);
            if (object.name.startsWith("wheel-front")) {
              frontWheels.push(object);
            }
          }
        });
        robot.add(vehicleModel);
        invalidateRef.current?.();
      },
      undefined,
      (error) => {
        console.error(`Unable to load delivery vehicle "${deliveryModelUrl}".`, error);
      },
    );

    const { parcelMeshes } = addParcelInstances(
      scene,
      parcelDestinationsRef.current,
      parcelPositions,
      parcelStatusesRef.current,
    );
    parcelMeshesRef.current = parcelMeshes;

    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
      requestRender();
    });
    resizeObserver.observe(container);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);

    let previousFrame = performance.now();
    let animationFrame = null;
    const followDelta = new THREE.Vector3();
    const heading = new THREE.Vector3();
    const previousVehiclePosition = robot.position.clone();
    // Coalesce invalidations so multiple events schedule at most one frame.
    function requestRender() {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    }
    function renderFrame() {
      animationFrame = null;
      const now = performance.now();
      const delta = Math.min((now - previousFrame) / 1000, 0.1);
      previousFrame = now;
      const target = routeTargetRef.current;
      const movement = robotMoveRef.current;
      if (movement) {
        const progress = THREE.MathUtils.clamp(
          (now - movement.startedAt) / movement.duration,
          0,
          1,
        );
        robot.position.lerpVectors(movement.from, movement.to, progress);
        if (progress === 1) robotMoveRef.current = null;
      } else {
        robot.position.x = target.x;
        robot.position.z = target.z;
      }
      robot.position.y = robotRoadHeight;
      const distanceMoved = robot.position.distanceTo(previousVehiclePosition);
      previousVehiclePosition.copy(robot.position);
      const wheelRoll = distanceMoved / (0.3 * 0.05);
      wheels.forEach((wheel) => {
        wheel.rotation.x += wheelRoll;
      });
      followDelta.subVectors(robot.position, controls.target);
      camera.position.add(followDelta);
      controls.target.copy(robot.position);
      if (!robotMoveRef.current && pendingDeliveries.size > 0) {
        pendingDeliveries.forEach((position, id) => {
          const parcel = parcelMeshes.get(id);
          if (!parcel) return;
          setParcelInstance(parcel.meshes, parcel.index, position, true);
          pendingDeliveries.delete(id);
        });
      }
      const nextPosition = routeNextRef.current;
      if (movement) {
        heading.subVectors(movement.to, movement.from);
      } else {
        heading.subVectors(nextPosition, target);
      }
      if (heading.lengthSq() > 1e-8) {
        const targetHeading = Math.atan2(heading.x, heading.z);
        const headingError = Math.atan2(
          Math.sin(targetHeading - robot.rotation.y),
          Math.cos(targetHeading - robot.rotation.y),
        );
        robot.rotation.y = dampAngle(robot.rotation.y, targetHeading, 8, delta);
        const steeringAngle = THREE.MathUtils.clamp(
          headingError,
          -0.45,
          0.45,
        );
        frontWheels.forEach((wheel) => {
          wheel.rotation.y = steeringAngle;
        });
      }
      const controlsChanged = controls.update();
      renderer.render(scene, camera);
      // Continue requesting frames only for vehicle interpolation. OrbitControls
      // dispatches change events during damping and schedules its own redraws.
      if (robotMoveRef.current) {
        requestRender();
      } else if (!controlsChanged) {
        previousFrame = performance.now();
      }
    }
    // Do not keep requesting frames while the page is backgrounded; reset the
    // time origin so returning from a suspended tab does not jump the vehicle.
    function handleVisibilityChange() {
      if (document.hidden) {
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }
        previousFrame = performance.now();
        return;
      }
      requestRender();
    }
    invalidateRef.current = requestRender;
    controls.addEventListener("change", requestRender);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    requestRender();

    return () => {
      // Cancel callbacks/listeners before disposing GPU resources and detaching
      // the canvas, making React remounts safe during development as well.
      resizeObserver.disconnect();
      controls.removeEventListener("change", requestRender);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      invalidateRef.current = null;
      controls.dispose();
      modelDisposed = true;
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
      parcelMeshes.clear();
      pendingDeliveries.clear();
    };
  }, []);

  useEffect(() => {
    const target = toWorld(patersonRoute[positionIndex]);
    if (lastPositionIndexRef.current !== positionIndex) {
      const previousIndex = lastPositionIndexRef.current;
      robotMoveRef.current = {
        from: routeTargetRef.current.clone(),
        to: target,
        startedAt: performance.now(),
        duration:
          positionIndex > previousIndex
            ? getRobotMoveDuration(
                patersonRoute[previousIndex],
                patersonRoute[positionIndex],
              )
            : MIN_SIMULATION_STEP_INTERVAL_MS,
      };
      lastPositionIndexRef.current = positionIndex;
    }
    routeTargetRef.current.copy(target);
    routeNextRef.current.copy(
      toWorld(patersonRoute[(positionIndex + 1) % patersonRoute.length]),
    );
    invalidateRef.current?.();
  }, [positionIndex]);

  useEffect(() => {
    parcels.forEach((parcel) => {
      const marker = parcelMeshesRef.current.get(parcel.id);
      if (!marker) return;
      const previousStatus = parcelStatusesRef.current.get(parcel.id);
      if (previousStatus === parcel.status) return;

      if (parcel.status === "Delivered") {
        if (previousStatus !== "Delivered") {
          const dropoff = parcelPositionsRef.current.get(parcel.id);
          if (!dropoff) {
            throw new Error(
              `Missing building-side position for parcel ${parcel.id}.`,
            );
          }
          if (robotMoveRef.current) {
            pendingDeliveriesRef.current.set(parcel.id, dropoff);
          } else {
            setParcelInstance(marker.meshes, marker.index, dropoff, true);
          }
        }
      } else {
        pendingDeliveriesRef.current.delete(parcel.id);
        const dropoff = parcelPositionsRef.current.get(parcel.id);
        if (!dropoff) {
          throw new Error(
            `Missing building-side position for parcel ${parcel.id}.`,
          );
        }
        setParcelInstance(marker.meshes, marker.index, dropoff, false);
      }

      parcelStatusesRef.current.set(parcel.id, parcel.status);
    });
    invalidateRef.current?.();
  }, [parcels]);

  return (
    <div
      className="paterson-district-scene"
      ref={containerRef}
      role="img"
      aria-label="Interactive Three.js model of Paterson with real mapped streets, 123 address-tagged delivery locations, a robot following a TSP tour, and parcels placed beside their destination buildings"
    />
  );
}
