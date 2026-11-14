import { MAX_WHITEBOARD_FILE_BYTES, type WhiteboardFile } from "./whiteboardProtocol";

const formats = "Добавьте изображение в формате PNG, JPEG или WebP.";
const unreadable = "Не удалось прочитать изображение. Выберите другой файл.";

function imageMimeType(bytes: Uint8Array): string {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  throw new Error(formats);
}

function checkDimensions(width: number, height: number): void {
  if (!width || !height) throw new Error(unreadable);
  if (width > 16384 || height > 16384 || width * height > 40_000_000) {
    throw new Error("Изображение слишком большое: максимум 16 384 пикселей по стороне и 40 млн пикселей.");
  }
}

// Check encoded dimensions before asking the browser to allocate a decoded
// bitmap: a small compressed file can otherwise expand to gigabytes.
function preflightImage(bytes: Uint8Array, mimeType: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (mimeType === "image/png" && bytes.length >= 24 && text(12, 4) === "IHDR") {
    checkDimensions(view.getUint32(16), view.getUint32(20)); return;
  }
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        checkDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)); return;
      }
      offset += length;
    }
  }
  if (mimeType === "image/webp" && bytes.length >= 25 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    const kind = text(12, 4);
    const uint24 = (start: number) => bytes[start] + bytes[start + 1] * 256 + bytes[start + 2] * 65536;
    if (kind === "VP8X" && bytes.length >= 30) {
      if (bytes[20] & 2) throw new Error("Анимированные изображения не поддерживаются. Добавьте статичное изображение PNG, JPEG или WebP.");
      checkDimensions(1 + uint24(24), 1 + uint24(27)); return;
    }
    if (kind === "VP8L" && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      checkDimensions(1 + (bits & 16383), 1 + ((bits >>> 14) & 16383)); return;
    }
    if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      checkDimensions(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383); return;
    }
  }
  throw new Error(unreadable);
}

function readDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(unreadable));
    reader.onerror = () => reject(new Error(unreadable));
    reader.onabort = () => reject(new Error(unreadable));
    reader.readAsDataURL(blob);
  });
}

export async function imageDimensions(dataURL: string): Promise<{ width: number; height: number }> {
  const comma = dataURL.indexOf(",");
  const encoded = dataURL.slice(comma + 1);
  if (comma < 0 || encoded.length > Math.ceil(MAX_WHITEBOARD_FILE_BYTES / 3) * 4) throw new Error(unreadable);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0)); }
  catch { throw new Error(unreadable); }
  const mimeType = imageMimeType(bytes);
  if (dataURL.slice(0, comma + 1) !== `data:${mimeType};base64,`) throw new Error(formats);
  preflightImage(bytes, mimeType);
  const image = new Image();
  image.src = dataURL;
  try { await image.decode(); }
  catch { throw new Error(unreadable); }
  const width = image.naturalWidth, height = image.naturalHeight;
  checkDimensions(width, height);
  return { width, height };
}

/** Read local raster bytes only; no URL fetches or browser recovery storage. */
export async function prepareWhiteboardImage(input: File): Promise<{ file: WhiteboardFile; width: number; height: number }> {
  if (!input.size || input.size > MAX_WHITEBOARD_FILE_BYTES) throw new Error("Изображение должно быть не больше 5 МБ.");
  if (input.type && !["image/png", "image/jpeg", "image/webp"].includes(input.type)) throw new Error(formats);
  const bytes = new Uint8Array(await input.arrayBuffer());
  const mimeType = imageMimeType(bytes);
  if (input.type && input.type !== mimeType) throw new Error(formats);
  preflightImage(bytes, mimeType);
  const dataURL = await readDataURL(new Blob([bytes], { type: mimeType }));
  const dimensions = await imageDimensions(dataURL);
  return { file: { id: crypto.randomUUID(), mimeType, dataURL, created: Date.now() }, ...dimensions };
}
