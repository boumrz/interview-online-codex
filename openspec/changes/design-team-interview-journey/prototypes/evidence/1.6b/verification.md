# 1.6b — automated geometry/state verification

Источник: [`report.json`](report.json). Команда:

```sh
node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6b/automated-check.mjs
```

Результат: **PASS**.

- 44/44 viewport × zoom measurements: 11 согласованных viewport и 100/125/150/200% stress zoom.
- Маршруты UX-04–07 ротируются по matrix; длинный русский текст включён.
- Global horizontal overflow: 0 failures.
- Visible interactive targets меньше 44×44: 0 failures.
- Representative screenshots: 20, без дублирования полной geometry matrix.
- Runtime/page errors: 0.
- Permission assertions: 7/7 ролей имеют явный label; MEMBER/author/ADMIN/team OWNER без room grant не получают interview rows; settings только ADMIN/team OWNER; candidates только HIRING.
- Library: MEMBER copy/no edit/no track filter; author edit.
- Task draft: title + condition сохранены после 409, перехода и возврата.
- Interview draft: title сохранён после unsaved guard и 409; track change сбросил vacancy адресно.
- Resolver: published — 2 locked mandatory/no remove; NONE — free choice; draft-only — submit disabled.
- Compact 390×360: последняя primary action полностью достижима, horizontal overflow 0.
- Simulated landscape safe-area 47 px слева/справа: personal shell в закрытом состоянии и все шесть controls открытого drawer находятся между безопасными границами; horizontal overflow 0. Проверка использует CSS variables как headless proxy для `env(safe-area-inset-*)`.
- Keyboard trace: 18/18 шагов имеют accessible name и 3 px visible focus outline.

Screenshots: [`screenshots/`](screenshots/). Проверка остаётся prototype geometry evidence и не заменяет AC-04–AC-07, AC-16/17 или backend authorization tests.
