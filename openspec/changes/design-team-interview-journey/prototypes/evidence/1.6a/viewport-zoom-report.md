# 1.6a — viewport, zoom и geometry report

Источник машинных измерений: [`report.json`](report.json). Команда: `node openspec/changes/design-team-interview-journey/prototypes/evidence/1.6a/automated-check.mjs` при `PROTOTYPE_URL=http://localhost:4173/`.

Результат: **PASS для prototype geometry**.

- 44/44 комбинаций viewport × zoom прошли.
- Viewports: 1440×900, 1366×768, 1280×720, 1024×600, 1024×480, 768×1024, 1024×768, 320×640, 360×640, 390×640, 667×375.
- Zoom: 100%, 125%, 150%, 200%.
- В каждой итерации включены длинные русские account/team/interview names.
- Максимальный document horizontal overflow: 0 px.
- Видимых interactive targets меньше 44×44 px: 0.
- Runtime/page errors: 0.
- Сохранено 44 полных shell screenshots и 17 representative state screenshots в [`screenshots/`](screenshots/).

Headless-проверка использует CSS zoom для stress-rendering и bounding-rectangle assertions. Она доказывает reflow/geometry прототипа в этой среде, но не подменяет browser zoom production E2E из AC-01 и manual real-device gate 1.6g.

Отдельная visual viewport симуляция уменьшает высоту до 390×360: длинное последнее поле создания команды получает focus, primary action после прокрутки имеет rect `x=174.78, y=305.66, w=171.22, h=46` и полностью достижимо. CSS содержит `safe-area-inset-bottom`; фактический inset физического устройства здесь не эмулируется.

