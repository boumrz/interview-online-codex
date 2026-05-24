import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export type PastePayload = {
  pasteLength: number;
  pastePreview: string;
};

/**
 * CodeMirror 6 extension: перехватывает DOM paste event на редакторе.
 * Вызывает onPaste с длиной и превью вставленного текста.
 * НЕ блокирует вставку — редактор работает как обычно.
 */
export function pasteDetectionExtension(
  onPaste: (payload: PastePayload) => void
): Extension {
  return EditorView.domEventHandlers({
    paste(event: ClipboardEvent) {
      try {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        onPaste({
          pasteLength: text.length,
          pastePreview: text.slice(0, 50),
        });
      } catch {
        // браузер заблокировал доступ к clipboard — шлём с нулями
        onPaste({ pasteLength: 0, pastePreview: "" });
      }
      return false; // не блокировать default behavior
    },
  });
}
