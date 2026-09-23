## Why

После редизайна пользователю трудно распознать переключатель личного и командного пространства как действие, а основная навигация команды переносится на вторую строку. В комнате редактор уже является очевидной постоянной рабочей областью, поэтому одноимённая вкладка создаёт лишний выбор; одновременно статичная раскладка не позволяет увеличить чат или другие контекстные панели для чтения и работы.

## What Changes

- Сделать переключатель личного/командного пространства явной интерактивной кнопкой с понятным текущим контекстом, состояниями открытия и клавиатурным управлением.
- Не допускать второго ряда основной навигации личного или командного пространства на поддерживаемых desktop/tablet размерах: переполнение должно оставаться в одной доступной строке, без горизонтального overflow страницы.
- Убрать из видимой навигации комнаты избыточную вкладку «Редактор», сохранив сам редактор, его landmark/label и все room-семантики.
- Вернуть изменение размеров видимых чат- и контекстных панелей мышью и клавиатурой с безопасными минимумами, без передачи локального layout-состояния на сервер или другим участникам.

## Capabilities

### New Capabilities

- `workspace-switcher-affordance`: явный, доступный выбор пространства и однострочная responsive-навигация рабочего пространства.
- `room-layout-affordances`: не избыточная навигация поверхности комнаты и локально изменяемые размеры её контекстных панелей.

### Modified Capabilities

- None. В accepted baseline ещё нет `workspace-navigation` и `room-context-panels`; они находятся в незавершённом change `design-team-interview-journey`. Это узкое remediation-изменение зависит от его реализованных UI-срезов и не меняет требования принятой базы.

## Impact

- Frontend only: `WorkspaceSwitcher`, оболочки personal/team workspace и CSS основной навигации; `RoomContextPanels` и его layout state/styles.
- Feature-on switcher/stale-list coverage extends `frontend/tests/e2e/teams/e2e-team-workspaces.mjs`; one-row navigation coverage extends `frontend/tests/e2e/teams/e2e-workspace-navigation.mjs`; room coverage extends `frontend/tests/e2e/interview/e2e-room-context-panels.mjs`. No backend API, schema, authorization, SSE, POST relay, RTK cache scope or Yjs document contract changes.
- Parent prerequisites are completed `design-team-interview-journey` sections 2.3 (personal workspace review), 3.3 (team switcher/cache UI) and 13.3 (room-context review). This remediation must finish before downstream unfinished 14.3 rebases its `RoomContextPanels` integration; AC-12 is not a prerequisite or a claimed regression gate here. It must not be used to enable `FEATURE_TEAM_WORKSPACES` before that change's security gate 12.6; the flag remains default-off.
