// Excalidraw 0.18.1 rounds an image corner cursor to a 45° diagonal before
// considering rotation. The image scales along its own aspect-ratio diagonal.
function imageResizeCornerCursor(image, handle, originalImage = image) {
  if (image?.type !== "image" || !/^(nw|ne|sw|se)$/.test(handle)) return "";

  const crossedOneAxis = image.scale[0] * image.scale[1] !== originalImage.scale[0] * originalImage.scale[1];
  const downwardDiagonal = handle === "nw" || handle === "se";
  const diagonal = downwardDiagonal !== crossedOneAxis ? 1 : -1;
  const angle = image.angle + Math.atan2(diagonal * image.height, image.width);
  const degrees = (Math.round(angle * 180 / Math.PI) % 180 + 180) % 180;
  const fallback = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][Math.round(degrees / 45) % 4];

  // Use a centered, two-tone pointer that remains visible on both canvases.
  const arrow = "M4 12h16 M8 8l-4 4 4 4 M16 8l4 4-4 4";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g transform="rotate(${degrees} 12 12)" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${arrow}" stroke="white" stroke-width="4"/><path d="${arrow}" stroke="black" stroke-width="2"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${fallback}`;
}

function projectImageResizePointer(image, handle, pointerX, pointerY) {
  if (image?.type !== "image" || !/^(nw|ne|sw|se)$/.test(handle) || image.width <= 0 || image.height <= 0) {
    return [pointerX, pointerY];
  }

  // The SDK removes the initial grab offset before resizing. Project this
  // scene point onto the original diagonal so the two axis ratios agree.
  // The line contains both the center (Alt) and the opposite corner.
  const length = Math.hypot(image.width, image.height);
  const horizontal = image.width / length * (handle.endsWith("e") ? 1 : -1);
  const vertical = image.height / length * (handle.startsWith("s") ? 1 : -1);
  const cos = Math.cos(image.angle);
  const sin = Math.sin(image.angle);
  const diagonalX = horizontal * cos - vertical * sin;
  const diagonalY = horizontal * sin + vertical * cos;
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const distance = (pointerX - centerX) * diagonalX + (pointerY - centerY) * diagonalY;
  return [centerX + distance * diagonalX, centerY + distance * diagonalY];
}

module.exports = function adaptImageResize(source) {
  if (!source.includes('"maybeHandleResize"')) return source;
  const development = source.includes('__publicField(this, "maybeHandleResize"');

  function replaceOnce(pattern, replacement) {
    if ([...source.matchAll(new RegExp(pattern.source, "g"))].length !== 1) {
      throw new Error("Pinned Excalidraw resize handlers changed; review the image resize adapter");
    }
    source = source.replace(pattern, replacement);
  }

  const hoverCursor = (event, hit, nativeCursor) =>
    `(${event}.pointerType === "mouse" && !this.state.croppingElementId && imageResizeCornerCursor(${hit}.element, ${hit}.transformHandleType)) || ${nativeCursor}(${hit})`;
  // Preserve intentional object snapping. During a drag the SDK also calls
  // the handler on modifier key changes, which have no pointer type.
  const projectPointer = (event, pointer, selected, handle, x, y, freeResize) => `
    if (!imageResizeSnapped && (${event}.pointerType ?? this.state.lastPointerDownWith) === "mouse" && ${selected}.length === 1 && !${freeResize}(${event})) {
      const originalImage = ${pointer}.originalElements.get(${selected}[0].id);
      [${x}, ${y}] = projectImageResizePointer(originalImage, ${handle}, ${x}, ${y});
    }
    `;
  const resizeCursor = (event, pointer, selected, handle) => `
    if (${event}.pointerType === "mouse" && ${selected}.length === 1 && this.interactiveCanvas) {
      const image = ${selected}[0];
      const cursor = imageResizeCornerCursor(image, ${handle}, ${pointer}.originalElements.get(image.id));
      if (cursor && this.interactiveCanvas.style.cursor !== cursor) this.interactiveCanvas.style.cursor = cursor;
    }
    `;

  if (development) {
    replaceOnce(/getCursorForResizingElement\(elementWithTransformHandleType\)/,
      hoverCursor("event", "elementWithTransformHandleType", "getCursorForResizingElement"));
    replaceOnce(/"maybeHandleResize", \(pointerDownState, event\) => \{/,
      match => `${match}\n      let imageResizeSnapped = false;`);
    replaceOnce(/resizeY \+= snapOffset\.y;/,
      match => `${match}\n        imageResizeSnapped = Boolean(snapOffset.x || snapOffset.y);`);
    replaceOnce(/if \(transformElements\(\s*pointerDownState\.originalElements,/,
      match => projectPointer("event", "pointerDownState", "selectedElements", "transformHandleType", "resizeX", "resizeY", "shouldMaintainAspectRatio") + match);
    replaceOnce(/pointerDownState\.resize\.center\.y\s*\)\) \{(?=\s*const suggestedBindings)/,
      match => match + resizeCursor("event", "pointerDownState", "selectedElements", "transformHandleType"));
  } else {
    replaceOnce(/(if\((\w+)&&\2\.transformHandleType\)\{\w+\(this\.interactiveCanvas,)(\w+)\(\2\)(?=\);return\})/,
      (_match, prefix, hit, nativeCursor) => prefix + hoverCursor("t", hit, nativeCursor));
    replaceOnce(/"maybeHandleResize",\(t,r\)=>\{/,
      match => `${match}let imageResizeSnapped=false;`);
    replaceOnce(/s\+=f\.x,c\+=f\.y,(?=this\.setState\(\{snapLines:b\}\)\}if\(DE\()/,
      match => `${match}imageResizeSnapped=Boolean(f.x||f.y),`);
    replaceOnce(/if\(DE\(t\.originalElements,a,n,this\.scene\.getElementsMapIncludingDeleted\(\),this\.scene,ds\(r\),cs\(r\),n\.some\(d=>xe\(d\)\)\?!ii\(r\):ii\(r\),s,c,/,
      match => projectPointer("r", "t", "n", "a", "s", "c", "ii") + match);
    replaceOnce(/\b(\w+)\.resize\.center\.y\)\)\{(?=let \w+=\w+\(\w+,this\.scene\.getNonDeletedElementsMap\(\),this\.state\.zoom\))/,
      (match, pointer) => match + resizeCursor("r", pointer, "n", "a"));
  }
  return `${imageResizeCornerCursor.toString()}\n${projectImageResizePointer.toString()}\n${source}`;
};
