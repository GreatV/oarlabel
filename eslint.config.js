import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const browserGlobals = {
  console: "readonly",
  crypto: "readonly",
  document: "readonly",
  HTMLImageElement: "readonly",
  KeyboardEvent: "readonly",
  localStorage: "readonly",
  MouseEvent: "readonly",
  navigator: "readonly",
  PointerEvent: "readonly",
  process: "readonly",
  window: "readonly",
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "postcss.config.js",
      "src-tauri/**",
      "tailwind.config.js",
      "target/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "vite.config.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: browserGlobals,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-undef": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": "off",
    },
  },
];
