import { test } from "node:test";
import assert from "node:assert/strict";
import { observeDiagramWindow, observeRoomWindowFocus } from "../../src/features/room/roomWindowFocus.ts";

test("switching into the interactive diagram stays in the room; blur from inside the frame is observed", async () => {
  let focused = true;
  const host = new EventTarget() as Window;
  const child = new EventTarget() as Window;
  const frame = Object.assign(new EventTarget(), { contentDocument: { defaultView: child, location: { pathname: "/drawio/" } } }) as HTMLIFrameElement;
  Object.defineProperty(host, "document", { value: { hasFocus: () => focused } });
  const changes: boolean[] = [];
  const stop = observeRoomWindowFocus(frame, next => changes.push(next), host);
  try {
    host.dispatchEvent(new Event("blur"));
    child.dispatchEvent(new Event("focus"));
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.deepEqual(changes, []);
    focused = false;
    child.dispatchEvent(new Event("blur"));
    await new Promise(resolve => setTimeout(resolve, 1));
    focused = true;
    child.dispatchEvent(new Event("focus"));
    assert.deepEqual(changes, [false, true]);
  } finally { stop(); }
  host.dispatchEvent(new Event("blur"));
  assert.deepEqual(changes, [false, true]);
});

test("only the interactive draw.io document is bound, and load replaces the previous subscription", () => {
  const makeDoc = (pathname: string) => ({ defaultView: new EventTarget() as Window, location: { pathname } });
  const frame = Object.assign(new EventTarget(), { contentDocument: makeDoc("/drawio/") });
  const keys: string[] = [];
  const stop = observeDiagramWindow(frame as unknown as HTMLIFrameElement, win => {
    const capture = (event: Event) => { keys.push((event as KeyboardEvent).key); };
    win.addEventListener("keydown", capture);
    return () => win.removeEventListener("keydown", capture);
  });
  const first = frame.contentDocument;
  const key = (doc: typeof first, value: string) =>
    doc.defaultView.dispatchEvent(Object.assign(new Event("keydown"), { key: value }));
  key(first, "a");
  frame.contentDocument = makeDoc("/drawio/");
  frame.dispatchEvent(new Event("load"));
  key(first, "old");
  key(frame.contentDocument, "b");
  frame.contentDocument = makeDoc("/login");
  frame.dispatchEvent(new Event("load"));
  key(frame.contentDocument, "private");
  stop();
  assert.deepEqual(keys, ["a", "b"]);
});
