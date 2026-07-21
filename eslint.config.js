import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "dev-instance/**",
      // Vendored third-party library — not our code to lint.
      "packages/plugin-video/assets/hls.js",
    ],
  },
  js.configs.recommended,
  {
    // Node.js is the default environment for the CLI, server, worker, and plugins.
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    // The browser-side island + the shipped video player run in the browser.
    files: [
      "packages/server/src/web/public/**/*.js",
      "packages/plugin-video/assets/**/*.js",
    ],
    languageOptions: { globals: { ...globals.browser } },
  },
];
