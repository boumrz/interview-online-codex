# 1.6b — UX flows и screen specs

Статус: designed, ожидает UX Critic review. Это prototype-only артефакт: он не доказывает server permissions и не заменяет application RED/GREEN.

## User flows

### Найти свою работу через процесс

1. Сотрудник открывает «Треки и вакансии» в Atlas.
2. Видит active/archived structure и только число доступных ему интервью — не кандидатов всей команды.
3. Открывает Frontend или вакансию; detail фиксирует team/process context и programme status.
4. «Мои интервью в этом процессе» повторяет caller-authorized rows. Без grant показывает «У вас нет доступных интервью», не «в команде нет интервью».
5. ADMIN/team OWNER дополнительно видят create/edit/archive; MEMBER читает и фильтрует.

### Использовать общую задачу или набор

1. MEMBER открывает team library, ищет по title/language и переключает active/archive; track filter отсутствует.
2. MEMBER просматривает или создаёт копию внутри Atlas; author/ADMIN/OWNER также редактируют и архивируют.
3. Вкладка «Наборы задач» показывает version/order и адресный stale item.
4. При edit сохраняется opened version. После simulated 409 локальные title/condition остаются; актуальная v4 не подменяет их молча.
5. Личный author может открыть explicit review «Опубликовать копию в команду»; destination и доступность всем сотрудникам подтверждаются, original остаётся personal.

### Создать интервью с программой

1. Creator открывает текстовую кнопку «+ Создать интервью» в Atlas.
2. В одном scrollable form заполняет context, candidate/time, active people, programme/tasks и final access summary.
3. Смена track очищает несовместимую vacancy с live message. Pending invites показаны отдельно и не выбираются как люди.
4. Resolver `published` показывает version и locked mandatory sequence; extras редактируются отдельно. `NONE` включает free selection. `draft`/`archived` блокируют submit без free fallback.
5. Перед submit никто не назначен. Во время локальной симуляции повторный submit disabled; success открывает ту же interview record в preparation.

### Сохранить черновик при конфликте или уходе

1. Input меняет локальный draft marker.
2. Workspace switcher при dirty form сначала открывает «Сменить пространство?» с «Остаться» / «Уйти без сохранения».
3. «Остаться» возвращает в form с теми же значениями и корректно закрывает mobile drawer.
4. Simulated HTTP 409 сохраняет title/candidate и показывает актуальную revision/invalid member or task.
5. Draft никогда не сохраняется в новую команду фоном.

### Подготовить созданную комнату

1. List row ведёт на `/interviews/int-204`, то есть ту же сущность.
2. Room OWNER видит metadata edit, candidate link и extra-task action; INTERVIEWER/HIRING — разрешённый read/room action без owner controls.
3. Programme pin и mandatory snapshots видны как зафиксированные; library edit не переписывает их.
4. Stale metadata save даёт 409 и сохраняет local title.

## Screen specs

| Surface | Layout | Key behavior |
|---|---|---|
| Tracks | hierarchy card: track head + nested vacancies | caller-only counts, archived filter, management by role, exact process link |
| Process detail | context card + programme summary + «Мои интервью» | no grant expansion; NONE/published explicit |
| Team library | stable tabs + compact filter bar + collection rows | tasks have language but no track; sets have version/order; role-specific actions |
| Task editor | version notice + title/language/condition/starter + draft marker | CAS conflict preserves input and offers compare/copy |
| Interview list | page action + search/track/vacancy/state filters + lifecycle rows | archived separate; schedule alone never says live; caller role on every row |
| Create interview | five numbered sections in document flow | no multi-step lock-in; programme mandatory and extras visually distinct; two explicit destinations |
| Preparation | header actions + context/people/programme cards | same room record; owner controls separated from interviewer/hiring actions |

## Interaction and permission rules

- MEMBER/author/ADMIN/team OWNER without room assignment do not receive interview rows.
- Only HIRING scenario exposes team «Кандидаты»; `isHr` is not changed.
- Team OWNER/ADMIN manage structure/library but do not inherit room/candidate access.
- Task author can overwrite authored material; MEMBER receives copy, not edit.
- Archive is history/read-only, not deletion. Frozen is not finished or archived.
- Programme mandatory rows have no remove/reorder action. Draft-only and archived configurations block creation.
- Every error state keeps valid local input; revoked clears protected content.

