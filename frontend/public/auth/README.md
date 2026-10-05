# Provider button assets

- `google-g.png`: current Google identity logo, downloaded from
  https://developers.google.com/static/identity/images/g-logo.png on 2026-10-05;
  use follows https://developers.google.com/identity/branding-guidelines.
- `google-sans.woff2`: Google Sans Medium 500, v71, official Google Fonts API
  subset for the exact label `Войти через Google`. Font software license is
  included in `OFL.txt`; original project https://github.com/googlefonts/googlesans.
  When translating/changing the label, regenerate a matching official subset.
  API: https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&display=swap&text=Google%20%D0%92%D0%BE%D0%B9%D1%82%D0%B8%20%D1%87%D0%B5%D1%80%D0%B5%D0%B7
- `vk-id.svg`: official VKCOM/vkid-web-sdk OneTap mark, commit
  `8ff76cfe59ea72e370c4c6c3b40712ecfd43aadd`, `src/widgets/oneTap/template.ts`.
  Original MIT license is embedded in the SVG. Branding rules:
  https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/guidelines/design-rules.

All assets load from the application's origin; provider fonts/images are not
requested while showing the login page.
