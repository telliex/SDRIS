import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');
export const fixturesDir = path.join(here, 'fixtures');
const cli = path.join(repoRoot, 'scripts', 'check-architecture.mjs');

export const MODULES = [
  'investigation',
  'evidence',
  'diagnostics',
  'workflow',
  'verification',
  'knowledge',
  'platform',
  'governance',
  'integration',
];
export const SHARED = ['shared-kernel', 'contracts', 'testing', 'config'];
export const APPS = ['web', 'api', 'worker'];

function write(root, rel, content) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * Builds a minimal, fully compliant synthetic workspace: nine modules with a src/public entrypoint
 * and an internal domain file, four shared packages and three apps. Scenario fixtures are overlaid.
 */
export function buildSkeleton(root) {
  for (const name of MODULES) {
    write(
      root,
      `modules/${name}/package.json`,
      JSON.stringify({
        name: `@sdris/${name}`,
        main: 'src/public/index.ts',
        types: 'src/public/index.ts',
      }),
    );
    write(root, `modules/${name}/src/public/index.ts`, 'export type Marker = string;\n');
    write(root, `modules/${name}/src/domain/model.ts`, 'export const model = 1;\n');
  }
  for (const name of SHARED) {
    write(
      root,
      `packages/${name}/package.json`,
      JSON.stringify({ name: `@sdris/${name}`, main: 'src/index.ts', types: 'src/index.ts' }),
    );
    write(root, `packages/${name}/src/index.ts`, 'export type Marker = string;\n');
  }
  for (const name of APPS) {
    write(root, `apps/${name}/package.json`, JSON.stringify({ name: `@sdris/${name}` }));
    write(root, `apps/${name}/src/index.ts`, 'export {};\n');
  }
}

/** Copies a scenario's files (everything except expect.json and matrix.json) over the skeleton. */
export function buildScenario(scenarioDir) {
  const root = mkdtempSync(path.join(tmpdir(), 'sdris-arch-'));
  buildSkeleton(root);
  cpSync(scenarioDir, root, {
    recursive: true,
    filter: (src) => !['expect.json', 'matrix.json'].includes(path.basename(src)),
  });
  const matrixFile = path.join(scenarioDir, 'matrix.json');
  const matrixPath = path.join(root, '.matrix.json');
  try {
    writeFileSync(matrixPath, readFileSync(matrixFile));
  } catch {
    writeFileSync(matrixPath, JSON.stringify({ moduleDependencies: {} }));
  }
  return { root, matrixPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export const scenarios = (kind) =>
  readdirSync(path.join(fixturesDir, kind), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, dir: path.join(fixturesDir, kind, e.name) }));

export const readExpect = (dir) => JSON.parse(readFileSync(path.join(dir, 'expect.json'), 'utf8'));

export function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
