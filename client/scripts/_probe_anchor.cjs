const path = require('node:path');
const fs = require('node:fs');
const m = require('../electron/services/imageSectionAnchor.cjs');

const p = process.argv[2] || path.join(
  process.env.APPDATA,
  'yibiao-client/workspace/knowledge-base/folders/folder-fa9f88a8-d3a6-4be9-85a2-36c465bc9488/documents/doc-1dd1fdf3-b2c7-4da0-94eb-268d5cfd8afc/content.md',
);
const md = fs.readFileSync(p, 'utf8');
const lines = md.split(/\r?\n/);
const recs = m.collectImageSectionAnchors(md);
const got = new Set(recs.map((r) => r.file_name));

const re = /yibiao-asset:\/\/imported-images\/[^/]+\/([^\s)]+)/g;
const all = new Set();
let mm;
while ((mm = re.exec(md)) !== null) all.add(decodeURIComponent(mm[1]));

const missed = [...all].filter((f) => !got.has(f));
console.log('markdown 引用图片总数:', all.size);
console.log('已采集锚点:', recs.length, '| 覆盖不同文件:', got.size);
console.log('未归属:', missed.length);
for (const f of missed) {
  const idx = lines.findIndex((l) => l.includes(f));
  console.log('  ', f, '| 行', idx, '| 上文:', JSON.stringify((lines[idx - 1] || '').slice(0, 60)));
}

console.log('');
console.log('=== 图片密集章节抽查 ===');
for (const target of ['3.3', '3.5', '3.2', '3.4', '11.']) {
  const group = recs.filter((r) => (r.section_level2 || '').includes(target) || (r.section_level1 || '').includes(target));
  console.log(`${target} → ${group.length} 张`);
}
