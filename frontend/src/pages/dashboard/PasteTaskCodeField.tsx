import React, { useRef, useState } from "react";
import { Text, Textarea } from "@mantine/core";
import { decodeTaskShareCode } from "../../features/tasks/taskShareCode";
import { useCreateTaskTemplateMutation } from "../../services/api";
import { normalizeLanguageKey } from "./dashboardHelpers";
import { LANGUAGE_OPTIONS } from "./dashboardConstants";
import type { TaskTemplate } from "../../types";

export interface PasteTaskCodeFieldProps {
  /** Flat list of all existing tasks (for deduplication). Provided by parent. */
  existingTasks: Pick<TaskTemplate, "title" | "description" | "starterCode" | "language">[];
  /** Called after a successful POST with the normalised language of the imported task. */
  onImportSuccess: (language: string) => void;
}

const VALID_LANGUAGE_VALUES = new Set(LANGUAGE_OPTIONS.map((o) => o.value));

export function PasteTaskCodeField({ existingTasks, onImportSuccess }: PasteTaskCodeFieldProps) {
  const [value, setValue] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Synchronous guard against concurrent imports — state updates are async,
  // so a ref is the only reliable way to block a second call before the first
  // POST has resolved and re-rendered the component with disabled=true.
  const isImportingRef = useRef(false);

  const [createTask] = useCreateTaskTemplateMutation();

  const handleChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputValue = e.currentTarget.value;
    setValue(inputValue);

    setErrorMsg(null);
    setSuccessMsg(null);
    setWarningMsg(null);

    const result = decodeTaskShareCode(inputValue.trim());

    if (!result.ok) {
      if (result.reason === "not_a_share_code") {
        // Silently wait — user may still be typing or this is normal text input
        return;
      }
      if (result.reason === "malformed_encoding" || result.reason === "malformed_json" || result.reason === "invalid_schema") {
        setErrorMsg("Неверный формат кода задачи");
        return;
      }
      if (result.reason === "unsupported_version") {
        setErrorMsg("Код задачи создан в несовместимой версии");
        return;
      }
      return;
    }

    // Synchronous guard — prevents duplicate POSTs from rapid input events
    if (isImportingRef.current) return;

    const { payload } = result;

    // Normalize language
    const rawLang = normalizeLanguageKey(payload.language);
    const normLang = VALID_LANGUAGE_VALUES.has(rawLang) ? rawLang : "plaintext";

    // Validate title
    if (payload.title.trim() === "") {
      setErrorMsg("Название задачи обязательно");
      return;
    }

    let finalTitle = payload.title;
    let truncated = false;
    if (finalTitle.length > 200) {
      finalTitle = finalTitle.slice(0, 200);
      truncated = true;
    }

    // Deduplication: compare against the prop-provided task list
    const existingSignatures = new Set<string>();
    for (const task of existingTasks) {
      const sig = `${task.title.trim()}|${normalizeLanguageKey(task.language)}|${task.description.trim()}|${task.starterCode}`;
      existingSignatures.add(sig);
    }
    const incomingSignature = `${finalTitle.trim()}|${normLang}|${payload.description.trim()}|${payload.starterCode}`;
    if (existingSignatures.has(incomingSignature)) {
      setErrorMsg("Такая задача уже есть");
      setValue("");
      return;
    }

    if (truncated) {
      setWarningMsg("Название обрезано до 200 символов");
    }

    // Mark import in progress synchronously before any await
    isImportingRef.current = true;
    setIsImporting(true);

    try {
      await createTask({
        title: finalTitle.trim(),
        description: payload.description,
        starterCode: payload.starterCode,
        language: normLang,
      }).unwrap();

      setValue("");
      setWarningMsg(null);
      setSuccessMsg(
        truncated ? "Задача импортирована (название обрезано)" : "Задача импортирована",
      );
      onImportSuccess(normLang);
    } catch {
      setWarningMsg(null);
      setErrorMsg("Не удалось импортировать задачу");
    } finally {
      isImportingRef.current = false;
      setIsImporting(false);
    }
  };

  return (
    <div>
      <Textarea
        value={value}
        onChange={(e) => { void handleChange(e); }}
        placeholder="Вставьте код задачи (ITASK1:...)"
        minRows={2}
        disabled={isImporting}
      />
      {errorMsg && (
        <Text size="xs" c="red.4" role="alert">
          {errorMsg}
        </Text>
      )}
      {successMsg && (
        <Text size="xs" c="teal.4" aria-live="polite">
          {successMsg}
        </Text>
      )}
      {warningMsg && (
        <Text size="xs" c="yellow.4" aria-live="polite">
          {warningMsg}
        </Text>
      )}
    </div>
  );
}
