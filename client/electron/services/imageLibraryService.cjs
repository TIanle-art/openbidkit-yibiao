const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { imageSize } = require('image-size');
const { getImageLibraryDir, getImportedImagesDir } = require('../utils/paths.cjs');

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
};

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

function mimeFromExt(ext) {
  return MIME_BY_EXT[String(ext || '').toLowerCase()] || 'image/*';
}

function extFromMime(mime) {
  return EXT_BY_MIME[String(mime || '').toLowerCase()] || '';
}

function safeFolderId(folderId) {
  return String(folderId || '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'default';
}

/** 计算文件内容 SHA-256，用于去重。 */
function fileHash(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function createImageLibraryService({ app, db, aiService }) {
  const baseDir = getImageLibraryDir(app);
  const assetDir = path.join(baseDir, '_assets');
  let aiServiceRef = aiService || null;

  function setAiService(instance) {
    aiServiceRef = instance || null;
  }

  function ensureBaseDir() {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(assetDir, { recursive: true });
  }

  function folderDir(folderId) {
    return path.join(baseDir, safeFolderId(folderId));
  }

  function mapFolder(row) {
    return { folderId: row.folder_id, name: row.name, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  function mapImage(row) {
    return {
      imageId: row.image_id,
      folderId: row.folder_id,
      fileName: row.file_name,
      name: row.name || null,
      asset_url: row.asset_url,
      mime: row.mime,
      ext: row.ext,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      sourceDocumentId: row.source_document_id,
      sourceSectionPathJson: row.source_section_path_json || null,
      sourcePositionIndex: Number.isFinite(row.source_position_index) ? row.source_position_index : 0,
      sourceContextText: row.source_context_text || null,
      contentHash: row.content_hash || null,
      description: row.description || null,
      tags: row.tags || null,
      originalName: row.original_name || null,
      metadataStatus: row.metadata_status || ((row.description || row.tags) ? 'ready' : 'pending'),
      metadataError: row.metadata_error || null,
      metadataUpdatedAt: row.metadata_updated_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ── 文件夹 ──────────────────────────────────────
  function listFolders() {
    return db.prepare('SELECT * FROM image_library_folders ORDER BY sort_order ASC, created_at ASC').all().map(mapFolder);
  }

  function createFolder(name) {
    ensureBaseDir();
    const id = createId('fl');
    const orderRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM image_library_folders').get();
    const sortOrder = Number(orderRow?.value ?? -1) + 1;
    const timestamp = now();
    db.prepare('INSERT INTO image_library_folders (folder_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, String(name || '').trim() || '未命名', sortOrder, timestamp, timestamp);
    fs.mkdirSync(folderDir(id), { recursive: true });
    return mapFolder(db.prepare('SELECT * FROM image_library_folders WHERE folder_id = ?').get(id));
  }

  function renameFolder(folderId, name) {
    const timestamp = now();
    db.prepare('UPDATE image_library_folders SET name = ?, updated_at = ? WHERE folder_id = ?')
      .run(String(name || '').trim() || '未命名', timestamp, String(folderId || ''));
    return mapFolder(db.prepare('SELECT * FROM image_library_folders WHERE folder_id = ?').get(folderId));
  }

  function deleteFolder(folderId) {
    const id = String(folderId || '');
    const images = db.prepare('SELECT * FROM image_library_images WHERE folder_id = ?').all(id);
    ensureImagesNotReferenced(images);
    for (const image of images) removeStoredImageFile(image);
    db.prepare('DELETE FROM image_library_folders WHERE folder_id = ?').run(id);
    const dir = folderDir(id);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmSync(dir, { force: true });
    return { success: true };
  }

  // ── 图片 ────────────────────────────────────────
  function canonicalAssetUrl(fileName) {
    return `yibiao-asset://image-library/_assets/${encodeURIComponent(fileName)}`;
  }

  function resolveStoredImagePath(row) {
    try {
      const assetUrl = new URL(String(row?.asset_url || ''));
      if (assetUrl.protocol === 'yibiao-asset:' && assetUrl.hostname === 'image-library') {
        const relativePath = decodeURIComponent(assetUrl.pathname.replace(/^\/+/, ''));
        const resolved = path.resolve(baseDir, relativePath);
        if (resolved.startsWith(`${path.resolve(baseDir)}${path.sep}`)) return resolved;
      }
    } catch {
      // 兼容旧数据，继续按文件夹定位。
    }
    return path.join(folderDir(row?.folder_id), String(row?.file_name || ''));
  }

  function removeStoredImageFile(row) {
    const filePath = resolveStoredImagePath(row);
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }

  function getImageReferenceCount(row) {
    const suffix = `/${encodeURIComponent(String(row?.file_name || ''))}`;
    if (suffix === '/') return 0;
    const pattern = `%${suffix}%`;
    const lookups = [
      ['technical_plan_outline_nodes', 'content'],
      ['technical_plan_content_plans', 'plan_json'],
      ['technical_plan_meta', 'content_generation_runtime_json'],
    ];
    let count = 0;
    for (const [table, column] of lookups) {
      count += Number(db.prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE ${column} LIKE ?`).get(pattern)?.value || 0);
    }
    count += Number(db.prepare('SELECT COUNT(*) AS value FROM technical_plan_illustration_items WHERE generation_asset_url LIKE ?').get(pattern)?.value || 0);
    return count;
  }

  function ensureImagesNotReferenced(rows) {
    const referenced = rows.filter((row) => getImageReferenceCount(row) > 0);
    if (referenced.length) {
      const names = referenced.slice(0, 3).map((row) => row.name || row.original_name || row.file_name).join('、');
      throw new Error(`不能删除正在技术方案中使用的图片：${names}${referenced.length > 3 ? '等' : ''}`);
    }
  }

  function insertImageFile(folderId, sourcePath, {
    sourceDocumentId, preferredExt, name, sourceSectionPathJson, sourcePositionIndex, sourceContextText,
  } = {}) {
    ensureBaseDir();
    const buffer = fs.readFileSync(sourcePath);
    let width = null;
    let height = null;
    try {
      const dims = imageSize(buffer);
      width = dims?.width ?? null;
      height = dims?.height ?? null;
    } catch {
      // 忽略读不出尺寸的图片
    }
    const ext = String(preferredExt || '').toLowerCase() || path.extname(sourcePath).toLowerCase() || '.png';
    const imageId = createId('img');
    const fileName = `${imageId}${ext}`;
    const targetPath = path.join(assetDir, fileName);
    fs.writeFileSync(targetPath, buffer);
    const timestamp = now();
    const rawFolderId = String(folderId || '');
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const row = {
      image_id: imageId,
      folder_id: rawFolderId,
      file_name: fileName,
      asset_url: canonicalAssetUrl(fileName),
      mime: mimeFromExt(ext),
      ext: ext.replace(/^\./, '') || null,
      byte_size: buffer.length,
      width,
      height,
      source_document_id: sourceDocumentId || null,
      source_section_path_json: sourceSectionPathJson || null,
      source_position_index: Number.isFinite(sourcePositionIndex) ? sourcePositionIndex : 0,
      source_context_text: sourceContextText || null,
      content_hash: contentHash,
      name: name ? String(name) : null,
      original_name: name ? String(name) : path.basename(sourcePath, path.extname(sourcePath)),
      metadata_status: 'pending',
      metadata_error: null,
      metadata_updated_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.prepare(`
      INSERT INTO image_library_images (image_id, folder_id, file_name, asset_url, mime, ext, byte_size, width, height, source_document_id, content_hash, name, original_name, metadata_status, metadata_error, metadata_updated_at, created_at, updated_at, source_section_path_json, source_position_index, source_context_text)
      VALUES (@image_id, @folder_id, @file_name, @asset_url, @mime, @ext, @byte_size, @width, @height, @source_document_id, @content_hash, @name, @original_name, @metadata_status, @metadata_error, @metadata_updated_at, @created_at, @updated_at, @source_section_path_json, @source_position_index, @source_context_text)
    `).run(row);
    return row;
  }

  function buildExistingImageHashes() {
    const rows = db.prepare('SELECT image_id, folder_id, file_name, content_hash FROM image_library_images').all();
    const hashes = new Set();
    const update = db.prepare('UPDATE image_library_images SET content_hash = ? WHERE image_id = ?');
    for (const row of rows) {
      let hash = row.content_hash;
      if (!hash) {
        hash = fileHash(resolveStoredImagePath(row));
        if (hash) {
          try { update.run(hash, row.image_id); } catch { /* 忽略 */ }
        }
      }
      if (hash) hashes.add(hash);
    }
    return hashes;
  }

  async function uploadImages(filePaths, folderId) {
    const paths = Array.isArray(filePaths) ? filePaths : [];
    const existingHashes = buildExistingImageHashes();
    const created = [];
    for (const filePath of paths) {
      if (!filePath || !fs.existsSync(filePath)) continue;
      const hash = fileHash(filePath);
      if (hash && existingHashes.has(hash)) continue; // 内容已存在于图片库，跳过
      const ext = path.extname(filePath).toLowerCase();
      const name = path.basename(filePath, ext);
      const row = insertImageFile(folderId, filePath, { preferredExt: ext, name });
      if (row) {
        try {
          created.push(await describeStoredImage(row.image_id, {
            sourcePath: filePath,
            originalName: name,
            sourceContext: '用户直接上传到图片知识库',
          }));
        } catch {
          created.push(mapImage(db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(row.image_id)));
        }
      }
    }
    return created;
  }

  function listImages(folderId) {
    const rows = folderId
      ? db.prepare('SELECT * FROM image_library_images WHERE folder_id = ? ORDER BY created_at DESC').all(String(folderId || ''))
      : db.prepare('SELECT * FROM image_library_images ORDER BY created_at DESC').all();
    return rows.map(mapImage);
  }

  function deleteImage(imageId) {
    const row = db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(String(imageId || ''));
    if (!row) return { success: false, message: '图片不存在' };
    ensureImagesNotReferenced([row]);
    db.prepare('DELETE FROM image_library_images WHERE image_id = ?').run(row.image_id);
    removeStoredImageFile(row);
    return { success: true };
  }

  function deleteImages(imageIds) {
    const ids = Array.isArray(imageIds) ? imageIds : [];
    const rows = ids.map((imageId) => db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(String(imageId || ''))).filter(Boolean);
    ensureImagesNotReferenced(rows);
    let count = 0;
    for (const row of rows) {
      db.prepare('DELETE FROM image_library_images WHERE image_id = ?').run(row.image_id);
      removeStoredImageFile(row);
      count += 1;
    }
    return { success: true, count };
  }

  function moveImage(imageId, folderId) {
    const row = db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(String(imageId || ''));
    if (!row) return { success: false, message: '图片不存在' };
    const targetFolder = String(folderId || '');
    const timestamp = now();
    db.prepare('UPDATE image_library_images SET folder_id = ?, updated_at = ? WHERE image_id = ?')
      .run(targetFolder, timestamp, row.image_id);
    return mapImage(db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(row.image_id));
  }

  // ── 桥接：从文档知识库抽图入图片库 ───────────────
  function listDocumentImages() {
    const rows = db.prepare(`
      SELECT di.*, d.file_name AS source_file_name, d.folder_id AS source_folder_id
      FROM knowledge_document_images di
      JOIN knowledge_documents d ON d.document_id = di.document_id
      ORDER BY di.created_at DESC
    `).all();
    const seen = new Set();
    const result = [];
    for (const row of rows) {
      const sourcePath = path.join(getImportedImagesDir(app), row.batch_id, row.file_name);
      const hash = fs.existsSync(sourcePath) ? fileHash(sourcePath) : null;
      const key = hash || `${row.batch_id}-${row.file_name}`;
      if (seen.has(key)) continue; // 内容相同的重复图只保留一张
      seen.add(key);
      result.push({
        imageId: row.image_id,
        documentId: row.document_id,
        sourceFileName: row.source_file_name,
        documentName: row.source_file_name,
        batchId: row.batch_id,
        asset_url: row.asset_url,
        file_name: row.file_name,
        mime: row.mime,
        ext: row.ext,
        byteSize: row.byte_size,
        createdAt: row.created_at,
      });
    }
    return result;
  }

  async function importDocumentImages(documentImageIds, folderId) {
    const ids = Array.isArray(documentImageIds) ? documentImageIds : [];
    const targetFolder = String(folderId || '');
    const created = [];
    const existingHashes = buildExistingImageHashes();
    const importedHashes = new Set();
    for (const imageId of ids) {
      const row = db.prepare(`
        SELECT di.*, d.file_name AS source_document_name
        FROM knowledge_document_images di
        LEFT JOIN knowledge_documents d ON d.document_id = di.document_id
        WHERE di.image_id = ?
      `).get(String(imageId || ''));
      if (!row) continue;
      const sourcePath = path.join(getImportedImagesDir(app), row.batch_id, row.file_name);
      if (!fs.existsSync(sourcePath)) continue;
      const hash = fileHash(sourcePath);
      if (hash && (existingHashes.has(hash) || importedHashes.has(hash))) continue; // 图片库已有同内容图，或本批次已导入
      if (hash) importedHashes.add(hash);
      // 原始文件名只用于溯源，成功识别后会替换为语义名称。
      const name = row.file_name ? path.basename(row.file_name, path.extname(row.file_name)) : null;
      const inserted = insertImageFile(targetFolder, sourcePath, {
        sourceDocumentId: row.document_id,
        preferredExt: row.ext ? `.${row.ext}` : '',
        name,
        sourceSectionPathJson: row.section_path_json || null,
        sourcePositionIndex: Number.isFinite(row.position_index) ? row.position_index : 0,
        sourceContextText: row.context_text || null,
      });
      if (!inserted) continue;
      try {
        created.push(await describeStoredImage(inserted.image_id, {
          sourcePath,
          originalName: name || row.file_name,
          sourceContext: `来自文档《${row.source_document_name || '未知文档'}》`,
        }));
      } catch {
        created.push(mapImage(db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(inserted.image_id)));
      }
    }
    return created;
  }

  function renameImage(imageId, name) {
    const timestamp = now();
    db.prepare('UPDATE image_library_images SET name = ?, updated_at = ? WHERE image_id = ?')
      .run(String(name || '').trim() || null, timestamp, String(imageId || ''));
    return mapImage(db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(imageId));
  }

  // 更新素材的标题、内容描述与标签，供 AI 配图编排时按内容匹配。
  function updateImageMeta(imageId, meta) {
    const id = String(imageId || '');
    const row = db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(id);
    if (!row) throw new Error('图片不存在');
    const patch = (meta && typeof meta === 'object' && !Array.isArray(meta)) ? meta : {};
    const name = typeof patch.name === 'string' ? (patch.name.trim() || null) : (row.name || null);
    const description = typeof patch.description === 'string' ? (patch.description.trim() || null) : (row.description || null);
    const tags = typeof patch.tags === 'string' ? (patch.tags.trim() || null) : (row.tags || null);
    const timestamp = now();
    const metadataStatus = description || tags ? 'ready' : 'pending';
    db.prepare('UPDATE image_library_images SET name = ?, description = ?, tags = ?, metadata_status = ?, metadata_error = NULL, metadata_updated_at = ?, updated_at = ? WHERE image_id = ?')
      .run(name, description, tags, metadataStatus, timestamp, timestamp, id);
    return mapImage(db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(id));
  }

  async function describeStoredImage(imageId, context = {}) {
    const id = String(imageId || '');
    const row = db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(id);
    if (!row) throw new Error('图片不存在');
    if (!aiServiceRef?.describeImage) throw new Error('当前 AI 服务不支持图片识别');
    const sourcePath = context.sourcePath || resolveStoredImagePath(row);
    const timestamp = now();
    db.prepare("UPDATE image_library_images SET metadata_status = 'processing', metadata_error = NULL, metadata_updated_at = ?, updated_at = ? WHERE image_id = ?")
      .run(timestamp, timestamp, id);
    try {
      const metadata = await aiServiceRef.describeImage(sourcePath, {
        originalName: context.originalName || row.original_name || row.name || row.file_name,
        sourceContext: context.sourceContext || '',
      });
      const updatedAt = now();
      db.prepare(`
        UPDATE image_library_images
        SET name = ?, description = ?, tags = ?, metadata_status = 'ready', metadata_error = NULL,
            metadata_updated_at = ?, updated_at = ?
        WHERE image_id = ?
      `).run(metadata.name, metadata.description, metadata.tags || null, updatedAt, updatedAt, id);
      return mapImage(db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(id));
    } catch (error) {
      const failedAt = now();
      const message = error?.message || '图片识别失败';
      db.prepare("UPDATE image_library_images SET metadata_status = 'failed', metadata_error = ?, metadata_updated_at = ?, updated_at = ? WHERE image_id = ?")
        .run(message, failedAt, failedAt, id);
      throw error;
    }
  }

  async function describeImages(imageIds) {
    const ids = [...new Set((Array.isArray(imageIds) ? imageIds : []).map((id) => String(id || '')).filter(Boolean))];
    const images = [];
    let successCount = 0;
    let failedCount = 0;
    for (const imageId of ids) {
      try {
        images.push(await describeStoredImage(imageId));
        successCount += 1;
      } catch {
        const row = db.prepare('SELECT * FROM image_library_images WHERE image_id = ?').get(imageId);
        if (row) images.push(mapImage(row));
        failedCount += 1;
      }
    }
    return { success: failedCount === 0, successCount, failedCount, images };
  }

  function normalizeExistingAssetStorage() {
    ensureBaseDir();
    const rows = db.prepare('SELECT * FROM image_library_images').all();
    const update = db.prepare('UPDATE image_library_images SET asset_url = ?, updated_at = ? WHERE image_id = ?');
    for (const row of rows) {
      const canonicalUrl = canonicalAssetUrl(row.file_name);
      const targetPath = path.join(assetDir, row.file_name);
      const sourcePath = resolveStoredImagePath(row);
      if (!fs.existsSync(targetPath) && sourcePath && fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
      }
      if (row.asset_url !== canonicalUrl && fs.existsSync(targetPath)) {
        update.run(canonicalUrl, now(), row.image_id);
      }
    }
  }

  normalizeExistingAssetStorage();

  return {
    listFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    uploadImages,
    listImages,
    deleteImage,
    deleteImages,
    moveImage,
    listDocumentImages,
    importDocumentImages,
    renameImage,
    updateImageMeta,
    describeImages,
    setAiService,
  };
}

module.exports = {
  createImageLibraryService,
};
