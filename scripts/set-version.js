import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run version:set -- <major.minor.patch>');
  process.exit(1);
}

const repoRoot = process.cwd();

function filePath(relativePath) {
  return resolve(repoRoot, relativePath);
}

function replaceOnce(relativePath, pattern, replacement) {
  const path = filePath(relativePath);
  const content = readFileSync(path, 'utf8');
  const next = content.replace(pattern, replacement);

  if (next === content) {
    throw new Error(`Could not update version in ${relativePath}`);
  }

  writeFileSync(path, next);
}

function setManifestVersion(relativePath) {
  const path = filePath(relativePath);
  const content = readFileSync(path, 'utf8');
  const manifest = JSON.parse(content);

  if (typeof manifest.version !== 'string') {
    throw new Error(`Missing version in ${relativePath}`);
  }

  replaceOnce(relativePath, /"version"\s*:\s*"[^"]+"/, `"version": "${version}"`);
}

function setPackageLockVersion() {
  const relativePath = 'package-lock.json';
  const path = filePath(relativePath);
  const content = readFileSync(path, 'utf8');
  const lockfile = JSON.parse(content);

  if (typeof lockfile.version !== 'string' || typeof lockfile.packages?.['']?.version !== 'string') {
    throw new Error(`Missing root package version in ${relativePath}`);
  }

  let replacements = 0;
  const next = content.replace(/"version"\s*:\s*"[^"]+"/g, (match) => {
    if (replacements >= 2) {
      return match;
    }

    replacements += 1;
    return `"version": "${version}"`;
  });

  if (replacements !== 2) {
    throw new Error(`Could not update root package versions in ${relativePath}`);
  }

  writeFileSync(path, next);
}

try {
  for (const relativePath of [
    'package.json',
    'plugin.json',
    'plugins/godot-plugin/.codex-plugin/plugin.json',
    'plugins/godot-plugin/.claude-plugin/plugin.json',
  ]) {
    setManifestVersion(relativePath);
  }

  setPackageLockVersion();

  for (const relativePath of [
    'mcp.json',
    'plugins/godot-plugin/.mcp.json',
  ]) {
    replaceOnce(
      relativePath,
      /@cwchanap\/godot-plugin@[^"\]]+/,
      `@cwchanap/godot-plugin@${version}`,
    );
  }

  replaceOnce(
    'src/godot-server.ts',
    /(export const GODOT_SERVER_INFO = \{\r?\n  name: 'godot-mcp',\r?\n  version: ')[^']+(')/,
    `$1${version}$2`,
  );

  console.log(`Set release version to ${version}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
