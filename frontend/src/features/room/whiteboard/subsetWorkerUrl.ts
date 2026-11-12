// The SDK exports import.meta.url from a dynamically imported worker module.
// Bundling that module converts its URL to a build-machine file: URL. Keep the
// executable worker graph as local, byte-identical ESM instead.
export const WorkerUrl = new URL("/whiteboard-assets/subset/subset-worker.chunk.js", window.location.origin);
