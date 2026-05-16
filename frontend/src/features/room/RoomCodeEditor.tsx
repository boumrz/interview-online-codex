import React, { useCallback, useEffect, useMemo, useRef } from "react";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { yCollab } from "y-codemirror.next";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
} from "@codemirror/view";
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";

import { trackEvent } from "../../services/analytics";
import {
  awarenessUserColors,
  dedupeRemoteAwarenessEntries,
  remoteCursorDarkTheme,
} from "./awarenessIdentity";
import {
  base64ToBytes,
  bytesToBase64,
  createDeterministicBootstrapUpdate,
} from "./yjsCodec";
import { isPlaintextLanguage, normalizeRoomLanguage } from "./roomLanguage";
import { roomSyncLog } from "./roomSyncLog";
import type { KeyPressPayload } from "./candidateKeys";
import roomPageStyles from "../../pages/RoomPage.module.css";

/**
 * Колбэк, который `RoomCodeEditor` вызывает при каждом локальном или
 * heartbeat-апдейте Yjs-документа.
 *
 * Вынесен в этот файл (а не в общий types-модуль), потому что является
 * частью публичного контракта именно `RoomCodeEditor`.
 */
export type YjsUpdateHandler = (
  yjsUpdate: string,
  syncKey: string,
  codeSnapshot?: string | null,
  yjsDocumentBase64?: string | null,
  baseServerYjsSequence?: number | null,
) => void;

export type RoomCodeEditorProps = {
  height: string;
  language: string;
  value: string;
  serverYjsBase64?: string | null;
  serverYjsSequence?: number;
  lastCodeUpdatedBySessionId?: string | null;
  syncKey: string;
  resyncSignal: number;
  readOnly: boolean;
  sessionId: string;
  participantId: string;
  participantLabel: string;
  sendAwarenessUpdate: (awarenessUpdate: string) => void;
  onAwarenessBridgeReady: (applyFn: ((b64: string) => void) | null) => void;
  onYjsUpdate: YjsUpdateHandler;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onEditorValueChange: (value: string) => void;
  onKeyPress: (payload: KeyPressPayload) => void;
};

/**
 * Совместный CodeMirror-редактор комнаты, работающий поверх Yjs CRDT.
 *
 * Раньше жил inline в `RoomPage.tsx` (~520 строк) — вынесен отдельно,
 * чтобы:
 *   * читать и менять CRDT-bootstrap логику в одном месте;
 *   * не тащить тяжёлые `yjs` / `@codemirror/*` зависимости через
 *     основной `RoomPage` для остальных секций UI;
 *   * был чёткий public-контракт через `RoomCodeEditorProps`.
 *
 * Поведение совпадает 1:1 с прежней inline-версией: чёткие комментарии
 * про bootstrap-стратегию (snapshot vs deterministic update vs plain
 * code), heartbeat snapshot каждые 2.5 c, дедуп удалённой awareness,
 * стабильный clientID для bootstrap.
 */
