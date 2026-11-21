import { ROOM_LEARNING_STEPS } from "./roomLearningSteps";
import type { ContextSurface } from "./learningNavigation";

export const librarySetCreateCopy = {
  title: "Создайте набор задач",
  description: "Сохраните подборку задач, чтобы использовать её в других интервью. Если библиотека пуста, сначала добавьте задачу на вкладке «Задачи».",
  inlineDescription: "Введите название, выберите задачи и сохраните набор. При пустой библиотеке сначала добавьте задачу на вкладке «Задачи».",
} as const;

export const teamCandidatesStep = {
  title: "Откройте кандидатов команды",
  description: "Во вкладке «Кандидаты» собраны интервью этой команды. Здесь можно открыть результат встречи или выгрузить выборку в Excel.",
  anchors: ["team-candidates-link", "team-sections-menu"],
  advanceOn: ["team-candidates-link"],
  alternative: "Завершить без посещения кандидатов",
} as const;

export function candidateExportStep(team: boolean) {
  const filters = team ? "по выбранным периоду, треку и вакансии" : "за выбранный период";
  return {
    title: "Скачайте Excel по выборке",
    description: `В файл входят все доступные интервью ${filters}, включая записи с других страниц. На листе «Интервью» для каждой встречи есть строка с кандидатом, вердиктом, комментарием к решению и заметками ведущего. На листе «Оценки» записаны баллы по задачам.`,
    anchors: ["candidates-export", "candidates-title"],
    alternative: "Завершить обзор выгрузки",
  };
}

export const emptyTrackProgrammeDescription =
  "Если треков пока нет, задачи появятся в активных карточках после настройки. Вакансия может иметь свои задачи или наследовать их от трека. Действующие задачи подставляются в новое интервью при выборе трека или вакансии.";

const personalTeamStep = {
  title: "Создайте команду для совместной работы",
  description: "В команде коллеги могут вместе готовить задачи и проводить интервью. Откройте «Личное» и нажмите «Создать команду» или выберите уже доступную команду. Пригласить коллег можно в настройках команды.",
  inlineDescription: "Введите название и нажмите «Создать команду». В её настройках можно будет пригласить коллег.",
  anchors: ["workspace-team-name", "workspace-create-team", "workspace-switcher"],
  advanceOn: ["workspace-team-option", "workspace-team-form"],
  alternative: "Остаться в личном разделе",
} as const;

