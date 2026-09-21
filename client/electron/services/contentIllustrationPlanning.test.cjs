const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIllustrationPlanningContext, resolveIllustrationPlan } = require('./contentIllustrationPlanning.cjs');

function createContext() {
  return buildIllustrationPlanningContext({
    outlineData: {
      outline: [
        { id: '1.1', title: '设备部署', content_mode: 'ai-generate' },
        { id: '1.2', title: '运维保障', content_mode: 'ai-generate' },
      ],
    },
    sections: {
      '1.1': { status: 'success', content: '设备安装部署方案' },
      '1.2': { status: 'success', content: '运维保障方案' },
    },
    options: { useHtmlImages: true, htmlImageTypes: '系统架构图', maxHtmlImages: 2 },
    libraryImages: [{
      imageId: 'img-1',
      fileName: 'img-1.png',
      name: '核心设备现场部署图',
      description: '机柜中的核心设备与布线',
      tags: '设备，机房',
      metadataStatus: 'ready',
      asset_url: 'yibiao-asset://image-library/_assets/img-1.png',
    }],
  });
}

test('同节冲突时知识库素材优先于 HTML', () => {
  const context = createContext();
  const result = resolveIllustrationPlan({ items: [
    { kind: 'html', image_type: '系统架构图', title: '系统架构图', section_ids: ['1.1'], placement: 'after', priority: 5 },
    { kind: 'asset', image_type: 'library_image', title: '设备现场部署图', section_ids: ['1.1'], placement: 'after', priority: 1, asset_id: 'img-1', asset_url: 'yibiao-asset://image-library/_assets/img-1.png' },
  ] }, context);

  assert.deepEqual(result.plan.items.map((item) => item.kind), ['asset']);
});

test('拒绝 AI 编造或错配的素材地址', () => {
  const context = createContext();
  assert.throws(() => resolveIllustrationPlan({ items: [{
    kind: 'asset', image_type: 'library_image', title: '伪造素材', section_ids: ['1.1'], placement: 'after', priority: 5,
    asset_id: 'img-1', asset_url: 'yibiao-asset://image-library/_assets/fake.png',
  }] }, context), /ID 与 URL 不匹配/);
});

test('同一库内素材整份方案最多使用一次', () => {
  const context = createContext();
  const result = resolveIllustrationPlan({ items: [
    { kind: 'asset', image_type: 'library_image', title: '设备现场部署图', section_ids: ['1.1'], placement: 'after', priority: 5, asset_id: 'img-1', asset_url: 'yibiao-asset://image-library/_assets/img-1.png' },
    { kind: 'asset', image_type: 'library_image', title: '运维设备实景图', section_ids: ['1.2'], placement: 'after', priority: 4, asset_id: 'img-1', asset_url: 'yibiao-asset://image-library/_assets/img-1.png' },
  ] }, context);
  assert.equal(result.plan.items.length, 1);
});