export function RoomCodeEditor({
  height,
  language,
  value,
  serverYjsBase64 = null,
  serverYjsSequence = 0,
  lastCodeUpdatedBySessionId: _lastCodeUpdatedBySessionId = null,
  syncKey,
  resyncSignal,
  readOnly,
  sessionId,
  participantId,
  participantLabel,
  sendAwarenessUpdate,
  onAwarenessBridgeReady,
  onYjsUpdate,
  onYjsBridgeReady,
  onEditorValueChange,
  onKeyPress,
}: RoomCodeEditorProps) {
  type CmHostElement = HTMLDivElement & {
    __roomEditorView?: EditorView | null;
  };
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const lastHandledResyncSignalRef = useRef(0);
  const syncKeyRef = useRef<string>(syncKey);
  const onYjsUpdateRef = useRef(onYjsUpdate);
  const onEditorValueChangeRef = useRef(onEditorValueChange);
  const onKeyPressRef = useRef(onKeyPress);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());
  const lastAppliedServerYjsSeqRef = useRef(-1);
  const lastAppliedServerYjsSnapRef = useRef<string | null>(null);
  const lastSyncKeyForServerSeqRef = useRef(syncKey);
  const latestServerYjsSequenceRef = useRef(0);
  const sendAwarenessUpdateRef = useRef(sendAwarenessUpdate);
  const awarenessRef = useRef<Awareness | null>(null);

  /** After remote Yjs merges (reload / resync), re-anchor local cursor in Awareness and refresh remote carets. */
  const bumpLocalAwarenessAfterRemoteDocChange = useCallback(() => {
    requestAnimationFrame(() => {
      const v = viewRef.current;
      const awareness = awarenessRef.current;
      const yText = yTextRef.current;
      if (!v || !awareness || !yText) return;
      try {
        const docLen = yText.length;
        const sel = v.state.selection.main;
        const anchor = Math.min(Math.max(sel.anchor, 0), docLen);
        const head = Math.min(Math.max(sel.head, 0), docLen);
        if (anchor !== sel.anchor || head !== sel.head) {
          v.dispatch({ selection: EditorSelection.single(anchor, head) });
        }
        const next = v.state.selection.main;
        awareness.setLocalStateField("cursor", {
          anchor: Y.createRelativePositionFromTypeIndex(yText, next.anchor),
          head: Y.createRelativePositionFromTypeIndex(yText, next.head),
        });
      } catch {
        /* selection can be adjusting after applyUpdate */
      }
      dedupeRemoteAwarenessEntries(awareness);
      v.dispatch({});
    });
  }, []);

  useEffect(() => {
    sendAwarenessUpdateRef.current = sendAwarenessUpdate;
  }, [sendAwarenessUpdate]);

  useEffect(() => {
    onYjsUpdateRef.current = onYjsUpdate;
    onEditorValueChangeRef.current = onEditorValueChange;
    onKeyPressRef.current = onKeyPress;
  }, [onEditorValueChange, onKeyPress, onYjsUpdate]);

  useEffect(() => {
    latestServerYjsSequenceRef.current =
      typeof serverYjsSequence === "number" &&
      Number.isFinite(serverYjsSequence)
        ? Math.max(0, Math.floor(serverYjsSequence))
        : 0;
  }, [serverYjsSequence]);

  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    const st = awareness.getLocalState();
    if (!st?.user) return;
    const name = participantLabel.trim() || "Участник";
    if (
      st.user.name === name &&
      (st.user as { sessionId?: string }).sessionId === sessionId &&
      (st.user as { participantId?: string }).participantId === participantId
    )
      return;
    awareness.setLocalState({
      ...st,
      user: { ...st.user, name, sessionId, participantId },
    });
  }, [participantId, participantLabel, sessionId]);

  const languageExtension = useMemo(() => {
    const normalized = normalizeRoomLanguage(language);
    // Для plain text возвращаем пустой массив расширений: CodeMirror
    // продолжит работать как обычный многострочный редактор, но без
    // grammar-парсера и подсветки — то, что нужно для текстовых
    // задач/ТЗ без привязки к синтаксису.
    if (isPlaintextLanguage(normalized)) return [];
    if (normalized === "python") return python();
    if (normalized === "java" || normalized === "kotlin") return java();
    if (normalized === "sql") return sql();
    return javascript();
  }, [language]);

  useEffect(() => {
    return () => {
      onYjsBridgeReady(null);
      onAwarenessBridgeReady(null);
      viewRef.current?.destroy();
      viewRef.current = null;
      const hostElement = hostRef.current as CmHostElement | null;
      if (hostElement) {
        hostElement.__roomEditorView = null;
      }
      yDocRef.current?.destroy();
      yDocRef.current = null;
      yTextRef.current = null;
      awarenessRef.current = null;
    };
  }, [onAwarenessBridgeReady, onYjsBridgeReady]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const readOnlyCompartment = readOnlyCompartmentRef.current;
    const languageCompartment = languageCompartmentRef.current;
    const targetCode = value ?? "";
    const snap = serverYjsBase64?.trim();
    const normalizedServerYjsSequence =
      typeof serverYjsSequence === "number" &&
      Number.isFinite(serverYjsSequence)
        ? Math.max(0, Math.floor(serverYjsSequence))
        : 0;
    const hasExistingServerYjsState = normalizedServerYjsSequence > 0;
    let yDoc = new Y.Doc();
    let bootstrappedFromSnapshot = false;
    if (snap) {
      try {
        const raw = base64ToBytes(snap);
        if (raw.length > 0) {
          Y.applyUpdate(yDoc, raw, "bootstrap");
          bootstrappedFromSnapshot = true;
          trackEvent("prod_editor_bootstrap_server_snapshot", {
            yjs_sequence: normalizedServerYjsSequence,
          });
        }
      } catch {
        /* invalid snapshot */
      }
    }
    if (!bootstrappedFromSnapshot && !hasExistingServerYjsState) {
      trackEvent("prod_editor_bootstrap_code_fallback", {
        reason: "empty_server_state",
        yjs_sequence: normalizedServerYjsSequence,
      });
      Y.applyUpdate(
        yDoc,
        createDeterministicBootstrapUpdate(targetCode),
        "bootstrap",
      );
    }
    let yText = yDoc.getText("room-code");
    // Server CRDT snapshot can disagree with `merged.code` (last writer / ordering); never replace a merged doc with the plain string.
    if (
      yText.toString() !== targetCode &&
      !snap &&
      !hasExistingServerYjsState
    ) {
      trackEvent("prod_editor_bootstrap_code_rebuild", {
        reason: "code_mismatch_after_bootstrap",
        yjs_sequence: normalizedServerYjsSequence,
      });
      yDoc.destroy();
      yDoc = new Y.Doc();
      Y.applyUpdate(
        yDoc,
        createDeterministicBootstrapUpdate(targetCode),
        "bootstrap",
      );
      yText = yDoc.getText("room-code");
    }
    if (!bootstrappedFromSnapshot && hasExistingServerYjsState) {
      trackEvent("prod_editor_bootstrap_missing_snapshot", {
        yjs_sequence: normalizedServerYjsSequence,
      });
    }
    yDocRef.current = yDoc;
    yTextRef.current = yText;

    const awareness = new Awareness(yDoc);
    awarenessRef.current = awareness;
    const colorSeed = participantId.trim() || sessionId;
    const { color, colorLight } = awarenessUserColors(colorSeed);
    awareness.setLocalState({
      user: {
        name: participantLabel.trim() || "Участник",
        color,
        colorLight,
        sessionId,
        participantId,
      },
    });

    let awarenessFlushTimer: number | null = null;
    const flushAwareness = () => {
      awarenessFlushTimer = null;
      try {
        const u = encodeAwarenessUpdate(awareness, [awareness.clientID]);
        sendAwarenessUpdateRef.current(bytesToBase64(u));
      } catch {
        /* ignore */
      }
    };
    const onAwarenessChanged = (
      {
        added,
        updated,
        removed,
      }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "remote") return;
      const touched = new Set([...added, ...updated, ...removed]);
      if (!touched.has(awareness.clientID)) return;
      if (awarenessFlushTimer != null) window.clearTimeout(awarenessFlushTimer);
      awarenessFlushTimer = window.setTimeout(flushAwareness, 48);
    };
    awareness.on("update", onAwarenessChanged);

    onAwarenessBridgeReady((b64) => {
      try {
        if (!b64) return;
        applyAwarenessUpdate(awareness, base64ToBytes(b64), "remote");
        dedupeRemoteAwarenessEntries(awareness);
      } catch {
        /* ignore malformed */
      }
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: yText.toString(),
        extensions: [
          oneDark,
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          foldGutter(),
          indentOnInput(),
          closeBrackets(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          languageCompartment.of(languageExtension),
          yCollab(yText, awareness, { undoManager: false }),
          remoteCursorDarkTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onEditorValueChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            keydown: (_event, viewInstance) => {
              const event = _event as KeyboardEvent;
              onKeyPressRef.current({
                key: event.key,
                keyCode: event.code,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
              });
              if (viewInstance.state.readOnly) {
                event.preventDefault();
                return true;
              }
              return false;
            },
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    const hostElement = hostRef.current as CmHostElement | null;
    if (hostElement) {
      hostElement.__roomEditorView = view;
    }
    onEditorValueChangeRef.current(view.state.doc.toString());

    syncKeyRef.current = syncKey;

    const handleDocUpdate = (updateBytes: Uint8Array, origin: unknown) => {
      if (origin === "remote" || origin === "bootstrap") return;
      const encodedUpdate = bytesToBase64(updateBytes);
      // Always send full Yjs state with each local edit so the server snapshot stays current.
      // After a tab refresh, missed SSE increments cannot be replayed; reconnecting clients rely on state_sync yjsDocumentBase64.
      const fullDoc = bytesToBase64(Y.encodeStateAsUpdate(yDoc));
      onYjsUpdateRef.current(
        encodedUpdate,
        syncKeyRef.current,
        yText.toString(),
        fullDoc,
        latestServerYjsSequenceRef.current,
      );
    };
    yDoc.on("update", handleDocUpdate);

    const emitFullSnapshot = () => {
      const d = yDocRef.current;
      const t = yTextRef.current;
      if (!d || !t) return;
      const full = bytesToBase64(Y.encodeStateAsUpdate(d));
      onYjsUpdateRef.current(
        "",
        syncKeyRef.current,
        t.toString(),
        full,
        latestServerYjsSequenceRef.current,
      );
    };

    // Idle tabs still refresh the server snapshot so a reloaded peer does not bootstrap from stale CRDT state.
    const heartbeatId = window.setInterval(() => {
      emitFullSnapshot();
    }, 2500);

    onYjsBridgeReady((encodedYjsUpdate: string) => {
      const activeDoc = yDocRef.current;
      if (!activeDoc) return;
      const updateBytes = base64ToBytes(encodedYjsUpdate);
      if (updateBytes.length === 0) return;
      Y.applyUpdate(activeDoc, updateBytes, "remote");
    });

    const snapshotTimerId = window.setTimeout(() => {
      emitFullSnapshot();
    }, 400);

    return () => {
      window.clearTimeout(snapshotTimerId);
      window.clearInterval(heartbeatId);
      yDoc.off("update", handleDocUpdate);
      awareness.off("update", onAwarenessChanged);
      if (awarenessFlushTimer != null) window.clearTimeout(awarenessFlushTimer);
      onAwarenessBridgeReady(null);
      awareness.destroy();
      awarenessRef.current = null;
      const nextHost = hostRef.current as CmHostElement | null;
      if (nextHost) {
        nextHost.__roomEditorView = null;
      }
    };
    // IMPORTANT: do not depend on `value` or `serverYjsBase64` here. When those change every state_sync,
    // this effect's cleanup ran yDoc.off("update") while viewRef stayed set → early return on next run
    // never re-attached the listener, so outbound Yjs updates stopped after the first remote sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onYjsBridgeReady, syncKey]);

  /** Merge server CRDT when `lastYjsSequence` advances (same step); passive tabs and late snapshots. */
  useEffect(() => {
    const activeDoc = yDocRef.current;
    if (!activeDoc) return;
    if (lastSyncKeyForServerSeqRef.current !== syncKey) {
      lastSyncKeyForServerSeqRef.current = syncKey;
      lastAppliedServerYjsSeqRef.current = -1;
      lastAppliedServerYjsSnapRef.current = null;
    }
    const seq =
      typeof serverYjsSequence === "number" && !Number.isNaN(serverYjsSequence)
        ? serverYjsSequence
        : 0;
    const snap = serverYjsBase64?.trim() ?? "";
    const seqAdvanced = seq > lastAppliedServerYjsSeqRef.current;
    const snapChangedAtSameSeq =
      seq === lastAppliedServerYjsSeqRef.current &&
      snap !== lastAppliedServerYjsSnapRef.current;
    if (!seqAdvanced && !snapChangedAtSameSeq) return;
    try {
      if (snap) {
        const raw = base64ToBytes(snap);
        if (raw.length > 0) {
          Y.applyUpdate(activeDoc, raw, "remote");
        }
      }
    } catch (e) {
      roomSyncLog("merge_server_yjs_seq_failed", { error: String(e) });
    }
    lastAppliedServerYjsSeqRef.current = seq;
    lastAppliedServerYjsSnapRef.current = snap || null;
    onEditorValueChangeRef.current(activeDoc.getText("room-code").toString());
    bumpLocalAwarenessAfterRemoteDocChange();
  }, [
    bumpLocalAwarenessAfterRemoteDocChange,
    serverYjsBase64,
    serverYjsSequence,
    syncKey,
  ]);

  /** Step change or explicit resync (focus/reconnect): merge server Y snapshot or plain code fallback. */
  useEffect(() => {
    const activeDoc = yDocRef.current;
    if (!activeDoc) return;
    const syncKeyChanged = syncKeyRef.current !== syncKey;
    syncKeyRef.current = syncKey;
    const forceHydrateFromState =
      resyncSignal > lastHandledResyncSignalRef.current;
    if (forceHydrateFromState) {
      lastHandledResyncSignalRef.current = resyncSignal;
    }
    if (!syncKeyChanged && !forceHydrateFromState) return;

    const t = activeDoc.getText("room-code");
    const next = value ?? "";
    const snap = serverYjsBase64?.trim() ?? "";
    const normalizedServerYjsSequence =
      typeof serverYjsSequence === "number" &&
      Number.isFinite(serverYjsSequence)
        ? Math.max(0, Math.floor(serverYjsSequence))
        : 0;
    const hasRemoteHistoryWithoutSnapshot =
      !snap && normalizedServerYjsSequence > 0;

    roomSyncLog("hydrate_from_server", {
      syncKeyChanged,
      resync: forceHydrateFromState,
      hasYjsSnap: Boolean(snap),
      codeLen: next.length,
    });
    try {
      if (snap) {
        const raw = base64ToBytes(snap);
        if (raw.length > 0) {
          Y.applyUpdate(activeDoc, raw, "remote");
        }
      }
      if (!snap && t.toString() !== next && !hasRemoteHistoryWithoutSnapshot) {
        activeDoc.transact(() => {
          t.delete(0, t.length);
          if (next) t.insert(0, next);
        }, "remote");
      }
      if (!snap && hasRemoteHistoryWithoutSnapshot) {
        roomSyncLog("skip_plain_hydrate_waiting_for_yjs_snapshot", {
          syncKey,
          codeLen: next.length,
        });
      }
    } catch (e) {
      roomSyncLog("hydrate_from_server_failed", { error: String(e) });
    }
    onEditorValueChangeRef.current(activeDoc.getText("room-code").toString());
    bumpLocalAwarenessAfterRemoteDocChange();
  }, [
    bumpLocalAwarenessAfterRemoteDocChange,
    resyncSignal,
    serverYjsBase64,
    serverYjsSequence,
    syncKey,
    value,
  ]);

  useEffect(() => {
    const activeView = viewRef.current;
    if (!activeView) return;
    activeView.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  useEffect(() => {
    const activeView = viewRef.current;
    if (!activeView) return;
    activeView.dispatch({
      effects: languageCompartmentRef.current.reconfigure(languageExtension),
    });
  }, [languageExtension]);

  return (
    <div
      className={roomPageStyles.codeEditorHost}
      data-testid="room-code-editor-host"
      style={{ height }}
      ref={hostRef}
    />
  );
}