export const LEARNING_MODULES = {
  personal_interviews: {
    title: "Личное пространство",
    duration: "1–2 минуты",
    steps: [
      {
        title: "Создайте задачи в библиотеке",
        description: "Откройте «Библиотека → Задачи → Создать задачу». Сохранённые задачи можно выбирать при подготовке интервью.",
        anchors: ["personal-library-link", "personal-sections-menu"],
        advanceOn: ["personal-library-link"],
        alternative: "Посмотреть создание интервью",
      },
      {
        title: "Создайте интервью",
        description: "Нажмите «Создать интервью». Укажите название, при необходимости добавьте задачи из библиотеки и сохраните.",
        anchors: ["interview-create"],
        advanceOn: ["interview-create"],
        alternative: "Посмотреть вход в готовую комнату",
      },
      {
        title: "Войдите в комнату",
        description: "В карточке готового интервью нажмите «Войти в комнату». Там можно проводить встречу и скопировать приглашение для кандидата. Если список пуст, сначала создайте интервью.",
        anchors: ["interview-enter", "interview-create"],
        advanceOn: ["interview-enter", "interview-create"],
        alternative: "Посмотреть командные пространства",
      },
      personalTeamStep,
    ],
  },
  team_interviews: {
    title: "Командное пространство",
    duration: "1–2 минуты",
    steps: [
      {
        title: "Откройте командную библиотеку",
        description: "Здесь хранятся задачи и наборы этой команды. Откройте «Библиотека», чтобы использовать общие материалы в новом интервью.",
        anchors: ["team-library-link", "team-sections-menu"],
        advanceOn: ["team-library-link"],
        alternative: "Посмотреть треки и вакансии",
      },
      {
        title: "Найдите треки и вакансии",
        description: "Откройте «Треки и вакансии», чтобы посмотреть, какие задачи подставятся в интервью по конкретному направлению или вакансии.",
        anchors: ["team-tracks-link", "team-sections-menu"],
        advanceOn: ["team-tracks-link"],
        alternative: "Посмотреть создание интервью",
      },
      {
        title: "Создайте командное интервью",
        description: "Нажмите «Создать интервью». В форме можно выбрать трек или вакансию. Действующие задачи этого процесса будут выбраны автоматически.",
        anchors: ["interview-create"],
        advanceOn: ["interview-create"],
        alternative: "Посмотреть вход в готовую комнату",
      },
      {
        title: "Пригласите на встречу",
        description: "Кнопка «Копировать ссылку для кандидата» в карточке даёт ссылку на конкретную встречу. Для вступления сотрудников в команду используется приглашение из настроек команды.",
        anchors: ["interview-copy", "interview-card", "interview-create"],
        advanceOn: ["interview-copy"],
        alternative: "Завершить без копирования ссылки",
      },
    ],
  },
  library: {
    title: "Библиотека",
    duration: "1–2 минуты",
    steps: [
      {
        title: "Создайте задачу",
        description: "Во вкладке «Задачи» нажмите «Создать задачу». В форме можно указать язык, условие и стартовый код для интервью.",
        anchors: ["library-task-title", "library-create-task", "library-tasks", "library-title"],
        inlineDescription: "Введите название, укажите язык и при необходимости добавьте условие и стартовый код. Сохраните задачу или закройте форму.",
        alternative: "Посмотреть наборы без создания задачи",
      },
      {
        title: "Откройте наборы задач",
        description: "Откройте вкладку «Наборы задач», чтобы собрать задачи для интервью в подборку.",
        anchors: ["library-set-title", "library-create-set", "library-sets", "library-title"],
        alternative: "Завершить без набора",
      },
    ],
  },
  candidates: {
    title: "Кандидаты",
    duration: "1–2 минуты",
    steps: [
      {
        title: "Отфильтровать список",
        description: "Укажите даты и нажмите «Применить период». В команде можно также выбрать трек и вакансию. Кнопка «Результаты» в строке открывает вердикт и оценки по отдельному интервью.",
        anchors: ["candidates-period", "candidates-title"],
        completeWhenVisible: ["candidates-period-applied"],
        alternative: "Посмотреть выгрузку Excel",
      },
      candidateExportStep(false),
    ],
  },
  tracks: {
    title: "Треки и вакансии",
    duration: "1–2 минуты",
    steps: [
      {
        title: "Найти трек",
        description: "Трек объединяет вакансии одного направления. Вы можете найти трек или вакансию по названию. Закрытые позиции находятся во вкладке «Архив».",
        anchors: ["track-search"],
        advanceOn: ["track-search"],
        alternative: "Посмотреть подсказку о программе",
      },
      {
        title: "Посмотреть программу",
        description: "Вакансия наследует задачи трека, пока для неё не заданы свои. При выборе трека или вакансии в новом интервью действующие задачи выбраны автоматически. Организатор может изменить состав перед созданием встречи, а владелец или администратор меняют общий список и порядок через «Настроить задачи».",
        anchors: ["track-vacancy-programme", "track-programme", "track-search"],
        alternative: "Завершить обзор программы",
      },
    ],
  },
  team_settings: {
    title: "Настройки команды",
    duration: "1–2 минуты",
    steps: [
      {
        title: "Найти участника",
        description: "В таблице участников видны имена, роли и процессы команды. Доступные действия находятся в той же строке.",
        anchors: ["team-settings-members", "team-settings-title"],
        alternative: "Посмотреть доступные действия с участниками",
      },
      {
        title: "Посмотреть доступные действия",
        description: "Колонка «Действия» показывает операции, доступные вашей роли. Изменение роли, передача владения и удаление участника требуют подтверждения.",
        anchors: ["team-settings-role", "team-settings-actions", "team-settings-title"],
        advanceOn: ["team-settings-role"],
        alternative: "Завершить без изменения ролей",
      },
    ],
  },
  room: {
    title: "Комната интервьюера",
    duration: "Около 3 минут",
    steps: ROOM_LEARNING_STEPS,
  },
} as const;
export type LearningModule = keyof typeof LEARNING_MODULES;
export type LearningProgressModule = LearningModule | "onboarding";
export type LearningSource = "offer" | "help";
export type LearningState = {
  module: LearningProgressModule;
  version: number;
  revision: number;
  offerSeen: boolean;
  skipped: boolean;
  status: "new" | "in_progress" | "cancelled" | "completed";
  attempt: number;
  attemptType: "first" | "retry" | "replay";
  completedSteps: number;
  firstStartedAt: string | null;
  firstCompletedAt: string | null;
  completions: number;
};
export function workspaceLearningModule(
  section: string | null,
  team: boolean,
): LearningModule | undefined {
  if (section === "interviews")
    return team ? "team_interviews" : "personal_interviews";
  if (section === "library" || section === "candidates") return section;
  if (team && section === "tracks") return "tracks";
  if (team && section === "settings") return "team_settings";
  return undefined;
}

export function contextualLearningDefinition(module: LearningModule, surface?: ContextSurface) {
  const definition = LEARNING_MODULES[module];
  if (module === "team_interviews" && surface === "team-interviews") {
    const { steps } = LEARNING_MODULES.team_interviews;
    return {
      ...LEARNING_MODULES.team_interviews,
      checkpointCount: steps.length,
      steps: [...steps.slice(0, -1), { ...steps[steps.length - 1], alternative: "Перейти к кандидатам без копирования ссылки" }, teamCandidatesStep],
    };
  }
  if (module === "candidates" && surface === "team-candidates") {
    return { ...LEARNING_MODULES.candidates, steps: [LEARNING_MODULES.candidates.steps[0], candidateExportStep(true)] };
  }
  if (surface !== "personal-library" && surface !== "personal-candidates") return definition;
  if (module !== "library" && module !== "candidates") return definition;

  const [first, last] = LEARNING_MODULES[module].steps;
  const alternative = module === "library"
    ? "Перейти к командам без набора"
    : "Перейти к командам";
  return {
    ...definition,
    checkpointCount: LEARNING_MODULES[module].steps.length,
    steps: [first, { ...last, alternative }, personalTeamStep],
  };
}
