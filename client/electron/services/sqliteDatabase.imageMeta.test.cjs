const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createSqliteDatabase, schemaVersion } = require('./sqliteDatabase.cjs');

test('v28 工作区升级到 v31，补齐图片语义、Bid Planning 和迁移审计', (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-schema-v30-'));
  t.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));
  const databasePath = path.join(userDataDir, 'workspace', 'yibiao.sqlite');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE image_library_folders (folder_id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE image_library_images (
      image_id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, file_name TEXT NOT NULL, asset_url TEXT NOT NULL,
      mime TEXT, ext TEXT, byte_size INTEGER NOT NULL DEFAULT 0, width INTEGER, height INTEGER,
      source_document_id TEXT, content_hash TEXT, name TEXT, description TEXT, tags TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO image_library_folders VALUES ('fl-1', '默认', 0, '2026-01-01', '2026-01-01');
    INSERT INTO image_library_images VALUES ('img-1', 'fl-1', 'img-1.png', 'yibiao-asset://image-library/fl-1/img-1.png', 'image/png', 'png', 1, 1, 1, NULL, 'hash', 'IMG_001', '现场设备图', '设备', '2026-01-01', '2026-01-01');
    PRAGMA user_version = 28;
  `);
  legacy.close();

  const listeners = [];
  const workspace = createSqliteDatabase({
    getPath: () => userDataDir,
    once: (_event, listener) => listeners.push(listener),
  });
  t.after(() => workspace.close());

  assert.equal(workspace.schemaVersion, 31);
  assert.equal(workspace.db.pragma('user_version', { simple: true }), schemaVersion);
  const row = workspace.db.prepare('SELECT original_name, metadata_status, metadata_error FROM image_library_images WHERE image_id = ?').get('img-1');
  assert.deepEqual(row, { original_name: 'IMG_001', metadata_status: 'ready', metadata_error: null });
  const migration = workspace.db.prepare('SELECT version, status FROM schema_migrations WHERE version = 30').get();
  assert.deepEqual(migration, { version: 30, status: 'success' });
  const planningMigration = workspace.db.prepare('SELECT version, status FROM schema_migrations WHERE version = 31').get();
  assert.deepEqual(planningMigration, { version: 31, status: 'success' });
  assert.ok(workspace.db.prepare("SELECT 1 FROM pragma_table_info('knowledge_documents') WHERE name = 'revision'").get());
  assert.ok(workspace.db.prepare("SELECT 1 FROM pragma_table_info('knowledge_items') WHERE name = 'content_hash'").get());
  assert.ok(workspace.db.prepare("SELECT 1 FROM pragma_table_info('technical_plan_illustration_items') WHERE name = 'asset_id'").get());
  assert.ok(workspace.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feasibility_report_reference_docs'").get());
  assert.ok(workspace.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'technical_plan_bid_plan'").get());
  assert.ok(workspace.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'technical_plan_response_tables'").get());
  assert.ok(workspace.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'technical_plan_parameter_registry'").get());
  assert.ok(workspace.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'technical_plan_quality_check'").get());
  assert.ok(workspace.db.prepare("SELECT 1 FROM pragma_table_info('technical_plan_outline_nodes') WHERE name = 'technical_topic_ids_json'").get());
  assert.equal(workspace.db.pragma('foreign_key_check').length, 0);
  const backupFiles = fs.readdirSync(path.dirname(databasePath)).filter((fileName) => fileName.startsWith('yibiao.sqlite.backup-'));
  assert.equal(backupFiles.length, 1);
});
