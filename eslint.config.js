/**
 * Lint configuration for the whole monorepo.
 *
 * One flat config at the root rather than one per package. Ten near-identical configs drift
 * apart, and the rules that matter here are project-wide invariants rather than per-package
 * preferences.
 *
 * The three custom rule blocks below are the ones worth having. Everything else is
 * `typescript-eslint`'s recommended set, which catches the ordinary mistakes.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.bin",
      "**/coverage/**",
      "apps/web/public/**",
      "packages/*/scripts/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Unused values are usually a half-finished edit. Underscore-prefixed names are the
      // documented way to say "deliberately ignored".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // `any` erases the unit brands, which are the main compile-time guarantee this project
      // has. Warn rather than error so it stays visible without blocking on third-party gaps.
      "@typescript-eslint/no-explicit-any": "warn",

      // Empty catch blocks hide the errors Phase 10 exists to surface.
      "no-empty": ["error", { allowEmptyCatch: false }],

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  /**
   * The science packages must never import a renderer.
   *
   * This is the package boundary rule from the PRD, and it is the one architectural
   * invariant a reviewer cannot check by eye once the repo is large enough. Three.js in
   * `packages/physics` would compile, pass every test, and quietly destroy the separation
   * that makes the science layers reusable and testable without a GPU.
   */
  {
    files: [
      "packages/units/**/*.ts",
      "packages/physics/**/*.ts",
      "packages/schema/**/*.ts",
      "packages/missions/**/*.ts",
      "packages/terrain/**/*.ts",
      "packages/coordinates/**/*.ts",
      "packages/catalog/**/*.ts",
      "packages/exoplanets/**/*.ts",
      "packages/stars/**/*.ts",
      "packages/deepsky/**/*.ts",
      "packages/solar-system/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "three",
              message:
                "Science packages must not depend on rendering. Keep Three.js in apps/web; " +
                "pass plain data across the boundary.",
            },
          ],
          patterns: [
            {
              group: ["three/*", "@aether/web", "@aether/web/*"],
              message: "Science packages must not depend on rendering code.",
            },
          ],
        },
      ],
    },
  },

  /**
   * Test files legitimately do things production code should not: assert on `any`, build
   * deliberately malformed objects to prove validation rejects them, and use non-null
   * assertions on fixtures that are known-good by construction.
   */
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Must stay last: turns off everything that would fight the formatter.
  prettier,
);
