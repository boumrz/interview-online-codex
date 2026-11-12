# Проверка доски системным виртуальным пером

Дата: 2026-11-12. Контракт: [P2.5 R-03, R-13–R-14 / AC-10](../features/p2-5-room-whiteboard.md).
Проверка выполнена на реальном приложении с синтетической комнатой и изолированной
БД. Пользовательские localhost:5173/8080 и `interview_online` для fixtures не использовались.

## Какие устройства учитывались

| Пример пользователя | Официальные характеристики | Что воспроизводилось |
| --- | --- | --- |
| XPPen Deco mini7 V2 | 16384 уровня давления, reading height 10 мм | Нормализованный 14-bit pressure profile; generic OS pen с 16384 уровнями |
| Parblo Intangbo S Stars | Производитель указывает семейство Intangbo M/S, размер S, цвет Star Black; 8192 уровня, sensing height 10 мм | Нормализованный 13-bit pressure profile браузера |

Источники: [XPPen](https://www.xp-pen.ru/product/deco-mini7-v2.html),
[Parblo](https://www.parblo.com/products/intangbo).
Отдельная прошивка модели с суффиксом «Stars» не подтверждалась. Указанные расстояния
и число аппаратных уровней — характеристики производителя, а не результаты
измерений физических планшетов в этой работе.

## Системный ввод

На macOS безопасная попытка создать pen HID через `IOHIDUserDeviceCreateWithProperties`
вернула NULL; контрольный keyboard descriptor также не создал устройство. Input reports
не отправлялись. Для этого интерфейса Apple требует
[virtual HID entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.hid.virtual.device).
Драйверы и системные расширения на хост не устанавливались.

Использована одноразовая Linux VM: QEMU 9.2.2, Alpine 3.24.4 aarch64,
2 CPU, 1536 MB RAM, приватный диск 2 GB; наружные порты ограничены loopback.
Официальный ISO проверен по SHA-256
`cf88d8ba67389d20d9ed307366b52e487c15d7d3ee3233b62b95f709daa1d430`.
Внутри VM работают libinput 1.31.3, Xorg и headed Chromium 156.0.8078.79.

Путь ввода:

`Linux uinput → evdev → udev Tablet → Xorg/libinput TABLET → Chromium → доска InterHub`.

Виртуальный digitizer называется **InterHub Generic Pressure Pen 14-bit**.
Он отправляет proximity, absolute coordinates, tip contact и pressure через
гостевую ОС. Это не эмуляция firmware XPPen/Parblo и не устройство производителя.
CDP используется для настройки страницы, UI действий и наблюдения; команды
рисования CDP не используются. Штрихи и стирание на холсте создаёт только uinput.

## Результат actual-app witness

**1/1 production witness PASS**, 61.8 секунды. Все **52** записанных события
на холсте имеют `isTrusted=true`, `pointerType=pen`; CDP drawing dispatches — **0**.
Проверены:

- Пунктирный pen-hover указатель и отсутствие POST до касания.
- Native штрих с низким/высоким давлением, `simulatePressure=false`, назначенный
  цвет и долговременная запись; его реальное цветное отображение у второго участника.
- Native ластик пером и Undo с восстановлением принятого штриха.
- Рисование пером при offline, reconnect и догрузка принятого результата.
- Reload и экспорт подтверждённой доски в `.excalidraw`, PNG и SVG.

Перьевой ввод и reload выполнены в гостевом Chromium. Экспорт подтверждённого
tablet stroke выполнен из приложения второго участника; его чтение и форматы
проверены. Гостевая файловая система скачиваний отдельно не проверялась.

Гостевые uinput frames разделены интервалом 80 ms, чтобы software-emulated CPU
успевал обрабатывать оба pressure участка. Это функциональная проверка, не
измерение максимальной частоты/latency планшета. После dev HMR, пересоздавшего
тестовую страницу, witness переведён на immutable production bundle; проверки
давления и Undo не ослаблялись.

Артефакты локального прогона:

- `.run/virtual-tablet-validation/native-app-result.json` — результат и native events.
- `.run/virtual-tablet-validation/native-pointer-result.json` — отдельная проверка OS input chain.
- `.run/virtual-tablet-validation/hid-create-result.json` — результат macOS probe.
- `.run/virtual-tablet-validation/native-xorg-proof.log` — фактический журнал
  обнаружения `/dev/input/event0`, udev Tablet и XINPUT TABLET/STYLUS.
- `.run/virtual-tablet-validation/native-app-hover.png`, `native-app-pressure.png`,
  `native-peer-pressure.png` — фактические изображения InterHub.
- `/tmp/interhub-native-uinput-witness-production.log` — полный итог witness.

Исполнимый witness:
[room-whiteboard-uinput-witness.mjs](../../frontend/tests/hardware/room-whiteboard-uinput-witness.mjs).
Сохранены [Linux uinput controller](../../frontend/tests/hardware/linux-uinput-pen.py)
и [macOS probe](../../frontend/tests/hardware/macos-hid-create-probe.c).
Ручной entry point в `tests/e2e/hardware/native-tablet-witness.mjs` использует
существующий isolated runner и не попадает в автоматический `e2e-*.mjs` discovery.
Два дополнительных capability-profile E2E — часть полного автоматического набора;
они отдельно подтверждают pen-only input, pressure, цвета двух авторов, eraser/Undo,
reconnect/reload и три формата экспорта.

## Границы результата

Проверена работа приложения от системного виртуального pen device и от browser
pen profiles. Физические XPPen/Parblo, их firmware, фирменные драйверы Windows/macOS,
калибровка, аппаратный palm rejection и все градации реального сенсора не проверены.
Виртуальная система — тестовый инструмент; новых платформ или сервисов в runtime
InterHub не добавлено.
После проверки собственные VM/туннели остановлены; приватный диск, ISO и ключи
удалены. Независимый scoped обзор исходников, native events и runtime
classification — approve. Неудачные диагностические попытки обозначены как
`historical-failed-attempt-*` и не используются как PASS evidence.
