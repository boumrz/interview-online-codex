import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, Tooltip } from "@mantine/core";
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconLayoutColumns,
  IconLayoutRows,
} from "@tabler/icons-react";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorSelection, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { markdownToHtml } from "../../components/markdown";
import roomPageStyles from "../../pages/RoomPage.module.css";

type MarkdownToolId =
  | "bold"
  | "italic"
  | "code"
  | "codeblock"
  | "link"
  | "h1"
  | "h2"
  | "ul"
  | "ol"
  | "quote"
  | "table";

export type BriefingBoardProps = {
  mode: "interviewer" | "candidate";
  value: string;
  onChange?: (value: string) => void;
  /**
   * Включён ли «focus mode»: код-редактор скрыт, и markdown
   * занимает всю рабочую область. Синхронизируется через
   * `briefingMarkdown` (см. `briefingFocusMode.ts`).
   */
  focusMode?: boolean;
  /**
   * Колбэк для переключения focus mode. Доступен только интервьюеру —
   * у кандидата кнопка не отображается, состояние приходит «сверху».
   */
  onFocusModeChange?: (next: boolean) => void;
};

type MarkdownEditorHandle = {
  focus: () => void;
  getSelectionRange: () => { selectionStart: number; selectionEnd: number };
  setSelectionRange: (selectionStart: number, selectionEnd: number) => void;
};

type MarkdownCodeMirrorEditorProps = {
  value: string;
  onChange?: (value: string) => void;
};

/**
 * Markdown-брифинг задачи.
 *
 * - Для интервьюера сверху лежит панель с markdown-инструментами,
 *   а ниже редактор и live-preview бок-о-бок.
 * - Для кандидата — только preview.
 *
 * Раньше жил inline в `RoomPage.tsx` (~250 строк). Вынесен отдельно,
 * потому что у него 100% локальное состояние (только `value`/`onChange`)
 * и набор пюре-helper'ов для markdown-редактирования, которые не
 * нужны больше нигде.
 */
