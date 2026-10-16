const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createImageLibraryService } = require('./imageLibraryService.cjs');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE image_library_folders (folder_id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE image_library_images (
      image_id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, file_name TEXT NOT NULL, asset_url TEXT NOT NULL,
      mime TEXT, ext TEXT, byte_size INTEGER NOT NULL DEFAULT 0, width INTEGER, height INTEGER,
      source_document_id TEXT, content_hash TEXT, name TEXT, original_name TEXT, description TEXT, tags TEXT,
      metadata_status TEXT NOT NULL DEFAULT 'pending', metadata_error TEXT, metadata_updated_at TEXT,
      source_section_path_json TEXT, source_position_index INTEGER NOT NULL DEFAULT 0, source_context_text TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE knowledge_documents (document_id TEXT PRIMARY KEY, file_name TEXT);
    CREATE TABLE knowledge_document_images (image_id TEXT PRIMARY KEY, document_id TEXT, batch_id TEXT, file_name TEXT, mime TEXT, ext TEXT, byte_size INTEGER, asset_url TEXT, created_at TEXT);
    CREATE TABLE technical_plan_outline_nodes (content TEXT);
    CREATE TABLE technical_plan_content_plans (plan_json TEXT);
    CREATE TABLE technical_plan_meta (content_generation_runtime_json TEXT);
    CREATE TABLE technical_plan_illustration_items (generation_asset_url TEXT);
  `);
  return db;
}

test('上传图片自动生成语义名称、描述和标签，移动分类不改变引用', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-image-library-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const sourcePath = path.join(tempDir, 'IMG_001.png');
  fs.writeFileSync(sourcePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZxZsAAAAASUVORK5CYII=', 'base64'));
  const db = createDatabase();
  t.after(() => db.close());
  const service = createImageLibraryService({
    app: { getPath: () => tempDir },
    db,
    aiService: {
      describeImage: async (_filePath, context) => {
        assert.equal(context.originalName, 'IMG_001');
        return { name: '核心设备机柜图', description: '机柜内安装有核心网络设备和布线', tags: '机柜，设备，布线' };
      },
    },
  });
  const sourceFolder = service.createFolder('原分类');
  const targetFolder = service.createFolder('新分类');

  const [image] = await service.uploadImages([sourcePath], sourceFolder.folderId);
  assert.equal(image.name, '核心设备机柜图');
  assert.equal(image.metadataStatus, 'ready');
  assert.match(image.asset_url, /^yibiao-asset:\/\/image-library\/_assets\/img-/);
  const originalAssetUrl = image.asset_url;

  const moved = service.moveImage(image.imageId, targetFolder.folderId);
  assert.equal(moved.folderId, targetFolder.folderId);
  assert.equal(moved.asset_url, originalAssetUrl);
});

test('已被技术方案引用的图片不允许删除', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-image-reference-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const sourcePath = path.join(tempDir, 'device.png');
  fs.writeFileSync(sourcePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZxZsAAAAASUVORK5CYII=', 'base64'));
  const db = createDatabase();
  t.after(() => db.close());
  const service = createImageLibraryService({
    app: { getPath: () => tempDir }, db,
    aiService: { describeImage: async () => ({ name: '设备图', description: '设备现场图', tags: '设备' }) },
  });
  const folder = service.createFolder('默认');
  const [image] = await service.uploadImages([sourcePath], folder.folderId);
  db.prepare('INSERT INTO technical_plan_outline_nodes (content) VALUES (?)').run(`![设备](${image.asset_url})`);

  assert.throws(() => service.deleteImage(image.imageId), /正在技术方案中使用/);
  assert.equal(service.listImages(folder.folderId).length, 1);
});
