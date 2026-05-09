import React, { useCallback, useMemo, useRef } from "react";
import { Box, Text, Textarea } from "@mantine/core";

import { markdownToHtml } from "../../components/markdown";
import roomPageStyles from "../../pages/RoomPage.module.css";

type MarkdownToolId =
  | "bold"
  | "italic"
  | "code"
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
}: BriefingBoardProps) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const html = useMemo(() => markdownToHtml(value), [value]);
  const emptyText =
    mode === "interviewer"
      ? "Напишите объяснение или подсказки для кандидата."
      : "Интервьюер еще не добавил пояснение.";

  const applyWrap = useCallback(
    (prefix: string, suffix: string, placeholder: string) => {
      if (!onChange) return;
      const textarea = editorRef.current;
      const selectionStart = textarea?.selectionStart ?? 0;
      const selectionEnd = textarea?.selectionEnd ?? 0;
      const selected = value.slice(selectionStart, selectionEnd);
      const content = selected || placeholder;
      const next = `${value.slice(0, selectionStart)}${prefix}${content}${suffix}${value.slice(selectionEnd)}`;
      onChange(next);
      const rangeStart = selectionStart + prefix.length;
      const rangeEnd = rangeStart + content.length;
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(rangeStart, rangeEnd);
      });
    },
    [onChange, value],
  );

  const applyLinePrefix = useCallback(
    (prefix: string) => {
      if (!onChange) return;
      const textarea = editorRef.current;
      const selectionStart = textarea?.selectionStart ?? 0;
      const selectionEnd = textarea?.selectionEnd ?? 0;
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
        textarea?.focus();
        textarea?.setSelectionRange(blockStart, blockStart + updated.length);
      });
    },
    [onChange, value],
  );

  const insertSnippet = useCallback(
    (snippet: string) => {
      if (!onChange) return;
      const textarea = editorRef.current;
      const selectionStart = textarea?.selectionStart ?? value.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
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
        textarea?.focus();
        textarea?.setSelectionRange(nextSelectionStart, nextSelectionEnd);
      });
    },
    [onChange, value],
  );

  const applyMarkdownTool = useCallback(
    (tool: MarkdownToolId) => {
      if (tool === "bold") return applyWrap("**", "**", "текст");
      if (tool === "italic") return applyWrap("*", "*", "текст");
      if (tool === "code") return applyWrap("`", "`", "code");
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

  return (
    <Box className={roomPageStyles.briefingPanel} data-mode={mode}>
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
          </div>
          <div className={roomPageStyles.briefingSplit}>
            <Textarea
              value={value}
              onChange={(event) => onChange?.(event.currentTarget.value)}
              minRows={6}
              placeholder="Например: # План\n- Что делаем\n- На что смотреть"
              data-testid="room-markdown-editor"
              aria-label="Markdown-описание задачи"
              classNames={{
                root: roomPageStyles.briefingEditorRoot,
                wrapper: roomPageStyles.briefingEditorWrapper,
                input: roomPageStyles.briefingEditorInput,
              }}
              ref={editorRef}
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
      )}
    </Box>
  );
}
