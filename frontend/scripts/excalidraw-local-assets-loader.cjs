// Compatibility adapter for @excalidraw/excalidraw 0.18.1. The supported asset
// base config still appends the SDK's CDN fallback; keep both attempts local.
// Vendor files remain untouched. Fail visibly if this pinned contract changes.
module.exports = function localAssets(source) {
  if (!source.includes('"ASSETS_FALLBACK_URL"')) return source;
  const result = source.replace(/("ASSETS_FALLBACK_URL",\s*)`https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\/`/, '$1(globalThis.location.origin + "/whiteboard-assets/")');
  if (result === source) throw new Error("Pinned Excalidraw font fallback changed; review the local asset adapter before upgrading");
  return result;
};
