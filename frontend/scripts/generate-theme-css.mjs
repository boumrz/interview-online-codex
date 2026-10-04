import { writeFile } from "node:fs/promises";
import { renderThemeCss } from "../src/features/theme/themeTokens.ts";

await writeFile(new URL("../public/theme-tokens.css", import.meta.url), renderThemeCss());

