import { spawnSync } from 'node:child_process';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (message) => { throw new Error(`ASGREP_RELEASE_REGISTRY_INSTALL: ${message}`); };
const index = process.argv.indexOf('--install-root');
if (index < 0 || !process.argv[index + 1]) fail('missing --install-root');
const installRoot = path.resolve(process.argv[index + 1]);
const modules = path.join(installRoot, 'node_modules');
const source = path.resolve(import.meta.dirname, '../../..');
const [matrix, launcherManifest, extensionManifest] = await Promise.all([
  readFile(path.join(source, 'packages/pi/release/targets.json'), 'utf8').then(JSON.parse),
  readFile(path.join(source, 'packages/pi/launcher/package.json'), 'utf8').then(JSON.parse),
  readFile(path.join(source, 'packages/pi/extension/package.json'), 'utf8').then(JSON.parse)
]);
const target = matrix.targets.find((entry) => entry.os === process.platform && entry.cpu === process.arch &&
  (!entry.libc || (entry.libc === 'glibc' && Boolean(process.report?.getReport().header.glibcVersionRuntime))));
if (!target) fail(`no native target for ${process.platform}/${process.arch}`);
for (const [name, version] of [[target.package, launcherManifest.version], [launcherManifest.name, launcherManifest.version], [extensionManifest.name, extensionManifest.version]]) {
  const directory = path.join(modules, name);
  if (!(await lstat(directory)).isDirectory() || (await realpath(directory)) !== directory) fail(`${name} is not an installed directory`);
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== name || manifest.version !== version) fail(`${name} installed version differs from release source`);
}
const nativeRoot = path.join(modules, target.package);
const nativeManifest = JSON.parse(await readFile(path.join(nativeRoot, 'package.json'), 'utf8'));
if (JSON.stringify(nativeManifest.os) !== JSON.stringify([target.os]) ||
    JSON.stringify(nativeManifest.cpu) !== JSON.stringify([target.cpu]) ||
    JSON.stringify(nativeManifest.libc ?? []) !== JSON.stringify(target.libc ? [target.libc] : [])) fail('installed native selectors differ from target');
const { resolveBinary } = await import(pathToFileURL(path.join(modules, launcherManifest.name, 'src/index.js')).href);
const binary = await realpath(resolveBinary());
if (!binary.startsWith(nativeRoot + path.sep) || !(await stat(binary)).isFile()) fail('launcher did not select the installed host-native binary');
const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15_000, env: process.env });
if (result.status !== 0 || result.stdout.trim() !== `asgrep ${launcherManifest.version}`) fail('installed native executable failed --version');
await import(pathToFileURL(path.join(modules, extensionManifest.name, 'dist/index.js')).href);
console.log(`[pi-release] registry install: ${launcherManifest.name}@${launcherManifest.version}, ${target.package}@${nativeManifest.version}, ${extensionManifest.name}@${extensionManifest.version}; native --version and extension import passed`);
