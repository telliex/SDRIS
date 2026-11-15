import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { resolveFile } from '../../scripts/architecture/resolve.mjs';

/**
 * File-extension resolution must match TypeScript exactly, so this derives the expected order from
 * `ts.resolveModuleName` itself: with every candidate present, resolve, record the winner, delete
 * it, and repeat. The checker's resolveFile must produce the same sequence for the same specifier.
 */
const ALL = [
  '.ts',
  '.tsx',
  '.d.ts',
  '.mts',
  '.d.mts',
  '.cts',
  '.d.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];
const OPTIONS = {
  moduleResolution: ts.ModuleResolutionKind.Node10,
  allowJs: true,
  preserveSymlinks: true,
};

function sequence(dir, specifierExt, resolver) {
  const present = new Set(ALL);
  const order = [];
  for (;;) {
    for (const ext of ALL) rmSync(path.join(dir, `m${ext}`), { force: true });
    for (const ext of present) writeFileSync(path.join(dir, `m${ext}`), 'export {};\n');
    const resolved = resolver(path.join(dir, `m${specifierExt}`));
    if (!resolved) return order;
    const ext = resolved.slice(path.join(dir, 'm').length);
    order.push(ext);
    present.delete(ext);
  }
}

for (const specifierExt of ['', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']) {
  test(`extension order for specifier "m${specifierExt}" matches TypeScript`, () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'sdris-ext-')));
    try {
      const viaTsc = sequence(
        dir,
        specifierExt,
        (spec) =>
          ts.resolveModuleName(spec, path.join(dir, 'importer.ts'), OPTIONS, ts.sys).resolvedModule
            ?.resolvedFileName,
      );
      const viaChecker = sequence(dir, specifierExt, resolveFile);
      assert.ok(viaTsc.length > 0, 'TypeScript resolved nothing');
      assert.deepEqual(viaChecker, viaTsc);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
