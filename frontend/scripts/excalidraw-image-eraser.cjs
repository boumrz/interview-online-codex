// Excalidraw 0.18.1 erases whole objects, including images underneath pen
// annotations. Exclude raster objects only within native eraser paths; native
// history, Alt recovery, explicit Delete and clear-canvas keep their behavior.
module.exports = function preserveEraserImages(source) {
  if (!source.includes('"handleEraser"')) return source;

  const development = source.includes('__publicField(this, "handleEraser"');
  const registration = development ? "__publicField" : "C";
  function changedContract() {
    throw new Error("Pinned Excalidraw eraser changed; review image protection before upgrading");
  }
  function replaceOnce(text, pattern, replacement) {
    if ([...text.matchAll(new RegExp(pattern.source, "g"))].length !== 1) changedContract();
    return text.replace(pattern, replacement);
  }
  function updateMethod(name, next, update) {
    const marker = source.indexOf(`"${name}"`);
    const start = source.lastIndexOf(`${registration}(this,`, marker);
    const nextMarker = source.indexOf(`"${next}"`, marker);
    const end = source.lastIndexOf(`${registration}(this,`, nextMarker);
    if (marker < 0 || start < 0 || nextMarker < 0 || end <= start) changedContract();
    source = source.slice(0, start) + update(source.slice(start, end)) + source.slice(end);
  }

  updateMethod("handleEraser", "handleTouchMove", handler => {
    if (development) {
      handler = replaceOnce(handler, /const nonDeletedElements = this\.scene\.getNonDeletedElements\(\);/,
        'const nonDeletedElements = this.scene.getNonDeletedElements().filter(element => element.type !== "image");');
      return replaceOnce(handler, /for \(const element of elements\) \{(?=\s*if \(element\.locked\))/,
        'for (const element of elements) { if (element.type === "image") continue;');
    }
    handler = replaceOnce(handler, /(\b\w+=this\.scene\.getNonDeletedElements\(\))(?=,\w+=\w+=>\{for\(let)/,
      '$1.filter(element=>element.type!=="image")');
    return replaceOnce(handler, /for\(let (\w+) of (\w+)\)\{(?=if\(\1\.locked\))/,
      'for(let $1 of $2){if($1.type==="image")continue;');
  });

  // Single-click erasure does not pass through handleEraser.
  source = development
    ? replaceOnce(source, /hitElements\.forEach\(\s*\(hitElement2\) => this\.elementsPendingErasure\.add\(hitElement2\.id\)\s*\);/,
      'hitElements.filter(element => element.type !== "image").forEach((hitElement2) => this.elementsPendingErasure.add(hitElement2.id));')
    : replaceOnce(source, /(this\.getElementsAtPosition\(\w+\.x,\w+\.y\))\.forEach\((\w+)=>this\.elementsPendingErasure\.add\(\2\.id\)\)/,
      '$1.filter($2=>$2.type!=="image").forEach($2=>this.elementsPendingErasure.add($2.id))');

  // The final guard also covers native group/frame/container cascades.
  updateMethod("eraseElements", "initializeImage", commit => development
    ? replaceOnce(commit, /\.map\(\(ele\) => \{/,
      '.map((ele) => { if (ele.type === "image") return ele;')
    : replaceOnce(commit, /(\.map\((\w+)=>)(?=this\.elementsPendingErasure\.has\(\2\.id\))/,
      '$1$2.type==="image"?$2:'));
  return source;
};
