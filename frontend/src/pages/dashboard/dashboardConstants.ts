/**
 * Statically known list of dashboard sections. Visibility of `agents` and
 * `admin` is controlled at runtime by feature flag and current user role,
 * so we expose them as separate constants and let the page compose the
 * final list.
 */
export type DashboardSection = "rooms" | "tasks" | "manage" | "agents" | "admin";

export interface DashboardSectionDescriptor {
  value: DashboardSection;
  label: string;
}

export const BASE_DASHBOARD_SECTIONS: DashboardSectionDescriptor[] = [
  { value: "rooms", label: "Комнаты" },
  { value: "tasks", label: "Задачи" },
  { value: "manage", label: "Управление комнатами" },
  { value: "agents", label: "Агент-операции" },
];

export const ADMIN_DASHBOARD_SECTION: DashboardSectionDescriptor = {
  value: "admin",
  label: "Админка",
};

export const LANGUAGE_OPTIONS = [
  { value: "nodejs", label: "Node JS" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" },
  { value: "java", label: "Java" },
  { value: "sql", label: "SQL" },
  /**
   * `plaintext` — синтетический "язык" для задач, где подсветка кода
   * не нужна (тексты, ТЗ, заметки). В CodeMirror интерпретируется как
   * `null`-extension (без grammar), в API/БД хранится как обычная
   * строка. Совместим с любым backend `LanguageNormalizer`,
   * который пропускает неизвестные значения без изменений.
   */
  { value: "plaintext", label: "Plain text" },
];
