import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored OCR worker/core/wasm-glue JS, written by `pnpm vendor:ocr`
    // (which runs at prebuild) -- regenerated build output, not source.
    // Mirrors the reason already recorded in .gitignore for this directory.
    "public/tesseract/**",
    // Git worktrees live inside the repo at .claude/worktrees/<name>/, so a
    // worktree that has been built carries its own .next/ and public/tesseract/
    // that the globs above do not match -- they are anchored at the repo root.
    // Without this, `pnpm lint` from the main checkout walks another
    // worktree's build output and reports its errors as this tree's.
    ".claude/**",
  ]),
  // There is deliberately no per-path rule relaxation below this line. There
  // used to be one, narrowing six rules for src/components/attachment.tsx,
  // file.tsx, image.tsx, reasoning.tsx and thread.tsx on the grounds that they
  // were vendored assistant-ui output that an upgrade would overwrite. Those
  // five files were deleted with the chat UI and the block outlived them, so
  // it exempted nothing and only suggested that src/components/ contained code
  // this project does not own. It does not: src/components/operator/ is this
  // project's own screens and src/components/ui/ is seven primitives this
  // project maintains. Everything under src/ is linted by the same rules.
]);

export default eslintConfig;
