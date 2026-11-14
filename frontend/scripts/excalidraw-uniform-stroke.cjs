// Excalidraw 0.18.1 exposes no freehand pressure setting. Adapt the three
// capture sites only; existing drawings, hit testing, rendering and export
// continue to use the SDK's native element format and pressure algorithm.
module.exports = function captureFixedStroke(source) {
  if (!source.includes('"handleFreeDrawElementOnPointerDown"')) return source;

  function replaceCapture(pattern, replacement, expectedCount) {
    const matches = source.match(pattern);
    if (matches?.length !== expectedCount) {
      throw new Error("Pinned Excalidraw freehand capture changed; review the fixed stroke adapter");
    }
    source = source.replace(pattern, replacement);
  }
  // Neither the mouse's standard .5 signal nor a tablet contact should enable
  // the native velocity-based pressure simulation.
  replaceCapture(/(\b\w+\s*=\s*)\w+\.pressure\s*===\s*0?\.5(?=[,;])/g, '$1false', 1);
  replaceCapture(/(pressures:\s*)\w+\s*\?\s*\[\]\s*:\s*\[\w+\.pressure\]/g, '$1[0.5]', 1);
  replaceCapture(/(\[\.\.\.\w+\.pressures,\s*)\w+\.pressure\]/g, (_, prefix) => prefix + '0.5]', 2);
  return source;
};
