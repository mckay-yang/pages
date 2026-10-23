Source: https://github.com/stackedlol/ascii-sharks
Author: stackedlol
Revision: c521e24a787e6d4cc460d4cf2b9815f25e4fe453

math.ts, species.ts and world.ts are preserved without modification. The local renderer.ts patch repaints the opaque background and fixed grid directly each frame, instead of copying a cached canvas that can become transparent after GPU/context loss. The animal simulation and drawing logic remain upstream. This snapshot contains no upstream LICENSE file; no license designation has been added or inferred here.

The local controller in src/ocean-controller.js handles the drain page's explicit start/stop lifecycle. scripts/build-ocean.cjs strips TypeScript with Node.js and bundles these sources into docs/ocean.js without third-party build packages.
