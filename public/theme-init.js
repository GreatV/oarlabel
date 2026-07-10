(function () {
  try {
    var rawTheme = globalThis.localStorage.getItem("oarlabel.theme");
    var theme = rawTheme ? JSON.parse(rawTheme) : "system";
    var dark =
      theme === "dark" ||
      (theme === "system" && globalThis.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) globalThis.document.documentElement.classList.add("dark");

    var rawLocale = globalThis.localStorage.getItem("oarlabel.locale");
    var locale = rawLocale ? JSON.parse(rawLocale) : "zh-CN";
    globalThis.document.documentElement.lang = locale === "en-US" ? "en-US" : "zh-CN";
  } catch {
    globalThis.document.documentElement.lang = "zh-CN";
  }
})();
