const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function exitWithCode(code) {
  if (app?.isReady?.()) {
    app.exit(code);
    return;
  }
  process.exit(code);
}

function runSmoke() {
  try {
    console.log(`[native-smoke] electron=${process.versions.electron || 'unknown'} node=${process.versions.node} modules=${process.versions.modules} platform=${process.platform} arch=${process.arch}`);
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
      const row = db.prepare('SELECT 1 AS ok').get();
      if (!row || row.ok !== 1) {
        throw new Error(`Unexpected SQLite result: ${JSON.stringify(row)}`);
      }
    } finally {
      db.close();
    }
    console.log('[native-smoke] better-sqlite3 loaded and queried successfully.');
    runQuotationAuditMigrationSmoke(Database);
    exitWithCode(0);
  } catch (error) {
    console.error('[native-smoke] Electron native dependency smoke test failed.');
    console.error(error?.stack || error?.message || String(error));
    exitWithCode(1);
  }
}

function runQuotationAuditMigrationSmoke(Database) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-v33-migration-smoke-'));
  let workspace;
  try {
    const databasePath = path.join(tempRoot, 'workspace', 'yibiao.sqlite');
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const legacy = new Database(databasePath);
    try {
      const schemaPath = path.resolve(__dirname, '../../sql/workspace_schema.sql');
      legacy.exec(fs.readFileSync(schemaPath, 'utf8'));
      legacy.exec('DROP TABLE IF EXISTS technical_plan_quotation_audits; PRAGMA user_version = 32;');
    } finally {
      legacy.close();
    }

    const { createSqliteDatabase } = require('../electron/services/sqliteDatabase.cjs');
    workspace = createSqliteDatabase({ getPath: () => tempRoot, once: () => {} });
    const version = workspace.db.pragma('user_version', { simple: true });
    const auditTable = Boolean(workspace.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'technical_plan_quotation_audits'").get());
    const migration = workspace.db.prepare('SELECT status FROM schema_migrations WHERE version = 33').get()?.status;
    const foreignKeyViolations = workspace.db.pragma('foreign_key_check').length;
    if (version !== 33 || !auditTable || migration !== 'success' || foreignKeyViolations) {
      throw new Error(`v32→v33 migration check failed: ${JSON.stringify({ version, auditTable, migration, foreignKeyViolations })}`);
    }
    console.log('[migration-smoke] v32→v33 passed; audit table exists; foreign keys clean.');
    runQuotationAuditStoreSmoke(workspace.db, tempRoot);
  } finally {
    workspace?.close();
    const safeTemp = path.resolve(tempRoot);
    if (!safeTemp.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Refusing to remove a path outside the temporary directory.');
    fs.rmSync(safeTemp, { recursive: true, force: true });
  }
}

function runQuotationAuditStoreSmoke(db, tempRoot) {
  const { createTechnicalPlanStore } = require('../electron/services/technicalPlanStore.cjs');
  const app = { getPath: () => tempRoot };
  const store = createTechnicalPlanStore({ app, db, fileService: {}, agentService: {}, taskLogStore: {} });
  const originalContent = '报价函字段审查 smoke 内容';
  const staleContent = '报价函字段审查 smoke 内容（已变更）';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO technical_plan_outline_nodes
    (node_id, parent_node_id, sort_order, level, title, description, content_mode, content_mode_note,
     source_requirement_id, source_requirement_title, technical_topic_ids_json, knowledge_item_ids_json,
     content, created_at, updated_at)
    VALUES (?, NULL, 0, 1, ?, '', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`)
    .run('quotation-audit-smoke-node', '报价函审查 smoke', originalContent, now, now);

  const first = store.loadQuotationAudit('quotation-audit-smoke-node');
  const batchId = 'quotation-audit-smoke-batch';
  const decision = {
    id: 'bidder', status: '待核对', human_decision: '核对通过', audit_batch_id: batchId,
    field_fingerprint: 'smoke-fingerprint', official_sha256: 'official-sha',
    software_sha256: first.content_hash, tender_sha256: 'tender-sha',
  };
  const saved = store.saveQuotationAudit({ nodeId: first.node_id, contentHash: first.content_hash, decisions: [decision] });
  if (!saved.saved) throw new Error('Quotation audit store rejected a current body hash.');

  const reloadedStore = createTechnicalPlanStore({ app, db, fileService: {}, agentService: {}, taskLogStore: {} });
  const reloaded = reloadedStore.loadQuotationAudit(first.node_id);
  if (reloaded.decisions.length !== 1 || reloaded.decisions[0].human_decision !== '核对通过' || reloaded.saved_content_hash !== first.content_hash) {
    throw new Error(`Quotation audit persistence roundtrip failed: ${JSON.stringify(reloaded)}`);
  }

  db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?')
    .run(staleContent, new Date().toISOString(), first.node_id);
  const staleWrite = store.saveQuotationAudit({ nodeId: first.node_id, contentHash: first.content_hash, decisions: [{ ...decision, human_decision: '过期写入' }] });
  const afterStaleWrite = store.loadQuotationAudit(first.node_id);
  if (staleWrite.saved || staleWrite.current_hash !== afterStaleWrite.content_hash || afterStaleWrite.decisions[0]?.human_decision !== '核对通过') {
    throw new Error(`Stale quotation audit write was not safely rejected: ${JSON.stringify({ staleWrite, afterStaleWrite })}`);
  }
  console.log('[quotation-audit-smoke] Store save/reload passed; stale body hash rejected without overwriting the saved decision.');
}

if (app?.whenReady) {
  app.whenReady().then(runSmoke, (error) => {
    console.error('[native-smoke] Electron app failed to become ready.');
    console.error(error?.stack || error?.message || String(error));
    exitWithCode(1);
  });
} else {
  runSmoke();
}
