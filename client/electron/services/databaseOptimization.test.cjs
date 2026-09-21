const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
const { createKnowledgeBaseStore } = require('./knowledgeBaseStore.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
const { createFeasibilityReportStore } = require('./feasibilityReportStore.cjs');

function createTestApp(userDataDir) {
  return {
    getPath: () => userDataDir,
    once: () => {},
  };
}

function createTaskLogStub() {
  return {
    list: () => [],
    sync: () => {},
  };
}

test('知识修订、引用快照和图片外键保持一致', (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-database-optimization-'));
  t.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));
  const app = createTestApp(userDataDir);
  const workspace = createSqliteDatabase(app);
  t.after(() => workspace.close());
  const { db } = workspace;

  const knowledgeBaseStore = createKnowledgeBaseStore({ app, db });
  const folder = knowledgeBaseStore.createFolder('测试资料');
  const document = knowledgeBaseStore.createDocument({
    id: 'doc-1',
    folder_id: folder.id,
    file_name: '参考文档.docx',
    status: 'ready',
  });

  knowledgeBaseStore.updateMarkdownMetadata(document.id, '版本 A', 'test');
  assert.equal(knowledgeBaseStore.getDocument(document.id).revision, 1);
  knowledgeBaseStore.updateMarkdownMetadata(document.id, '版本 B', 'test');
  assert.equal(knowledgeBaseStore.getDocument(document.id).revision, 2);

  const agentService = { deletePersistentTask: () => {} };
  const taskLogStore = createTaskLogStub();
  const technicalPlanStore = createTechnicalPlanStore({ app, db, agentService, taskLogStore });
  technicalPlanStore.updateTechnicalPlanWithoutReload({
    bidPlan: { schema_version: 1, project_type: { primary: 'equipment_procurement', secondary: [] }, technical_topics: [{ id: 'T001', title: '起升机构' }] },
    responseTables: { technical_parameter_response: { type: 'technical_parameter_response', rows: [{ response: { status: 'UNKNOWN', value: '待确认' } }] } },
    parameterRegistry: { schema_version: 1, unknown_placeholder: '待确认', parameters: [] },
    qualityCheck: { technical_coverage: { coverage_score: 100 } },
    outlineData: { outline: [{ id: '6.1', title: '起升机构', description: '', content_mode: 'ai-generate', technical_topic_ids: ['T001'] }] },
  });
  const planningState = technicalPlanStore.loadTechnicalPlan();
  assert.equal(planningState.bidPlan.project_type.primary, 'equipment_procurement');
  assert.equal(planningState.responseTables.technical_parameter_response.rows[0].response.value, '待确认');
  assert.deepEqual(planningState.outlineData.outline[0].technical_topic_ids, ['T001']);
  assert.equal(planningState.qualityCheck.technical_coverage.coverage_score, 100);
  technicalPlanStore.updateTechnicalPlanWithoutReload({ referenceKnowledgeDocumentIds: [document.id, 'missing-doc'] });
  assert.deepEqual(
    db.prepare('SELECT document_id, document_revision FROM technical_plan_reference_docs').all(),
    [{ document_id: document.id, document_revision: 2 }],
  );

  knowledgeBaseStore.updateMarkdownMetadata(document.id, '版本 C', 'test');
  const feasibilityReportStore = createFeasibilityReportStore({ app, db, agentService, taskLogStore });
  feasibilityReportStore.updateFeasibilityReportWithoutReload({ referenceDocumentIds: [document.id, 'missing-doc'] });
  assert.deepEqual(
    db.prepare('SELECT document_id, document_revision FROM feasibility_report_reference_docs').all(),
    [{ document_id: document.id, document_revision: 3 }],
  );

  knowledgeBaseStore.updateMarkdownMetadata(document.id, '版本 D', 'test');
  const staleReferences = db.prepare(`
    SELECT 'technical' AS source, r.document_revision, d.revision
    FROM technical_plan_reference_docs r
    JOIN knowledge_documents d ON d.document_id = r.document_id
    WHERE r.document_revision <> d.revision
    UNION ALL
    SELECT 'feasibility' AS source, r.document_revision, d.revision
    FROM feasibility_report_reference_docs r
    JOIN knowledge_documents d ON d.document_id = r.document_id
    WHERE r.document_revision <> d.revision
    ORDER BY source DESC
  `).all();
  assert.deepEqual(staleReferences, [
    { source: 'technical', document_revision: 2, revision: 4 },
    { source: 'feasibility', document_revision: 3, revision: 4 },
  ]);

  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO image_library_folders (folder_id, name, sort_order, created_at, updated_at)
    VALUES ('folder-1', '默认', 0, ?, ?)
  `).run(timestamp, timestamp);
  db.prepare(`
    INSERT INTO image_library_images (
      image_id, folder_id, file_name, asset_url, byte_size, name, created_at, updated_at
    ) VALUES ('image-1', 'folder-1', 'image-1.png', 'yibiao-asset://image-library/_assets/image-1.png', 1, '测试图片', ?, ?)
  `).run(timestamp, timestamp);
  technicalPlanStore.updateTechnicalPlanWithoutReload({
    contentIllustrationPlan: {
      plan_version: 1,
      revision: 'rev-1',
      items: [{
        item_id: 'illustration-1',
        kind: 'asset',
        image_type: 'photo',
        title: '测试图片',
        section_ids: ['section-1'],
        placement: 'after',
        priority: 1,
        asset_id: 'image-1',
      }],
    },
  });
  assert.equal(
    db.prepare('SELECT asset_id FROM technical_plan_illustration_items WHERE item_id = ?').pluck().get('illustration-1'),
    'image-1',
  );
  assert.throws(
    () => db.prepare('DELETE FROM image_library_images WHERE image_id = ?').run('image-1'),
    /FOREIGN KEY constraint failed/,
  );
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
