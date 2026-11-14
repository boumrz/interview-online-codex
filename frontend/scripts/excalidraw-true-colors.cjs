// Excalidraw 0.18.1 normally inverts drawings for its dark canvas, then
// counter-inverts raster image caches. Our canvas uses explicit background
// colors and displays document RGB unchanged; both native filters must agree.
// CSS canvas/text filters are disabled only inside the room whiteboard.
module.exports = function preserveDocumentColors(source) {
  const filters = [
    'invert(93%) hue-rotate(180deg)',
    'invert(100%) hue-rotate(180deg) saturate(1.25)',
  ];
  if (!filters.some(filter => source.includes(filter))) return source;
  for (const filter of filters) {
    const literal = JSON.stringify(filter);
    if (source.split(literal).length !== 2) {
      throw new Error('Pinned Excalidraw color filters changed; review both theme and image transforms');
    }
    source = source.replace(literal, '"none"');
  }
  return source;
};
