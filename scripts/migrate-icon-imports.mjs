/**
 * 把各组件里的 `from 'lucide-react'` barrel 导入改写为 `from './components/icons'`。
 *
 * 为什么要改：barrel 导入会迫使 Vite 依赖预优化器打包 lucide-react 的全部约
 * 1,800 个图标——实测本仓库为首屏付出 981 KB 预打包 + 981 KB 下载，而实际只用到
 * 33 个。改为从生成模块深路径导入后，关键路径降到约 15 KB。
 *
 * scripts/generate-icon-module.mjs 只负责「生成 icons.ts」，
 * 「改写调用方导入」需要这一步，两者配合才是完整迁移。
 *
 * 幂等：已经是 icons 导入的文件不会被改动。
 *
 * 运行：node scripts/migrate-icon-imports.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(repoRoot, 'src');

const checkOnly = process.argv.includes('--check');

/** 收集 src 下的所有 .ts/.tsx 文件（跳过生成模块自身）。 */
function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** 由文件位置算出 icons 模块的相对导入路径。 */
function iconsImportPath(file) {
  const iconsPath = path.join(srcRoot, 'components', 'icons');
  let rel = path.relative(path.dirname(file), iconsPath).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

const files = collectSourceFiles(srcRoot)
  .map((f) => path.relative(repoRoot, f))
  .filter((rel) => rel.replace(/\\/g, '/') !== 'src/components/icons.ts');

const changes = [];

for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  const before = fs.readFileSync(abs, 'utf8');

  // 只处理 `from 'lucide-react'` 或 `from "lucide-react"` 的具名导入
  const pattern = /import\s*\{([^}]+)\}\s*from\s*(['"])lucide-react\2;/g;
  if (!pattern.test(before)) continue;
  pattern.lastIndex = 0;

  const importPath = iconsImportPath(abs);
  const after = before.replace(pattern, (_m, names) => {
    return `import {${names}} from '${importPath}';`;
  });

  if (after !== before) {
    changes.push({ rel, importPath });
    if (!checkOnly) fs.writeFileSync(abs, after, 'utf8');
  }
}

if (checkOnly) {
  if (changes.length > 0) {
    console.error(`还有 ${changes.length} 个文件使用 barrel 导入：`);
    for (const c of changes) console.error(`  ${c.rel} -> ${c.importPath}`);
    process.exit(1);
  }
  console.log('所有图标导入都已指向生成模块');
} else {
  console.log(
    changes.length === 0
      ? '无需改动：所有文件已从生成模块导入图标'
      : `已改写 ${changes.length} 个文件的图标导入：\n${changes.map((c) => `  ${c.rel} -> ${c.importPath}`).join('\n')}`,
  );
}
