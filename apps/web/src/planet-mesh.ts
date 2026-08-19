/**
 * Turning terrain data into Three.js geometry.
 *
 * The heavy lifting lives in `terrain-data.ts` and runs in a worker; this module is a thin
 * wrapper that wires typed arrays into a `BufferGeometry`. Splitting it that way is what
 * lets the mesh build without freezing the tab.
 *
 * ## The scale problem nobody expects
 *
 * Earth's full relief — Everest to the Mariana Trench — is about 20 km on a 6371 km radius.
 * That is 0.3%. Rendered at true scale a terrestrial planet is smoother than a billiard
 * ball, and every "realistic" planet you have seen in a game or a documentary is
 * exaggerated, usually by one to two orders of magnitude, silently.
 *
 * Aether exaggerates too, because a perfectly smooth sphere teaches nothing — but it says
 * so. The multiplier is a `VisualSpec` value, it is displayed in the HUD, and scientific
 * scale mode sets it to 1 so you can see the truth.
 */

import * as THREE from "three";
import type { PlanetContext } from "@aether/terrain";
import { generateTerrainData, type TerrainData, type TerrainRequest } from "./terrain-data.js";

export interface PlanetMeshOptions {
  context: PlanetContext;
  seed: string;
  /** Icosphere subdivisions. 6 gives ~41k vertices, which is comfortable off-thread. */
  subdivisions?: number;
  /**
   * Vertical exaggeration. 1 is physically true and looks like a billiard ball.
   * Always surfaced in the HUD; never applied silently.
   */
  terrainExaggeration?: number;
  substellarDir?: THREE.Vector3;
}

export interface PlanetMeshResult {
  geometry: THREE.BufferGeometry;
  /** True relief across the surface, before exaggeration. */
  reliefM: { minM: number; maxM: number };
  exaggeration: number;
  vertexCount: number;
  operators: string[];
}

function toRequest(options: PlanetMeshOptions): TerrainRequest {
  const dir = options.substellarDir ?? new THREE.Vector3(1, 0, 0);
  return {
    context: options.context,
    seed: options.seed,
    subdivisions: options.subdivisions ?? 6,
    terrainExaggeration: options.terrainExaggeration ?? 1,
    substellarDir: { x: dir.x, y: dir.y, z: dir.z },
  };
}

function toGeometry(data: TerrainData, _requestedExaggeration: number): PlanetMeshResult {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(data.colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();

  return {
    geometry,
    reliefM: data.reliefM,
    // The value actually applied, which the builder may have reduced to keep displayed
    // relief a sane fraction of the body. Reporting the requested one would make the HUD lie.
    exaggeration: data.exaggeration,
    vertexCount: data.vertexCount,
    operators: data.operators,
  };
}

/** Synchronous build. Blocks the main thread — use only where that is acceptable. */
export function buildPlanetGeometry(options: PlanetMeshOptions): PlanetMeshResult {
  const request = toRequest(options);
  return toGeometry(generateTerrainData(request), request.terrainExaggeration);
}

/**
 * Off-thread build.
 *
 * Falls back to the synchronous path if workers are unavailable, so the app still runs —
 * with a hitch — rather than showing nothing.
 */
export function createTerrainBuilder(): {
  build: (options: PlanetMeshOptions) => Promise<PlanetMeshResult>;
  dispose: () => void;
} {
  let worker: Worker | null = null;
  let nextRequestId = 1;

  try {
    worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }

  const build = (options: PlanetMeshOptions): Promise<PlanetMeshResult> => {
    const request = toRequest(options);

    if (!worker) {
      return Promise.resolve(
        toGeometry(generateTerrainData(request), request.terrainExaggeration),
      );
    }

    const requestId = nextRequestId++;

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent): void => {
        const payload = event.data as
          | { requestId: number; ok: true; data: TerrainData }
          | { requestId: number; ok: false; error: string };

        // Several builds can be in flight when a user drags a slider; ignore stale replies.
        if (payload.requestId !== requestId) return;
        worker!.removeEventListener("message", onMessage);

        if (payload.ok) {
          resolve(toGeometry(payload.data, request.terrainExaggeration));
        } else {
          reject(new Error(payload.error));
        }
      };

      worker!.addEventListener("message", onMessage);
      worker!.postMessage({ ...request, requestId });
    });
  };

  return {
    build,
    dispose: () => {
      worker?.terminate();
      worker = null;
    },
  };
}
