import * as Y from "yjs";

/**
 * Bytes/base64-преобразование и Yjs-bootstrap для CRDT-документа комнаты.
 *
 * `bytesToBase64` / `base64ToBytes` пакуют binary-payload (Yjs-update,
 * awareness-update) для транспорта по WebSocket/SSE.
 *
 * `createDeterministicBootstrapUpdate` создаёт стартовый Yjs-update с
 * фиксированным clientID, чтобы все участники, которые впервые
 * подключаются к свежей комнате, получили одинаковую CRDT-историю и
 * не разъезжались по конкурирующим начальным операциям.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.trim();
  if (!normalized) return new Uint8Array(0);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function createDeterministicBootstrapUpdate(code: string): Uint8Array {
  const bootstrapDoc = new Y.Doc();
  (bootstrapDoc as { clientID: number }).clientID = 1;
  const bootstrapText = bootstrapDoc.getText("room-code");
  if (code) {
    bootstrapText.insert(0, code);
  }
  return Y.encodeStateAsUpdate(bootstrapDoc);
}
