import { useLayoutEffect, useState } from "react";

type RoomLearningStep = {
  title: string;
  description: string;
  anchors: readonly string[];
  spotlightAnchors?: readonly string[];
  completeWhenVisible?: readonly string[];
  advanceOn?: readonly string[];
  alternative?: string;
};

const goToTasks = "Перейти к задачам";
const keepTask = "Оставить активную задачу";
const withoutBoard = "Продолжить без доски";
const withoutDiagram = "Продолжить без диаграммы";
const keepSize = "Оставить текущий размер";

export const ROOM_LEARNING_STEPS: readonly RoomLearningStep[] = [
  {
    title: "Личные заметки",
    description: "Откройте «Мои заметки», чтобы посмотреть, где сохранять наблюдения по задачам. Эти записи видите только вы.",
    anchors: ["room-workspaces-tab", "room-workspaces", "room-editor"],
    alternative: goToTasks,
  },
  {
    title: "Выбор и публикация шага",
    description: "В «Шагах» собраны задачи интервью. Выберите другую задачу, чтобы посмотреть её в своей рабочей области. Кнопка «Переключить» показывает выбранную задачу всем участникам.",
    anchors: ["room-step-select", "room-steps", "room-workspaces"],
    spotlightAnchors: ["room-task-panel"],
    completeWhenVisible: ["room-local-task-selected"],
    alternative: keepTask,
  },
  {
    title: "Режим комнаты",
    description: "Откройте «Режим комнаты», выберите Markdown и подтвердите выбор. Режим изменится у всех участников.",
    anchors: ["room-mode", "room-editor"],
    completeWhenVisible: ["room-mode-markdown"],
    alternative: "Оставить текущий режим",
  },
  {
    title: "Markdown на весь экран",
    description: "Чтобы попробовать полноэкранный Markdown, выберите этот режим в списке «Режим комнаты».",
    anchors: ["room-mode", "room-editor"],
    alternative: keepSize,
  },
  {
    title: "Доска для набросков",
    description: "Выберите «Доска» в меню режимов и подтвердите выбор. На доске можно вместе рисовать и добавлять фигуры.",
    anchors: ["room-mode", "room-editor"],
    alternative: withoutBoard,
  },
  {
    title: "Редактор диаграмм",
    description: "Выберите «Редактор диаграмм» в меню режимов и подтвердите выбор, чтобы открыть общий редактор схем.",
    anchors: ["room-mode", "room-editor"],
    alternative: withoutDiagram,
  },
  {
    title: "Логи кандидата",
    description: "Откройте «Активность», чтобы увидеть журнал. Группы можно раскрывать. Потеря фокуса отмечает переключение, а его причина по журналу неизвестна.",
    anchors: ["room-activity", "room-workspaces", "room-editor"],
    completeWhenVisible: ["room-activity-open"],
    alternative: "Не открывать журнал",
  },
  {
    title: "Результат интервью",
    description: "Откройте «Завершить интервью», чтобы увидеть форму результата. В завершённом интервью она открывается кнопкой «Изменить результат». Для обучения достаточно посмотреть форму.",
    anchors: ["room-result", "room-mode", "room-editor"],
    completeWhenVisible: ["room-result-open"],
    alternative: "Закончить без изменения результата",
  },
];

const openChatStep: RoomLearningStep = {
  title: "Чат интервьюеров",
  description: "Откройте «Чат», чтобы обсудить ход интервью с коллегами. Кандидат не видит этот чат.",
  anchors: ["room-chat-tab", "room-workspaces"],
  alternative: goToTasks,
};

const openTasksStep: RoomLearningStep = {
  title: "Задачи интервью",
  description: "Откройте «Шаги», чтобы посмотреть задачи интервью в порядке их показа и подготовить следующее задание.",
  anchors: ["room-steps", "room-workspaces", "room-editor"],
  alternative: "Продолжить без просмотра задач",
};

const openTasksAfterChat: RoomLearningStep = {
  ...openTasksStep,
  advanceOn: ["room-steps"],
  alternative: undefined,
};

const firstTaskStep: RoomLearningStep = {
  title: "Добавьте первую задачу",
  description: "В комнате пока нет задач. Нажмите «Задача», чтобы выбрать задание из банка или создать новое для этого интервью.",
  anchors: ["room-task-add", "room-task-panel"],
  spotlightAnchors: ["room-task-panel"],
  alternative: "Продолжить без задач",
};

const singleTaskStep: RoomLearningStep = {
  title: "Одна задача в комнате",
  description: "Эта задача уже открыта для всех участников. Кнопка «Задача» добавляет следующий шаг интервью из библиотеки.",
  anchors: ["room-task-add", "room-task-panel"],
  spotlightAnchors: ["room-task-panel"],
  alternative: keepTask,
};

const emptyTaskViewStep: RoomLearningStep = {
  title: "Задачи интервью",
  description: "В этой комнате пока нет задач. Здесь появятся задания, добавленные к интервью.",
  anchors: ["room-task-panel"],
  alternative: "Продолжить без задач",
};

const singleTaskViewStep: RoomLearningStep = {
  title: "Одна задача в комнате",
  description: "Эта задача уже открыта для всех участников. Условие можно посмотреть рядом с редактором.",
  anchors: ["room-task-panel"],
  alternative: keepTask,
};

const markdownExpandStep: RoomLearningStep = {
  title: "Markdown на весь экран",
  description: "Нажмите кнопку с диагональными стрелками, чтобы развернуть редактор в своей вкладке.",
  anchors: ["room-markdown-expand"],
  alternative: keepSize,
};

