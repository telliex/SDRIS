import nextPlugin from '@next/eslint-plugin-next';

/** Next.js recommended + core-web-vitals rules for the given file globs. */
export function nextConfig(files) {
  return {
    files,
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // App Router only; there is no pages/ directory to check.
      '@next/next/no-html-link-for-pages': 'off',
    },
  };
}
