import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../', import.meta.url).pathname;
const modules = [
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
const packages = ['shared-kernel', 'contracts', 'testing', 'config'];
const apps = ['web', 'api', 'worker'];
const infrastructure = ['database'];
for (const [folder, names] of [
  ['modules', modules],
  ['packages', packages],
  ['apps', apps],
  ['infrastructure', infrastructure],
]) {
  for (const name of names) {
    const path = join(root, folder, name, 'package.json');
    if (!existsSync(path)) throw new Error(`Missing workspace: ${path}`);
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    if (pkg.name !== `@sdris/${name}`) throw new Error(`Unexpected package name: ${pkg.name}`);
  }
}
for (const m of modules) {
  if (!existsSync(join(root, 'modules', m, 'src', 'public', 'index.ts')))
    throw new Error(`Missing public boundary: ${m}`);
}
for (const file of [
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  '.env.example',
  'docs/adr/ADR-024-sprint-0-execution.md',
]) {
  if (!existsSync(join(root, file))) throw new Error(`Missing foundation file: ${file}`);
}
console.log(
  `PASS: ${apps.length} apps, ${modules.length} modules, ${packages.length} shared packages, ${infrastructure.length} infrastructure package, public boundaries and baseline files`,
);
