# 1.6a — keyboard и focus report

Результат автоматизированной проверки: **PASS**.

## Проверено

- Первый Tab открывает skip link «К основному содержимому».
- Scenario selects имеют явные accessible names; checkbox длинного текста связан с видимой label.
- На 320×640 keyboard traversal достигает кнопки `Открыть рабочую навигацию`.
- Enter открывает drawer, `aria-expanded` меняется, focus переносится на workspace switcher.
- Focus indicator у элемента внутри drawer: outline 3 px плюс внешний cyan ring.
- Escape закрывает drawer; native dialogs закрываются Escape и возвращают focus trigger.
- Пустое название команды показывает связанную live-region ошибку и возвращает focus в `#teamName`.
- Кнопки и links имеют текстовые accessible names; видимые targets по полной geometry matrix не меньше 44×44 px.
- Anonymous invite → login → return заканчивается на preview с отдельной кнопкой `Вступить как участник`, а не automatic membership.

Машинные поля: `report.json.keyboard`, `report.json.createValidation`, `report.json.returnedToInvite`, `report.json.matrix[*].undersized`.

## Ограничение / следующий gate

Viewport-height reduction до 390×360 подтверждает достижимость поля и submit в headless Chromium, но не является реальной экранной клавиатурой. Проверка keyboard-open/closed, safe area, portrait/landscape и focus на поддерживаемом физическом mobile browser/device остаётся открытой до task 1.6g и принадлежит UX Critic.
