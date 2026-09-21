const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  getPastBidTemplateSourcesDir,
} = require('../utils/paths.cjs');

function now() {
  return new Date().toISOString();
}

function createTemplateId() {
  return `pbt-${crypto.randomUUID()}`;
}

function toNameList(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => String(item || '').trim()).filter(Boolean);
}

function templateFromRow(row) {
  if (!row) return null;
  let sourceFileNames = [];
  let skeleton = null;
  try {
    sourceFileNames = JSON.parse(row.source_file_names_json || '[]');
  } catch {
    sourceFileNames = [];
  }
  try {
    skeleton = JSON.parse(row.skeleton_json || 'null');
  } catch {
    skeleton = null;
  }
  return {
    template_id: row.template_id,
    template_name: row.template_name,
    source_file_names: sourceFileNames,
    skeleton,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// 把内容模板骨架序列化为可读 Markdown，供生成目录/正文时作为参考喂给 AI。
function serializeSkeletonToMarkdown(skeleton) {
  if (!skeleton || !Array.isArray(skeleton.chapters)) return '';
  const lines = [];
  const walk = (chapters, depth) => {
    for (const chapter of chapters) {
      lines.push(`${'#'.repeat(Math.min(6, depth + 1))} ${chapter.title}`);
      if (chapter.note) lines.push(`> ${chapter.note}`);
      for (const point of chapter.points || []) {
        if (!point) continue;
        lines.push(`- ${point}`);
      }
      if (chapter.placeholder) lines.push(`**待填：** ${chapter.placeholder}`);
      if (Array.isArray(chapter.children) && chapter.children.length) {
        lines.push('');
        walk(chapter.children, depth + 1);
      }
      lines.push('');
    }
  };
  walk(skeleton.chapters, 0);
  return lines.join('\n').trim();
}

function createPastBidTemplateStore({ app, db }) {
  function listTemplates() {
    return db.prepare(`
      SELECT template_id, template_name, source_file_names_json, skeleton_json, created_at, updated_at
      FROM past_bid_template
      ORDER BY updated_at DESC, created_at DESC
    `).all().map(templateFromRow);
  }

  function getTemplate(templateId) {
    const row = db.prepare(`
      SELECT template_id, template_name, source_file_names_json, skeleton_json, created_at, updated_at
      FROM past_bid_template
      WHERE template_id = ?
    `).get(templateId);
    return templateFromRow(row);
  }

  function createTemplate(input = {}) {
    const timestamp = now();
    const templateId = createTemplateId();
    const templateName = String(input.template_name || '').trim() || '未命名标书模板';
    const sourceFileNames = toNameList(input.source_file_names);
    const skeleton = input.skeleton ?? null;
    const sourceMarkdowns = input.source_markdowns || {};

    const sourcesDir = getPastBidTemplateSourcesDir(app, templateId);
    fs.mkdirSync(sourcesDir, { recursive: true });

    for (const fileName of sourceFileNames) {
      const content = sourceMarkdowns[fileName];
      if (typeof content !== 'string' || !content) continue;
      const safeName = path.basename(fileName);
      fs.writeFileSync(path.join(sourcesDir, safeName), content, 'utf8');
    }

    db.prepare(`
      INSERT INTO past_bid_template (
        template_id, template_name, source_file_names_json, skeleton_json, created_at, updated_at
      ) VALUES (
        @template_id, @template_name, @source_file_names_json, @skeleton_json, @created_at, @updated_at
      )
    `).run({
      template_id: templateId,
      template_name: templateName,
      source_file_names_json: JSON.stringify(sourceFileNames),
      skeleton_json: skeleton === null ? JSON.stringify(null) : JSON.stringify(skeleton),
      created_at: timestamp,
      updated_at: timestamp,
    });

    return {
      template_id: templateId,
      template_name: templateName,
      source_file_names: sourceFileNames,
      skeleton,
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

  function updateTemplate(templateId, input = {}) {
    const existing = getTemplate(templateId);
    if (!existing) {
      throw new Error('模板不存在或已被删除');
    }
    const templateName = String(input.template_name || '').trim() || existing.template_name;
    const skeleton = input.skeleton === undefined ? existing.skeleton : input.skeleton;
    const updatedAt = now();

    const row = db.prepare(`
      UPDATE past_bid_template
      SET template_name = @template_name,
          skeleton_json = @skeleton_json,
          updated_at = @updated_at
      WHERE template_id = @template_id
      RETURNING template_id, template_name, source_file_names_json, skeleton_json, created_at, updated_at
    `).get({
      template_id: templateId,
      template_name: templateName,
      skeleton_json: skeleton === null ? JSON.stringify(null) : JSON.stringify(skeleton),
      updated_at: updatedAt,
    });

    return templateFromRow(row);
  }

  function deleteTemplate(templateId) {
    const result = db.prepare('DELETE FROM past_bid_template WHERE template_id = ?').run(templateId);
    const removed = result.changes > 0;
    if (removed) {
      const dir = require('../utils/paths.cjs').getPastBidTemplateDir(app, templateId);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return {
      success: removed,
      message: removed ? '模板已删除' : '模板不存在或已被删除',
    };
  }

  function readSourceMarkdown(templateId, fileName) {
    const safeName = path.basename(String(fileName || ''));
    if (!safeName) return null;
    const filePath = path.join(getPastBidTemplateSourcesDir(app, templateId), safeName);
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  return {
    listTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    readSourceMarkdown,
  };
}

module.exports = {
  createPastBidTemplateStore,
  serializeSkeletonToMarkdown,
};
