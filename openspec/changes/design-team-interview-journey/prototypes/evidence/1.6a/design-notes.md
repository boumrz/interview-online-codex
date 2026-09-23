# 1.6a — UX flows и screen specs

Дата проверки: 9 сентября 2026. Статус: готово для независимого UX Critic review; не production UI и не authorization evidence.

## User flows

### Создать первую команду

1. Personal user открывает `#/personal/interviews`; рабочие личные разделы уже доступны.
2. Открывает текстовый переключатель «Личное пространство».
3. В списке нет выдуманной команды; есть объяснение «в существующую вступают по приглашению» и кнопка «Создать команду».
4. В диалоге вводит название. Пустое/пробельное значение показывает локальную ошибку и возвращает фокус в поле.
5. После явного submit локальная симуляция открывает `/teams/nova/interviews`, показывает роль «Владелец команды» и empty onboarding «Пригласить коллег» / «Создать трек».

### Переключить пространство

1. MEMBER / ADMIN / OWNER открывает switcher из любой рабочей страницы.
2. Выбирает personal, Atlas или Orbit; одинаковые названия различаются коротким ID и подписью роли.
3. Если одноимённый раздел доступен, прототип открывает его; для 1.6a базовый fallback — «Интервью».
4. Role chip и workspace name меняются вместе с URL; старые строки другого пространства не остаются на экране.

### Принять приглашение без входа

1. Anonymous открывает `#/join/team?...invite=preview`.
2. Видит только team name, роль MEMBER и срок. Состав, кандидаты, комнаты и creator identity отсутствуют.
3. Нажимает «Войти и продолжить», проходит демонстрационный вход и возвращается к тому же preview.
4. После входа membership всё ещё не объявлено; доступны «Сменить аккаунт» и отдельная кнопка «Вступить как участник».
5. Только после явного принятия появляется confirmed success и вход в пустой team workspace.

### Неактуальное приглашение

1. Через строку сценариев выбирается expired или revoked.
2. Экран показывает одну privacy-safe формулировку и путь в свои пространства.
3. Network error выглядит иначе: статус ссылки неизвестен, доступен «Повторить».
4. Already-member показывает идемпотентный результат и не создаёт вторую строку участия.

### Открыть профиль и вернуться

1. Профиль всегда находится в account block внизу постоянной навигации.
2. Самостоятельный `/profile` содержит имя, personal `isHr`, stable personal ID и logout; team membership здесь не редактируется.
3. Сохранение с ошибкой сохраняет введённые значения.
4. Кнопка возврата ведёт в тот же personal/team context; права должны быть повторно проверены production-приложением.

### Открыть старую ссылку

1. Prototype-only карта `#/prototype/routes` перечисляет восемь старых входов.
2. «Проверить вход» открывает новый эквивалент и показывает source notice.
3. `/dashboard/rooms` открывает форму, но не вызывает submit; ни один mapping не добавляет `created=1`.

## Screen specs

| Surface | Layout | Primary elements | Responsive rule |
|---|---|---|---|
| Workspace shell | 276 px navy rail + paper content canvas; page heading имеет устойчивую верхнюю позицию | explicit workspace switcher, permission-filtered nav, account/profile block, textual primary action | до 700 px rail становится drawer, но остаётся явная кнопка «Открыть рабочую навигацию»; не avatar-only |
| Workspace switcher | modal list, current item marked | personal, доступные teams с ID/role, create team | одна колонка, scrollable dialog, Escape и restore focus |
| Empty team | onboarding band + отдельное empty-state | invite colleague, create track, create interview | действия складываются вертикально и не перекрывают список |
| Profile | account form + personal ID aside | name, isHr explanation, stable ID, save, logout, return | одна колонка; primary action остаётся в document flow |
| Invite | editorial privacy panel + focused acceptance card | team/role/expiry, current account, switch account, explicit accept | одна колонка на mobile; facts становятся stacked; public data остаются теми же |
| Old-route map | one row per old/new path pair | exact source, exact destination, «Проверить вход» | row становится одной колонкой, action занимает доступную ширину |

## Component behavior

- Scenario toolbar меняет только hash query и локальный render; она постоянно помечена «ПРОТОТИП».
- Workspace switcher использует native `<dialog>`, переносит фокус внутрь и возвращает его trigger при закрытии.
- Mobile drawer открывается отдельной named button, переводит фокус на workspace switcher и закрывается Escape/scrim.
- State selector не маскирует error под empty: loading использует `aria-busy`, error имеет retry, revoked удаляет защищённые cards.
- Invite state strip существует только как prototype control; production не должен показывать пользователю переключатель состояния token.
- Profile `isHr` copy явно отделяет personal setting от team assignments.
- Все важные кнопки текстовые; одиночный «+» не используется как единственный вход.

## Interaction rules

1. Route navigation не отправляет форму и не создаёт сущность.
2. Team name не используется как identity; switcher показывает short ID.
3. Team role управляет видимостью settings, но не создаёт candidate/room access. MEMBER-сценарий с «Кандидатами» помечен отдельным hiring assignment; ADMIN/OWNER без него раздел не видят.
4. Invite never claims membership before the confirmed success state.
5. Revoked team screen убирает защищённое содержимое и оставляет путь в personal; он не изображается пустой редактируемой командой.
6. Длинные имена переносятся, а global document не получает horizontal scroll.

