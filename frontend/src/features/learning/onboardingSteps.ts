import { ROOM_LEARNING_STEPS } from "./roomLearningSteps";
import { candidateExportStep, teamCandidatesStep } from "./learningContent";

export type LearningSurface =
  | "personal-interviews" | "personal-library" | "personal-create"
  | "team-interviews" | "team-library" | "team-create" | "team-settings" | "team-tracks" | "team-candidates"
  | "room";
export type LearningForm = "task" | "task-set" | "team" | "interview";

export function onboardingForm(step: number | null, surface?: LearningSurface): LearningForm | undefined {
  if (step === 1) return "task";
  if (step === 2) return "team";
  if (step === 5 && surface?.endsWith("-create")) return "interview";
  return undefined;
}

export function getLearningSurface(pathname: string): LearningSurface | undefined {
  if (pathname.startsWith("/room/")) return "room";
  const personal = pathname.startsWith("/workspace/personal/");
  const team = pathname.startsWith("/workspace/teams/");
  if (!personal && !team) return undefined;
  if (pathname.endsWith("/interviews/new")) return personal ? "personal-create" : "team-create";
  if (pathname.endsWith("/interviews")) return personal ? "personal-interviews" : "team-interviews";
  if (pathname.endsWith("/library")) return personal ? "personal-library" : "team-library";
  if (team && pathname.endsWith("/settings")) return "team-settings";
  if (team && pathname.endsWith("/tracks")) return "team-tracks";
  if (team && pathname.endsWith("/candidates")) return "team-candidates";
  return undefined;
}

export function onboardingDefinition(surface?: LearningSurface) {
  const team = surface?.startsWith("team-");
  const teamOverview = surface === "team-settings" ? {
    title: "Откройте треки и вакансии",
    description: "Во вкладке «Треки и вакансии» команда группирует найм по направлениям и позициям. Задачи из опубликованной программы подставляются при создании подходящего интервью. Вакансия может иметь собственную программу или использовать программу трека.",
    anchors: ["team-tracks-link", "team-sections-menu"],
  } : surface === "team-tracks" ? { ...teamCandidatesStep, advanceOn: [], alternative: undefined }
    : surface === "team-candidates" ? { ...candidateExportStep(true), alternative: undefined } : undefined;
  return {
    title: "Первый маршрут",
    steps: [
      {
        title: "Откройте библиотеку",
        description: "В библиотеке можно сохранять задачи с условиями и заготовками решений. Откройте её через подсвеченную кнопку.",
        anchors: ["personal-library-link", "personal-sections-menu"],
      },
      {
        title: "Создайте задачу",
        description: "Откройте «Создать задачу», чтобы подготовить условие для интервью.",
        inlineDescription: "Введите название и выберите язык. При желании добавьте условие и стартовый код. Сохраните задачу или закройте форму.",
        anchors: ["library-task-title", "library-create-task", "library-tasks", "library-title"],
        alternative: "Перейти к командам без задачи",
      },
      {
        title: "Выберите рабочее пространство",
        description: "Откройте меню пространств и выберите команду или нажмите «Создать команду».",
        inlineDescription: "Введите название команды и нажмите «Создать». После сохранения откроется её пространство.",
        anchors: ["workspace-team-name", "workspace-create-team", "workspace-team-option", "workspace-switcher"],
        alternative: "Продолжить без команды",
      },
      {
        title: "Посмотрите, как работает команда",
        description: team
          ? "Откройте настройки команды. Там видны участники и их роли, а при наличии прав доступны приглашения."
          : "В команде можно совместно готовить задачи и проводить интервью. Состав участников и приглашения находятся в настройках команды. Нажмите «Интервью», чтобы открыть личный список.",
        anchors: team
          ? ["team-settings-link", "team-sections-menu", "workspace-switcher"]
          : ["personal-interviews-link", "personal-sections-menu"],
        advanceOn: team ? [] : ["personal-interviews-link"],
        alternative: team ? "Перейти к интервью без обзора команды" : undefined,
      },
      teamOverview ?? {
        title: "Откройте список интервью",
        description: "Перейдите в «Интервью» в текущем пространстве. Здесь видны готовые встречи и кнопка создания.",
        anchors: team
          ? ["team-interviews-link", "team-sections-menu"]
          : ["personal-interviews-link", "personal-sections-menu"],
      },
      {
        title: "Войдите в комнату интервью",
        description: "Откройте готовую комнату или нажмите «Создать интервью».",
        inlineDescription: "Введите название встречи и при желании добавьте задачи. Нажмите «Создать интервью», чтобы открыть комнату.",
        anchors: surface?.endsWith("-create")
          ? ["interview-form", "interview-title", "interview-submit"]
          : ["interview-enter", "interview-create"],
      },
      ...ROOM_LEARNING_STEPS,
    ],
  } as const;
}

export function onboardingAllowsSurface(step: number, surface?: LearningSurface) {
  if (!surface) return false;
  if (step === 0) return surface === "personal-interviews" || surface === "personal-library";
  if (step === 1) return surface === "personal-library";
  if (step >= 6) return surface === "room";
  if (step === 5) return surface === "room" || surface.endsWith("-interviews") || surface.endsWith("-create");
  return surface !== "room" && !surface.endsWith("-create");
}

export function onboardingArrived(step: number, surface?: LearningSurface) {
  if (step === 0) return surface === "personal-library";
  if (step === 2) return surface?.startsWith("team-") ?? false;
  if (step === 3) return surface === "team-settings";
  if (step === 4) return surface === "personal-interviews" || surface === "team-interviews";
  if (step === 5) return surface === "room";
  return false;
}

export function interviewFormGuide(team: boolean) {
  return {
    title: team ? "Создание командного интервью" : "Создание интервью",
    steps: [
      {
        title: "Укажите название",
        description: "Название поможет найти встречу в списке интервью.",
        anchors: ["interview-title", "interview-submit"],
        advanceOn: ["interview-title"],
        alternative: "Оставить текущее название",
      },
      {
        title: "Откройте выбор задач",
        description: team
          ? "При выборе трека или вакансии задачи подставляются из опубликованной программы. Откройте список, чтобы проверить и при необходимости изменить подборку."
          : "Откройте список задач из библиотеки. Выбранные задачи можно открыть по очереди в комнате.",
        anchors: ["interview-task-picker", "interview-title"],
        completeWhenPickerOpens: true,
        alternative: "Оставить текущий набор задач",
      },
      {
        title: "Проверьте параметры",
        description: "Перед сохранением проверьте название встречи и выбранные задачи.",
        anchors: ["interview-title", "interview-submit"],
        alternative: "Показать, где сохранить интервью",
      },
      {
        title: "Откройте комнату",
        description: team
          ? "Когда форма готова, нажмите «Создать интервью». Откроется рабочая комната."
          : "Нажмите «Создать интервью», чтобы открыть комнату. После выхода из формы в меню «Личное» доступно действие «Создать команду» для совместной подготовки и проведения интервью.",
        anchors: ["interview-submit", "interview-title"],
        alternative: "Завершить подсказки",
      },
    ],
  } as const;
}
