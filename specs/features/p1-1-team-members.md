### P1.1 Каталог участников

Цель: раздел «Участники» работает как реальный каталог команды.

Готово:

- backend `GET /api/teams/{teamId}/members` возвращает только активных
  участников команды с safe-полями `userId`, `displayName`, `role`, `state`,
  `revision`;
- effective owner отображается как `OWNER`, остальные роли — `ADMIN`/`MEMBER`;
- неактивные membership state не попадают в список и totals;
- список поддерживает paging, поиск по безопасному display name и приватный
  `Cache-Control: private, no-store`;
- невалидные page/size/query возвращают безопасную ошибку без partial roster;
- чужая команда/неактивный участник скрываются без раскрытия состава;
- UI раздела «Участники» больше не показывает «Раздел готовится»;
- UI показывает loading/error/retry/empty/search/pagination/current user states;
- MEMBER видит безопасный roster без invitation management controls;
- после принятия приглашения новый участник появляется у owner/admin и сам
  может открыть раздел «Участники».
- проверки:
  - backend `TeamMemberDirectoryIntegrationTest` — зелёный `8/8`;
  - frontend isolated `run-team-invitations.mjs` — зелёный:
    `e2e-team-membership.mjs` `8/8`,
    `e2e-team-invitation-management.mjs` `13 passed`, `1 native-AX skip`;
  - AC-06 roster сценарий подтверждает, что `GET /api/teams/{teamId}/members`
    не даёт `404` для вступившего участника в тестовом runtime.

Что сделать:

- P1.1 MVP готов; дальнейшее управление уходом/удалением/rejoin переносится в
  P3.1 lifecycle.

Acceptance:

- новый участник появляется у владельца/админа;
- новый участник сам видит раздел «Участники»;
- MEMBER не видит управляющие действия;
- OWNER не может удалить последнего владельца без передачи владения.

## Корректировка по продуктовой проверке 2026-09-23

- Навигация по страницам состава использует компактные цифровые страницы с явным текущим номером, границами и клавиатурной доступностью; длинных кнопок «Предыдущая/Следующая страница участников» нет.
