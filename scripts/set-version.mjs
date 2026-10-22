#!/usr/bin/env node
// Usage: node scripts/set-version.mjs <new-version>
// Updates version in: package.json, src-tauri/Cargo.toml
// tauri.conf.json reads version from package.json automatically.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+/.test(newVersion)) {
  console.error('Usage: node scripts/set-version.mjs <semver>  (e.g. 0.1.0)');
  process.exit(1);
}

// --- package.json ---
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✔ package.json        → ${newVersion}`);

// --- package-lock.json (root package entry only) ---
const lockPath = join(root, 'package-lock.json');
try {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = newVersion;
  if (lock.packages?.['']) lock.packages[''].version = newVersion;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`✔ package-lock.json  → ${newVersion}`);
} catch {
  console.warn('⚠ package-lock.json not found or invalid, skipping.');
}

// --- src-tauri/Cargo.toml ---
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
let cargo = readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(/^version\s*=\s*"[\d.]+"/m, `version = "${newVersion}"`);
writeFileSync(cargoPath, cargo);
console.log(`✔ src-tauri/Cargo.toml → ${newVersion}`);

console.log(`\nDone! All files now on v${newVersion}.`);
