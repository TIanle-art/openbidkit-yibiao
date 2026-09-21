const path = require('node:path');
const fs = require('node:fs');
const anchor = require('../electron/services/imageSectionAnchor.cjs');
const backfill = require('../electron/services/sourceEvidenceBackfill.cjs');

const mdPath = process.argv[2] || path.join(
  process.env.APPDATA,
  'yibiao-client/workspace/knowledge-base/folders/folder-fa9f88a8-d3a6-4be9-85a2-36c465bc9488/documents/doc-1dd1fdf3-b2c7-4da0-94eb-268d5cfd8afc/content.md',
);
const md = fs.readFileSync(mdPath, 'utf8');
const anchors = anchor.collectImageSectionAnchors(md);
console.log('① 锚点采集:', anchors.length, '张');

// 构造一份「新标书」目录：章节名与源标书一致，但编号/空格形态故意不同，
// 用来验证归一化匹配是否真的生效。
const outline = [
  { id: '1', title: '1. 响应函', children: [] },
  {
    id: '3', title: '3. 资格审查资料', children: [
      { id: '3.1', title: '3.1申请人基本情况表', children: [] },
      { id: '3.2', title: '3 . 2 生产能力证明', children: [] },
      { id: '3.3', title: '3.3 近两年财务状况表', children: [] },
      { id: '3.4', title: '3.4质量保证能力证明', children: [] },
      { id: '3.5', title: '3.5 近五年同类物资供货业绩表', children: [] },
      { id: '3.6', title: '3.6 履约信用证明', children: [] },
    ],
  },
  { id: '11', title: '11.生产企业简介', children: [] },
  { id: '12', title: '12. 技术偏离表', children: [] },
];

const sections = {};
for (const leaf of backfill.collectLeafNodes(outline)) {
  sections[leaf.id] = { status: 'success', content: `【${leaf.title}】的正文内容。` };
}

// 把锚点转成图片记录（模拟 image_library_images 里的行）
const images = anchors.map((a, i) => ({
  image_id: `lib-${i}`,
  name: a.context_text ? a.context_text.slice(0, 20) : '',
  asset_url: `yibiao-asset://image-library/lib-${i}.png`,
  source_section_path_json: JSON.stringify(a.section_path),
  source_position_index: a.position_index,
  source_context_text: a.context_text,
}));

console.log('② 图片记录:', images.length, '张');

const result = backfill.buildSourceEvidenceBackfill({ outlineData: { outline }, sections, images });
console.log('③ 回填结果:');
console.log('   插入图片:', result.stats.inserted);
console.log('   命中章节:', result.stats.touched_sections);
console.log('   无法匹配:', result.stats.skipped_unmatched);
console.log('   分布:');
result.stats.per_section.forEach((s) => console.log(`     ${String(s.count).padStart(3)} 张 → ${s.sectionId} ${s.title}`));

console.log('');
console.log('④ 校验 3.3 小节的正文与图片块:');
const s33 = result.sections['3.3'];
console.log('   正文开头:', JSON.stringify(s33.content.split('\n')[0]));
console.log('   图片块数:', (s33.content.match(/yibiao-illustration:start/g) || []).length);
console.log('   首块片段:');
console.log(s33.content.split('\n').filter((l) => l.includes('yibiao-illustration') || l.startsWith('![图')).slice(0, 4).map((l) => '     ' + l.slice(0, 130)).join('\n'));

console.log('');
console.log('⑤ 幂等性校验（重复回填不应累加）:');
const again = backfill.buildSourceEvidenceBackfill({
  outlineData: result.outlineData,
  sections: result.sections,
  images,
});
console.log('   二次插入:', again.stats.inserted, '| 3.3 图片块数:', (again.sections['3.3'].content.match(/yibiao-illustration:start/g) || []).length, '（应与首次相同）');