export function BriefingBoard({
  mode,
  value,
  onChange,
  focusMode = false,
  onFocusModeChange,
}: BriefingBoardProps) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  /**
   * Локальный «fullscreen»: разворачивает панель брифинга поверх
   * комнаты на весь viewport. Состояние локальное у каждого участника
   * (интервьюер может развернуть, кандидат — нет, и наоборот).
   * Не путать с `focusMode`, который синхронизируется между сторонами.
   */
  const [isExpanded, setIsExpanded] = useState(false);
  const html = useMemo(() => markdownToHtml(value), [value]);
  const emptyText =
    mode === "interviewer"
      ? "Напишите объяснение или подсказки для кандидата."
      : "Интервьюер еще не добавил пояснение.";

  // ESC закрывает локальный fullscreen, чтобы поведение совпадало с
  // другими «модалками» комнаты.
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded]);

  const applyWrap = useCallback(
    (prefix: string, suffix: string, placeholder: string) => {
      if (!onChange) return;
      const editor = editorRef.current;
      const selection = editor?.getSelectionRange();
      const selectionStart = selection?.selectionStart ?? 0;
      const selectionEnd = selection?.selectionEnd ?? 0;
      const selected = value.slice(selectionStart, selectionEnd);
      const content = selected || placeholder;
      const next = `${value.slice(0, selectionStart)}${prefix}${content}${suffix}${value.slice(selectionEnd)}`;
      onChange(next);
      const rangeStart = selectionStart + prefix.length;
      const rangeEnd = rangeStart + content.length;
      requestAnimationFrame(() => {
        editor?.focus();
        editor?.setSelectionRange(rangeStart, rangeEnd);
      });
    },
    [onChange, value],
  );

  const applyLinePrefix = useCallback(
    (prefix: string) => {
      if (!onChange) return;
      const editor = editorRef.current;
      const selection = editor?.getSelectionRange();
      const selectionStart = selection?.selectionStart ?? 0;
      const selectionEnd = selection?.selectionEnd ?? 0;
      const blockStart =
        value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
      const blockEndCandidate = value.indexOf("\n", selectionEnd);
      const blockEnd = blockEndCandidate < 0 ? value.length : blockEndCandidate;
      const original = value.slice(blockStart, blockEnd);
      const updated = original
        .split("\n")
        .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
        .join("\n");
      const next = `${value.slice(0, blockStart)}${updated}${value.slice(blockEnd)}`;
      onChange(next);
      requestAnimationFrame(() => {
        editor?.focus();
        editor?.setSelectionRange(blockStart, blockStart + updated.length);
      });
    },
    [onChange, value],
  );

  const insertSnippet = useCallback(
    (snippet: string) => {
      if (!onChange) return;
      const editor = editorRef.current;
      const selection = editor?.getSelectionRange();
      const selectionStart = selection?.selectionStart ?? value.length;
      const selectionEnd = selection?.selectionEnd ?? selectionStart;
      const needsLeadingLineBreak =
        selectionStart > 0 && value[selectionStart - 1] !== "\n";
      const needsTrailingLineBreak =
        selectionEnd < value.length && value[selectionEnd] !== "\n";
      const prefix = needsLeadingLineBreak ? "\n" : "";
      const suffix = needsTrailingLineBreak ? "\n" : "";
      const next = `${value.slice(0, selectionStart)}${prefix}${snippet}${suffix}${value.slice(selectionEnd)}`;
      onChange(next);
      const nextSelectionStart = selectionStart + prefix.length;
      const nextSelectionEnd = nextSelectionStart + snippet.length;
      requestAnimationFrame(() => {
        editor?.focus();
        editor?.setSelectionRange(nextSelectionStart, nextSelectionEnd);
      });
    },
    [onChange, value],
  );

  const applyMarkdownTool = useCallback(
    (tool: MarkdownToolId) => {
      if (tool === "bold") return applyWrap("**", "**", "текст");
      if (tool === "italic") return applyWrap("*", "*", "текст");
      if (tool === "code") return applyWrap("`", "`", "code");
      if (tool === "codeblock") return insertSnippet("```ts\n// code\n```");
      if (tool === "link") return applyWrap("[", "](https://)", "ссылка");
      if (tool === "h1") return applyLinePrefix("# ");
      if (tool === "h2") return applyLinePrefix("## ");
      if (tool === "ul") return applyLinePrefix("- ");
      if (tool === "ol") return applyLinePrefix("1. ");
      if (tool === "quote") return applyLinePrefix("> ");
      if (tool === "table") {
        return insertSnippet(
          "| Left columns  | Right columns |\n| ------------- |:-------------:|\n| left foo      | right foo     |\n| left bar      | right bar     |\n| left baz      | right baz     |",
        );
      }
    },
    [applyLinePrefix, applyWrap, insertSnippet],
  );

  // Когда панель раскрывают на весь экран — отключаем максимальную
  // высоту из RoomPage.module.css через data-атрибут, чтобы CSS мог
  // переопределить размерности оверлейного режима. Аналогично
  // `data-focus`, который реагирует на synced focus-mode.
  return (
    <Box
      className={roomPageStyles.briefingPanel}
      data-mode={mode}
      data-focus={focusMode ? "on" : "off"}
      data-expanded={isExpanded ? "on" : "off"}
      data-testid={`briefing-board-${mode}`}
    >
      {mode === "interviewer" ? (
        <>
          <div className={roomPageStyles.briefingToolbar}>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Жирный текст"
              title="Жирный текст"
              onClick={() => applyMarkdownTool("bold")}
            >
              B
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Курсив"
              title="Курсив"
              onClick={() => applyMarkdownTool("italic")}
            >
              I
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Вставить код"
              title="Вставить код"
              onClick={() => applyMarkdownTool("code")}
            >
              {"</>"}
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Code block"
              title="Code block"
              onClick={() => applyMarkdownTool("codeblock")}
            >
              Code
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Вставить ссылку"
              title="Вставить ссылку"
              onClick={() => applyMarkdownTool("link")}
            >
              Link
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Заголовок H1"
              title="Заголовок H1"
              onClick={() => applyMarkdownTool("h1")}
            >
              H1
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Заголовок H2"
              title="Заголовок H2"
              onClick={() => applyMarkdownTool("h2")}
            >
              H2
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Маркированный список"
              title="Маркированный список"
              onClick={() => applyMarkdownTool("ul")}
            >
              • List
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Нумерованный список"
              title="Нумерованный список"
              onClick={() => applyMarkdownTool("ol")}
            >
              1. List
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Цитата"
              title="Цитата"
              onClick={() => applyMarkdownTool("quote")}
            >
              Quote
            </button>
            <button
              type="button"
              className={roomPageStyles.briefingToolButton}
              aria-label="Table"
              title="Table"
              onClick={() => applyMarkdownTool("table")}
            >
              Table
            </button>
            {/*
              Отделитель + утилитарные кнопки. focus-mode синхронизирован
              (см. RoomPage → onFocusModeChange), expand — локальный.
            */}
            <span className={roomPageStyles.briefingToolbarSpacer} aria-hidden />
            {onFocusModeChange ? (
              <Tooltip
                label={
                  focusMode
                    ? "Вернуть код-редактор у обоих участников"
                    : "Заменить блок с кодом на markdown у обоих участников"
                }
                position="bottom"
                withArrow
              >
                <button
                  type="button"
                  data-testid="briefing-focus-toggle"
                  data-state={focusMode ? "on" : "off"}
                  className={`${roomPageStyles.briefingToolButton} ${
                    focusMode ? roomPageStyles.briefingToolButtonActive : ""
                  }`.trim()}
                  aria-pressed={focusMode}
                  aria-label={
                    focusMode
                      ? "Выключить режим только-markdown"
                      : "Заменить блок кода на markdown"
                  }
                  onClick={() => onFocusModeChange(!focusMode)}
                >
                  {focusMode ? (
                    <IconLayoutColumns size={14} aria-hidden />
                  ) : (
                    <IconLayoutRows size={14} aria-hidden />
                  )}
                </button>
              </Tooltip>
            ) : null}
            <Tooltip
              label={
                isExpanded
                  ? "Свернуть markdown к стандартному размеру"
                  : "Развернуть markdown на весь экран"
              }
              position="bottom"
              withArrow
            >
              <button
                type="button"
                data-testid="briefing-expand-toggle"
                className={roomPageStyles.briefingToolButton}
                aria-pressed={isExpanded}
                aria-label={
                  isExpanded ? "Свернуть markdown" : "Развернуть markdown"
                }
                onClick={() => setIsExpanded((prev) => !prev)}
              >
                {isExpanded ? (
                  <IconArrowsDiagonalMinimize2 size={14} aria-hidden />
                ) : (
                  <IconArrowsDiagonal size={14} aria-hidden />
                )}
              </button>
            </Tooltip>
          </div>
          <div className={roomPageStyles.briefingSplit}>
            <MarkdownCodeMirrorEditor
              ref={editorRef}
              value={value}
              onChange={onChange}
            />
            <div
              className={roomPageStyles.briefingPreviewPane}
              data-testid="room-markdown-preview"
            >
              {html ? (
                <div
                  className={roomPageStyles.briefingMarkdown}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <Text className={roomPageStyles.briefingEmpty}>
                  {emptyText}
                </Text>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/*
            У кандидата нет инструментов редактирования, но мы всё равно
            даём ему локальную кнопку «развернуть» — чтобы он мог
            прочитать длинное ТЗ на весь экран независимо от того,
            переключил ли интервьюер focus mode.
          */}
          <div className={roomPageStyles.briefingToolbarCandidate}>
            <Tooltip
              label={
                isExpanded
                  ? "Свернуть markdown к стандартному размеру"
                  : "Развернуть markdown на весь экран"
              }
              position="bottom"
              withArrow
            >
              <button
                type="button"
                data-testid="briefing-expand-toggle"
                className={roomPageStyles.briefingToolButton}
                aria-pressed={isExpanded}
                aria-label={
                  isExpanded ? "Свернуть markdown" : "Развернуть markdown"
                }
                onClick={() => setIsExpanded((prev) => !prev)}
              >
                {isExpanded ? (
                  <IconArrowsDiagonalMinimize2 size={14} aria-hidden />
                ) : (
                  <IconArrowsDiagonal size={14} aria-hidden />
                )}
              </button>
            </Tooltip>
          </div>
          <div
            className={roomPageStyles.briefingPreviewPane}
            data-testid="room-markdown-preview"
          >
            {html ? (
              <div
                className={roomPageStyles.briefingMarkdown}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <Text className={roomPageStyles.briefingEmpty}>{emptyText}</Text>
            )}
          </div>
        </>
      )}
    </Box>
  );
}

const MarkdownCodeMirrorEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownCodeMirrorEditorProps
>(function MarkdownCodeMirrorEditor(
  { value, onChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const applyingExternalValueRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const extensions = useMemo(
    () => [
      oneDark,
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      indentOnInput(),
      closeBrackets(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
      }),
      EditorView.lineWrapping,
      EditorView.theme(
        {
          "&": {
            height: "100%",
          },
          ".cm-scroller": {
            overflow: "auto",
          },
        },
        { dark: true },
      ),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingExternalValueRef.current) return;
        const next = update.state.doc.toString();
        valueRef.current = next;
        onChangeRef.current?.(next);
      }),
    ],
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: valueRef.current,
        extensions,
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    const selection = view.state.selection.main;
    const nextLength = value.length;
    applyingExternalValueRef.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: EditorSelection.range(
        Math.min(selection.anchor, nextLength),
        Math.min(selection.head, nextLength),
      ),
    });
    applyingExternalValueRef.current = false;
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        viewRef.current?.focus();
      },
      getSelectionRange: () => {
        const selection = viewRef.current?.state.selection.main;
        return {
          selectionStart: selection?.from ?? 0,
          selectionEnd: selection?.to ?? 0,
        };
      },
      setSelectionRange: (selectionStart, selectionEnd) => {
        const view = viewRef.current;
        if (!view) return;
        const docLength = view.state.doc.length;
        const start = Math.min(Math.max(selectionStart, 0), docLength);
        const end = Math.min(Math.max(selectionEnd, 0), docLength);
        view.dispatch({
          selection: EditorSelection.range(start, end),
          scrollIntoView: true,
        });
      },
    }),
    [],
  );

  return (
    <div
      ref={hostRef}
      className={roomPageStyles.briefingEditorRoot}
      data-testid="room-markdown-editor"
      aria-label="Markdown task description"
    />
  );
});
