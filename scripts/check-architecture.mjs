#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArchitecture } from './architecture/check.mjs';
import { checkModuleSurfaces } from './architecture/surfaces.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes('--help')) {
  console.log('Usage: check-architecture [--root <dir>] [--matrix <file>] [--json]');
  process.exit(0);
}

try {
  const root = path.resolve(option('--root') ?? path.join(here, '..'));
  const matrixPath = path.resolve(
    option('--matrix') ?? path.join(here, 'architecture', 'dependency-matrix.json'),
  );
  const { violations, notes, stats } = checkArchitecture({ root, matrixPath });
  // Type-level leaks (return types, parameters, generated declarations) that import rules cannot see.
  const surfaces = checkModuleSurfaces({ root });
  violations.push(...surfaces.violations);
  stats.surfacesChecked = surfaces.checked;

  if (args.includes('--json')) {
    console.log(JSON.stringify({ violations, notes, stats }, null, 2));
  } else {
    for (const v of violations) {
      console.error(`ERROR ${v.rule}  ${v.file}:${v.line}`);
      console.error(`      ${v.message}`);
      if (v.hint) console.error(`      hint: ${v.hint}`);
    }
    for (const n of notes) console.error(`NOTE  ${n.file}:${n.line}  ${n.message}`);
    const summary = `${stats.packages} packages, ${stats.files} files scanned, ${stats.surfacesChecked} public type surfaces`;
    if (violations.length === 0)
      console.log(`PASS: architecture boundaries hold (${summary}; ${notes.length} notes)`);
    else console.error(`FAIL: ${violations.length} architecture violation(s) (${summary})`);
  }
  process.exit(violations.length === 0 ? 0 : 1);
} catch (error) {
  console.error(`check-architecture failed to run: ${error.message}`);
  process.exit(2);
}
