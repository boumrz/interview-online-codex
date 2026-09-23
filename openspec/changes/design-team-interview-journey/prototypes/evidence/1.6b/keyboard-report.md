# 1.6b — form keyboard/focus report

Результат: **PASS в headless Chromium**.

- 18 последовательных Tab targets в compact task-conflict form имеют непустые accessible names и видимый `outline-width: 3px`.
- Input/textarea/select связаны с labels; state controls и mobile navigation имеют explicit names.
- Dirty interview form открывает native modal warning; «Остаться» закрывает warning/mobile drawer и возвращает к неизменённому title.
- Task 409 возвращает compare actions после полей; local text остаётся доступен keyboard-only.
- Track change выдаёт live message и не переносит vacancy автоматически.
- Disabled mandatory/programme controls не попадают в misleading action sequence; mandatory tasks не имеют remove action.
- На 390×360 кнопка «Создать и открыть комнату» после обычной вертикальной прокрутки имеет rect `x=100.81, y=157.03, w=252.19, h=46` и полностью находится в visual viewport.
- В representative state и geometry matrix не обнаружено visible hit targets меньше 44×44.
- При simulated landscape insets `47px/47px` controls personal shell и открытого mobile drawer не заходят за safe-area edges; общий horizontal overflow остаётся нулевым (`report.json.safeArea`).

Ограничение: уменьшенная высота headless viewport моделирует занятое клавиатурой место, но не проверяет физическую mobile keyboard/safe-area/orientation. Этот manual gate остаётся у UX Critic в 1.6g.