const reopenEditorStep: RoomLearningStep = {
  title: "Вернитесь к редактору",
  description: "Режим уже выбран. Нажмите «Вернуться к редактору», чтобы открыть его и развернуть на весь экран.",
  anchors: ["room-editor-return"],
  alternative: keepSize,
};

const waitingForEditorStep: RoomLearningStep = {
  title: "Рабочая область редактора",
  description: "Когда редактор откроется, здесь появится подсказка к полноэкранному виду.",
  anchors: ["room-editor", "room-mode"],
  alternative: keepSize,
};

const boardToolsStep: RoomLearningStep = {
  title: "Инструменты доски",
  description: "На панели можно выбрать карандаш, фигуры, текст и другие инструменты. Выберите «Прямоугольник» или сразу разверните доску.",
  anchors: ["room-whiteboard-tools"],
  spotlightAnchors: ["room-whiteboard-expand"],
  alternative: withoutBoard,
};

const boardExpandStep: RoomLearningStep = {
  title: "Доска на весь экран",
  description: "Нажмите «На весь экран», чтобы дать доске больше места в своей вкладке.",
  anchors: ["room-whiteboard-expand"],
  spotlightAnchors: ["room-whiteboard-tools"],
  alternative: withoutBoard,
};

const diagramExpandStep: RoomLearningStep = {
  title: "Диаграмма на весь экран",
  description: "Нажмите «На весь экран», чтобы развернуть схему. «Закреплённый цвет» можно применить к новым фигурам.",
  anchors: ["room-diagram-expand"],
  spotlightAnchors: ["room-diagram-toolbar"],
  alternative: withoutDiagram,
};

const fullscreenPhases = [
  { anchor: "room-condition-collapse", lesson: null, label: "Сверните полноэкранное условие, чтобы вернуться к панелям интервью." },
  { anchor: "room-markdown-collapse", lesson: 3, label: "Нажмите «Свернуть markdown», чтобы вернуться к обычному виду комнаты." },
  { anchor: "room-whiteboard-collapse", lesson: 4, label: "Нажмите «Вернуться в комнату», чтобы снова увидеть другие панели интервью." },
  { anchor: "room-diagram-collapse", lesson: 5, label: "Нажмите «Вернуться в комнату», чтобы снова увидеть другие панели интервью." },
] as const;

const fullscreenReturnSteps = fullscreenPhases.map(({ anchor, lesson, label }) => {
  const guide: RoomLearningStep = {
    title: "Вернитесь к интервью",
    description: label,
    anchors: [anchor],
    spotlightAnchors: lesson === 4 ? ["room-whiteboard-tools"] : undefined,
  };
  return { anchor, lesson, guide, completionGuide: { ...guide, advanceOn: [anchor] } };
});

function resolveRoomLearningStep(index: number, anchors: ReadonlyMap<string, HTMLElement>) {
  const fullscreen = fullscreenReturnSteps.find(({ anchor }) => anchors.has(anchor));
  if (fullscreen) return fullscreen.lesson === index ? fullscreen.completionGuide : fullscreen.guide;
  const activeEditorGuide = anchors.has("room-editor-return") ? reopenEditorStep : waitingForEditorStep;

  switch (index) {
    case 0:
      if (anchors.has("room-chat-open") && anchors.has("room-chat-panel")) return openTasksAfterChat;
      if (anchors.has("room-notes-open") && anchors.has("room-notes-panel")) return openChatStep;
      break;
    case 1: {
      const tasks = anchors.get("room-task-panel")?.dataset.learningTaskCount;
      if (tasks === undefined) return openTasksStep;
      const canAddTask = anchors.has("room-task-add");
      if (tasks === "0") return canAddTask ? firstTaskStep : emptyTaskViewStep;
      if (tasks === "1") return canAddTask ? singleTaskStep : singleTaskViewStep;
      break;
    }
    case 3:
      if (anchors.has("room-markdown-expand")) return markdownExpandStep;
      if (anchors.has("room-mode-markdown")) return activeEditorGuide;
      break;
    case 4:
      if (anchors.has("room-whiteboard-tools") && !anchors.has("room-whiteboard-rectangle-selected")) return boardToolsStep;
      if (anchors.has("room-whiteboard-expand")) return boardExpandStep;
      if (anchors.has("room-mode-whiteboard")) return activeEditorGuide;
      break;
    case 5:
      if (anchors.has("room-diagram-expand")) return diagramExpandStep;
      if (anchors.has("room-mode-diagram")) return activeEditorGuide;
      break;
  }

  return ROOM_LEARNING_STEPS[index];
}

function visibleRoomAnchors() {
  const anchors = new Map<string, HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-learning-anchor^="room-"]')) {
    const anchor = element.dataset.learningAnchor;
    if (anchor && !anchors.has(anchor) && element.getClientRects().length > 0 &&
        !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
        getComputedStyle(element).visibility === "visible") {
      anchors.set(anchor, element);
    }
  }
  return anchors;
}

export function useRoomLearningStep(index: number | null): RoomLearningStep | undefined {
  const [current, setCurrent] = useState<{ index: number; step: RoomLearningStep }>();

  useLayoutEffect(() => {
    if (index === null) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const step = resolveRoomLearningStep(index, visibleRoomAnchors());
      setCurrent((previous) => previous?.index === index && previous.step === step ? previous : { index, step });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "inert", "aria-hidden", "data-learning-anchor", "data-learning-task-count"],
    });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [index]);

  if (index === null) return undefined;
  return current?.index === index ? current.step : ROOM_LEARNING_STEPS[index];
}
