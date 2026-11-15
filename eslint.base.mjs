import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Shared ESLint baseline (without Next.js rules). Prettier must stay last. */
export const base = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      // Deliberately invalid sources used by architecture tests (e.g. require() on purpose).
      'tests/architecture/fixtures/**',
      'tests/architecture/type-surface/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
);

export { prettier };
