import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: { version: "detect" },
    },
  },
  // Rules of Hooks + the React Compiler diagnostic rule set
  // (purity, immutability, refs, set-state-in-render, manual-memoization, ...).
  // This is our React Compiler compatibility gate. The plugin's shipped config
  // still uses the legacy `plugins: []` shape, so we register it ourselves and
  // pull in its recommended rule map.
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: reactHooks.configs["recommended-latest"].rules,
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      // we have a lot of any to be compatible with Solid api, where they're also used
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      quotes: ["error", "double"],
      semi: ["error", "always", { omitLastInOneLineBlock: true }],
    },
  },
  {
    // useResource deliberately captures a stable closure and uses a conditional
    // (skipFnMemoization) dependency list that the React Compiler cannot analyze
    // statically. These two rules are off here; the remaining compiler rules
    // still apply to verify the hook is otherwise compiler-safe.
    files: ["src/hooks/useResource.ts"],
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/use-memo": "off",
    },
  },
);
