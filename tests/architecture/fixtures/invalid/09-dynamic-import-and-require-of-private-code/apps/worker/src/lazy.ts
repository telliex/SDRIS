export async function load() {
  const viaImport = await import('@sdris/evidence/src/domain/model');
  const viaRequire = require('@sdris/investigation/src/domain/model');
  return [viaImport, viaRequire];
}
