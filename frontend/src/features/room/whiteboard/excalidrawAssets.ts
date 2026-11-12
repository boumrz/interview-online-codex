// This module must run before the editor imports: font loading and SVG export
// use this local base instead of Excalidraw's default public CDN.
const assetWindow = window as Window & { EXCALIDRAW_ASSET_PATH?: string | string[] };
assetWindow.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/whiteboard-assets/`;
export {};
