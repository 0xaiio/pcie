#!/usr/bin/env node
/**
 * Regenerates `src/components/icons.ts`.
 *
 * Why this exists
 * ---------------
 * `lucide-react` ships ~1,800 icons behind a single barrel module. Importing
 * `{ Download } from 'lucide-react'` makes Vite's dependency optimizer
 * pre-bundle the ENTIRE barrel, because the optimizer must materialise every
 * export of the entry it was asked to optimize and cannot know which handful
 * the app actually uses. Measured cost in this repo: 981 KB pre-bundled and
 * 981 KB transferred on the critical first-screen path, for 32 icons used.
 *
 * The fix is to import each icon from its own ESM module
 * (`lucide-react/dist/esm/icons/<kebab>.js`), which keeps the eager graph at
 * roughly 15 KB.
 *
 * Why it is generated
 * -------------------
 * The deep path for each icon must be derived from the package's own export
 * map, because numeric-suffixed names are aliases and do not follow kebab-case:
 *   Loader2 -> icons/loader-circle.js
 *   Wand2   -> icons/wand-sparkles.js
 *   Edit2   -> icons/pen.js
 * Hand-maintaining those mappings silently rots on every lucide upgrade.
 *
 * Usage: node scripts/generate-icon-module.mjs [--check]
 *   --check  verify the committed file matches what would be generated (CI)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'src');
const outFile = path.join(srcDir, 'components', 'icons.ts');

const checkOnly = process.argv.includes('--check');

/** Collect every source file that may import icons (tests included: they must
 *  switch to the generated module too, or CI's barrel-usage guard trips). */
function listSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(p, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

/** Build exportName -> './icons/foo.js' from the package's own barrel. */
function readLucideExportMap() {
  const pkgPath = path.join(repoRoot, 'node_modules', 'lucide-react', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const entry = path.join(repoRoot, 'node_modules', 'lucide-react', pkg.module ?? 'dist/esm/lucide-react.js');
  const barrel = fs.readFileSync(entry, 'utf8');

  const map = new Map();
  for (const m of barrel.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const [, names, specifier] = m;
    for (const part of names.split(',')) {
      const alias = /^\s*default\s+as\s+([A-Za-z0-9_$]+)\s*$/.exec(part);
      if (alias) map.set(alias[1], specifier);
    }
  }
  if (map.size === 0) {
    throw new Error(`Could not parse lucide-react export map from ${entry}`);
  }
  return { version: pkg.version, map };
}

/**
 * Find every icon name the app actually uses.
 *
 * Two sources feed the list:
 * 1. `from 'lucide-react'` — the barrel. Used when adding a brand-new icon, because
 *    there is no way to import a name the generated module does not export yet.
 * 2. `from './icons'` / `'../components/icons'` — how every other file imports icons
 *    once they exist. Without this branch the generator scans a codebase that
 *    exclusively imports the generated module, finds zero barrel imports, and
 *    rewrites the module down to an empty export list — wiping every icon in use.
 *
 * The generated-module pattern accepts both the relative sibling form (`./icons`,
 * used from inside `src/components/`) and the explicit path form
 * (`'../../components/icons'`, used from nested feature folders).
 */
function collectUsedIcons(map) {
  const used = new Map(); // exportedName -> [files]
  const barrelRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g;
  const generatedRe =
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:\.{1,2}\/)*(?:components\/)?icons['"]/g;

  for (const file of listSourceFiles(srcDir)) {
    const source = fs.readFileSync(file, 'utf8');
    // Skip the generated module itself: it re-exports every name, which would
    // make the used-set self-perpetuating and defeat the point of regeneration.
    if (path.resolve(file) === path.resolve(outFile)) continue;

    for (const re of [barrelRe, generatedRe]) {
      for (const m of source.matchAll(re)) {
        for (const raw of m[1].split(',')) {
          const spec = raw.trim();
          if (!spec) continue;
          const local = spec.split(/\s+as\s+/)[0].trim();
          if (!map.has(local)) {
            throw new Error(
              `Unknown lucide icon "${local}" in ${path.relative(repoRoot, file)}. `
              + 'Add it to the generator or check the installed lucide-react version.',
            );
          }
          const rel = path.relative(repoRoot, file);
          if (!used.has(local)) used.set(local, []);
          used.get(local).push(rel);
        }
      }
    }
  }
  return used;
}

function render({ version, map, used }) {
  const names = [...used.keys()].sort();
  const imports = names
    .map((name) => {
      const spec = map.get(name); // e.g. './icons/loader-circle.js'
      const file = spec.replace(/^\.\/icons\//, '').replace(/\.js$/, '');
      return `import ${name} from 'lucide-react/dist/esm/icons/${file}';`;
    })
    .join('\n');

  const exportsList = names.map((n) => `  ${n},`).join('\n');

  return `// AUTO-GENERATED by scripts/generate-icon-module.mjs — do not edit by hand.
//
// Why this file exists
// --------------------
// Importing from the 'lucide-react' barrel forces Vite's dependency optimizer to
// pre-bundle all ~1,800 icons, because the optimizer materialises every export of
// the entry module it is given and cannot know which ones this app uses. Measured
// in this repo: 981 KB pre-bundled + 981 KB fetched before first paint, for the
// ${names.length} icons actually used.
//
// Importing each icon from its own ESM module keeps the critical path at roughly
// 15 KB. Tree-shaking cannot fix this on its own: the dev dependency optimizer does
// not tree-shake the entry it pre-bundles, only the production Rollup build does.
//
// Source: lucide-react@${version}
//
// After adding a NEW icon, import it from this module — never from 'lucide-react'.
// The lint:icons guard (scripts/check-icon-imports.mjs) enforces that rule.

${imports}

export {
${exportsList}
};
`;
}

const { version, map } = readLucideExportMap();
const used = collectUsedIcons(map);
const next = render({ version, map, used });

if (checkOnly) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (current !== next) {
    console.error('src/components/icons.ts is out of date. Run: node scripts/generate-icon-module.mjs');
    process.exitCode = 1;
  } else {
    console.log(`src/components/icons.ts is up to date (${used.size} icons).`);
  }
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, next);
  console.log(`Wrote ${path.relative(repoRoot, outFile)} (${used.size} icons from lucide-react@${version}):`);
  for (const name of [...used.keys()].sort()) console.log(`  ${name.padEnd(14)} ${map.get(name)}`);
}
