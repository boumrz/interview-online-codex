// Excalidraw 0.18.1 exposes an ellipse tool but no default aspect constraint.
// Constrain only construction in dragNewElement. Native placement, binding,
// subsequent resize, collaboration and undo keep their ordinary SDK paths.
module.exports = function constrainNewCircles(source) {
  if (!/widthAspectRatio(?:\s*:\s*\w+)?\s*=\s*null,\s*originOffset/.test(source)) return source;
  const development = 'if (shouldMaintainAspectRatio2 && newElement2.type !== "selection") {';
  const production = 'd&&e.type!=="selection"&&(U?s=a/U:';
  const result = source
    .replace(development, 'if (newElement2.type === "ellipse") { width = height = Math.max(width, height); } else ' + development)
    .replace(production, 'if(e.type==="ellipse"){a=s=Math.max(a,s)}else ' + production);
  if (result === source) throw new Error("Pinned Excalidraw shape construction changed; review the circle adapter");
  return result;
};
