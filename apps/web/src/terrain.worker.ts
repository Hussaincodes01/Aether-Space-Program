/**
 * Terrain generation worker.
 *
 * Keeps a ~300 ms to ~1.2 s mesh build off the main thread, so the tab never freezes and
 * the camera keeps responding while a world is being built. Results come back as
 * transferable typed arrays — a pointer move rather than a structured clone.
 */

import { generateTerrainData, type TerrainRequest } from "./terrain-data.js";

self.onmessage = (event: MessageEvent<TerrainRequest & { requestId: number }>) => {
  const { requestId, ...request } = event.data;

  try {
    const data = generateTerrainData(request);

    self.postMessage(
      { requestId, ok: true, data },
      {
        transfer: [
          data.positions.buffer,
          data.normals.buffer,
          data.colours.buffer,
          data.indices.buffer,
        ],
      },
    );
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
