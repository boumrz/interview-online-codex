(() => {
  let mode = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  try {
    const saved = window.localStorage.getItem("interview-online:ui-theme");
    if (saved === "dark" || saved === "light") mode = saved;
  } catch {
    // Storage can be blocked; the operating system remains the default.
  }

  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
})();
