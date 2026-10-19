#!/usr/bin/env node
/**
 * Guard for the generated icon module. Two failure modes, both of which break
 * `npm run dev` at runtime rather than at author time:
 *
 *   1. an import from the 'lucide-react' barrel, which re-adds ~981 KB to the
 *      critical path;
 *   2. a consumer importing a name that src/components/icons.ts does not export.
 *      Vite's dependency scanner fails with
 *      `No matching export in "src/components/icons.ts" for import "Send"`,
 *      which aborts the scan and leaves the first screen hanging for ~10s.
 *      Nothing in the editor necessarily flags it, so it is checked here.
 *
 * Exits non-zero when either is found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'src');
const iconsFile = path.join(srcDir, 'components', 'icons.ts');

function listSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(p, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

const violations = [];
const barrelRe = /from\s+['"]lucide-react['"]/;
const generatedRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:\.{1,2}\/)*(?:components\/)?icons['"]/g;

if (!fs.existsSync(iconsFile)) {
  console.error('src/components/icons.ts is missing. Run: node scripts/generate-icon-module.mjs');
  process.exitCode = 1;
}

const exported = new Set();
if (fs.existsSync(iconsFile)) {
  const iconsSrc = fs.readFileSync(iconsFile, 'utf8');
  const block = iconsSrc.split('export {')[1];
  if (!block) {
    violations.push('src/components/icons.ts has no `export { ... }` block');
  } else {
    for (const name of block.split('};')[0].split(',').map((s) => s.trim()).filter(Boolean)) {
      exported.add(name);
    }
  }
}

for (const file of listSourceFiles(srcDir)) {
  const rel = path.relative(srcDir, file);
  const source = fs.readFileSync(file, 'utf8');

  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    // Ignore comment lines: the generated icons.ts documents the rule itself,
    // and this guard must not flag its own documentation.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (barrelRe.test(line)) {
      violations.push(`${rel}:${index + 1}: ${trimmed}`);
    }
  });

  if (path.resolve(file) === path.resolve(iconsFile)) continue;
  for (const m of source.matchAll(generatedRe)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name && !exported.has(name)) {
        violations.push(`${rel}: imports "${name}", which src/components/icons.ts does not export`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Icon module check failed:\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    '\nFix by regenerating the module after adding the icon import, or by adding a\n'
    + "barrel import once and re-running the generator:\n"
    + '  node scripts/generate-icon-module.mjs',
  );
  process.exitCode = 1;
} else {
  console.log(`OK: icon imports valid (${exported.size} icons, no barrel imports).`);
}
