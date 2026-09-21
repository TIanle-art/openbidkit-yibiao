import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppDialog, useToast } from '../../../shared/ui';
import type { ImageLibraryDocumentImage, ImageLibraryFolder, ImageLibraryImage } from '../../../shared/types/ipc';

interface ImageLibraryPageProps {
  onSectionChange?: (section: import('../../../shared/types/navigation').SectionId) => void;
}

interface ImageDescribeProgress {
  completed: number;
  total: number;
  success: number;
  failed: number;
}

function imageLibraryErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('No handler registered for') && message.includes('image-library:')) {
    return '应用主进程仍是修改前的旧版本，请完全退出易标后重新启动再试';
  }
  return message || fallback;
}

function ImageLibraryPage({ onSectionChange }: ImageLibraryPageProps) {
  const { showToast } = useToast();
  const [folders, setFolders] = useState<ImageLibraryFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [images, setImages] = useState<ImageLibraryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [docImages, setDocImages] = useState<ImageLibraryDocumentImage[]>([]);
  const [selectedDocImageIds, setSelectedDocImageIds] = useState<string[]>([]);
  const [docImagesLoading, setDocImagesLoading] = useState(false);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<ImageLibraryFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageLibraryImage | null>(null);
  const [renameTarget, setRenameTarget] = useState<ImageLibraryImage | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameDescription, setRenameDescription] = useState('');
  const [renameTags, setRenameTags] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [deletingImages, setDeletingImages] = useState(false);
  const [deleteImageTargets, setDeleteImageTargets] = useState<ImageLibraryImage[]>([]);
  const [describingImageIds, setDescribingImageIds] = useState<string[]>([]);
  const [describeProgress, setDescribeProgress] = useState<ImageDescribeProgress | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  const selectedFolder = useMemo(() => folders.find((item) => item.folderId === selectedFolderId) || null, [folders, selectedFolderId]);
  const incompleteImages = useMemo(() => images.filter((item) => item.metadataStatus !== 'ready'), [images]);
  const describing = Boolean(describeProgress);

  const loadFolders = useCallback(async () => {
    let items = (await window.yibiao?.imageLibrary.listFolders()) || [];
    if (items.length === 0) {
      try {
        const created = await window.yibiao?.imageLibrary.createFolder('默认');
        if (created?.folderId) items = [created];
      } catch {
        // 忽略自动创建失败，保持空状态
      }
    }
    setFolders(items);
    setSelectedFolderId((prev) => (items.some((item) => item.folderId === prev) ? prev : items[0]?.folderId || ''));
  }, []);

  const loadImages = useCallback(async (folderId: string) => {
    try {
      const items = folderId ? (await window.yibiao?.imageLibrary.listImages(folderId)) : [];
      setImages(folderId ? items || [] : []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取图片失败', 'error');
      setImages([]);
    }
  }, [showToast]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    setLoading(true);
    setSelectedImageIds([]);
    void loadImages(selectedFolderId).finally(() => setLoading(false));
  }, [selectedFolderId, loadImages]);

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => !prev);
    setSelectedImageIds([]);
  };

  const toggleImageSelection = (imageId: string) => {
    setSelectedImageIds((prev) => prev.includes(imageId) ? prev.filter((id) => id !== imageId) : [...prev, imageId]);
  };

  const handleBulkDelete = async () => {
    if (!deleteImageTargets.length) return;
    setDeletingImages(true);
    try {
      const result = await window.yibiao?.imageLibrary.deleteImages(deleteImageTargets.map((item) => item.imageId));
      showToast(`已删除 ${result?.count ?? 0} 张图片`, 'success');
      setDeleteImageTargets([]);
      setSelectedImageIds([]);
      setSelectionMode(false);
      await loadImages(selectedFolderId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除图片失败', 'error');
    } finally {
      setDeletingImages(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    setDeletingFolder(true);
    try {
      await window.yibiao?.imageLibrary.deleteFolder(deleteFolderTarget.folderId);
      showToast('文件夹已删除', 'success');
      const targetId = deleteFolderTarget.folderId;
      setDeleteFolderTarget(null);
      setSelectedFolderId((prev) => (prev === targetId ? '' : prev));
      await loadFolders();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除文件夹失败', 'error');
    } finally {
      setDeletingFolder(false);
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      showToast('请输入文件夹名称', 'info');
      return;
    }
    setCreatingFolder(true);
    try {
      const folder = await window.yibiao?.imageLibrary.createFolder(name);
      if (folder?.folderId) {
        setNewFolderName('');
        setCreateFolderOpen(false);
        await loadFolders();
        setSelectedFolderId(folder.folderId);
        showToast('文件夹已创建', 'success');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '新建文件夹失败', 'error');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDescribeImages = async (imageIds: string[]) => {
    const ids = [...new Set(imageIds)].filter(Boolean);
    if (!ids.length || describing) return;
    let nextIndex = 0;
    let completed = 0;
    let success = 0;
    let failed = 0;
    let fatalError: unknown = null;
    setDescribingImageIds(ids);
    setDescribeProgress({ completed: 0, total: ids.length, success: 0, failed: 0 });

    const updateImages = (updatedImages: ImageLibraryImage[]) => {
      if (!updatedImages.length) return;
      const updatedById = new Map(updatedImages.map((item) => [item.imageId, item]));
      setImages((prev) => prev.map((item) => updatedById.get(item.imageId) || item));
    };

    const runWorker = async () => {
      while (!fatalError) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= ids.length) return;
        const imageId = ids[index];
        try {
          const result = await window.yibiao?.imageLibrary.describeImages([imageId]);
          if (!result) throw new Error('图片知识库服务尚未就绪');
          updateImages(result.images || []);
          success += result.successCount || 0;
          failed += result.failedCount || 0;
          completed += 1;
          setDescribeProgress({ completed, total: ids.length, success, failed });
          setDescribingImageIds((prev) => prev.filter((id) => id !== imageId));
        } catch (error) {
          fatalError = error;
          return;
        }
      }
    };

    try {
      const workerCount = Math.min(4, ids.length);
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
      if (fatalError) {
        showToast(imageLibraryErrorMessage(fatalError, 'AI 识别图片失败'), 'error');
      } else if (failed) {
        showToast(`AI 识别完成：成功 ${success} 张，失败 ${failed} 张`, 'info');
      } else {
        showToast(`AI 已识别 ${success} 张图片`, 'success');
      }
      await loadImages(selectedFolderId);
    } finally {
      setDescribingImageIds([]);
      setDescribeProgress(null);
    }
  };

  const handleMoveImage = async (imageId: string, folderId: string) => {
    if (!folderId) return;
    try {
      await window.yibiao?.imageLibrary.moveImage(imageId, folderId);
      setImages((prev) => prev.filter((item) => item.imageId !== imageId));
      showToast('图片已移动', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '移动图片失败', 'error');
    }
  };

  const handleSaveImageMeta = async () => {
    if (!renameTarget) return;
    setRenaming(true);
    try {
      const updated = await window.yibiao?.imageLibrary.updateImageMeta(renameTarget.imageId, {
        name: renameName.trim(),
        description: renameDescription.trim(),
        tags: renameTags.trim(),
      });
      if (updated?.imageId) {
        setImages((prev) => prev.map((item) => (item.imageId === updated.imageId ? updated : item)));
      }
      showToast('素材信息已保存', 'success');
      setRenameTarget(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存素材信息失败', 'error');
    } finally {
      setRenaming(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFolderId) {
      showToast('请先选择一个文件夹', 'info');
      return;
    }
    setUploading(true);
    try {
      const result = await window.yibiao?.imageLibrary.uploadImages(selectedFolderId);
      if (result?.success) {
        const failedCount = result.images?.filter((item) => item.metadataStatus === 'failed').length || 0;
        showToast(failedCount ? `已导入 ${result.count ?? 0} 张，${failedCount} 张 AI 识别失败，可稍后重试` : `已导入并识别 ${result.count ?? 0} 张图片`, failedCount ? 'info' : 'success');
        await loadImages(selectedFolderId);
      } else {
        showToast(result?.message || '未选择文件', 'info');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '上传图片失败', 'error');
    } finally {
      setUploading(false);
    }
  };

  const openImport = async () => {
    setShowImport(true);
    setDocImagesLoading(true);
    try {
      const items = (await window.yibiao?.imageLibrary.listDocumentImages()) || [];
      setDocImages(items);
      setSelectedDocImageIds([]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取文档图片失败', 'error');
    } finally {
      setDocImagesLoading(false);
    }
  };

  const handleImportSelected = async () => {
    if (!selectedDocImageIds.length) {
      showToast('请先勾选要导入的图片', 'info');
      return;
    }
    if (!selectedFolderId) {
      showToast('请先在左侧创建或选择一个图片文件夹', 'info');
      return;
    }
    setImporting(true);
    try {
      const result = await window.yibiao?.imageLibrary.importDocumentImages(selectedDocImageIds, selectedFolderId);
      const failedCount = result?.images?.filter((item) => item.metadataStatus === 'failed').length || 0;
      showToast(failedCount ? `已导入 ${result?.count ?? 0} 张，${failedCount} 张 AI 识别失败` : `已导入并识别 ${result?.count ?? 0} 张图片`, failedCount ? 'info' : 'success');
      setShowImport(false);
      await loadImages(selectedFolderId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入文档图片失败', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="ilb-page">
      <aside className="ilb-folder-panel">
        <div className="ilb-folder-head">
          <span className="section-kicker">图片知识库</span>
          <div className="ilb-folder-head-actions">
            {selectedFolder ? (
              <button type="button" className="text-button is-danger" onClick={() => setDeleteFolderTarget(selectedFolder)}>删除</button>
            ) : null}
            <button type="button" className="text-button" onClick={() => { setNewFolderName(''); setCreateFolderOpen(true); }}>新建</button>
          </div>
        </div>
        <div className="ilb-folder-list">
          {folders.length === 0 ? <div className="ilb-empty-inline">还没有文件夹</div> : null}
          {folders.map((folder) => (
            <button key={folder.folderId} className={`ilb-folder${selectedFolder?.folderId === folder.folderId ? ' is-active' : ''}`} onClick={() => setSelectedFolderId(folder.folderId)} disabled={describing}>
              <span className="ilb-folder-icon">▤</span>
              <span className="ilb-folder-name">{folder.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="ilb-content-panel">
        <div className="ilb-toolbar">
          <div className="ilb-toolbar-title">
            <span className="section-kicker">{selectedFolder ? '文件夹' : '图片'}</span>
            <h2>{selectedFolder?.name || '图片知识库'}</h2>
            {images.length > 0 ? <span className="ilb-count">共 {images.length} 张</span> : null}
          </div>
          <div className="ilb-toolbar-actions">
            {incompleteImages.length ? (
              <button type="button" className="secondary-action" onClick={() => void handleDescribeImages(incompleteImages.map((item) => item.imageId))} disabled={describing}>
                {describeProgress ? `AI 识别中 ${describeProgress.completed}/${describeProgress.total}` : `AI 识别待完善（${incompleteImages.length}）`}
              </button>
            ) : null}
            <button type="button" className="secondary-action" onClick={openImport} disabled={describing}>从文档知识库导入</button>
            <button type="button" className="secondary-action" onClick={handleUpload} disabled={uploading || describing}>
              {uploading ? '上传中…' : '上传图片'}
            </button>
            {!selectionMode ? (
              <button type="button" className="secondary-action" onClick={toggleSelectionMode} disabled={images.length === 0 || describing}>多选</button>
            ) : (
              <button type="button" className="secondary-action" onClick={toggleSelectionMode}>取消</button>
            )}
          </div>
        </div>

        {describeProgress ? (
          <div className="ilb-ai-progress" role="status" aria-live="polite">
            <div className="ilb-ai-progress-head">
              <strong>AI 正在完善图片语义</strong>
              <span>{describeProgress.completed}/{describeProgress.total}（{Math.round((describeProgress.completed / describeProgress.total) * 100)}%）</span>
            </div>
            <progress max={describeProgress.total} value={describeProgress.completed} />
            <div className="ilb-ai-progress-meta">
              <span>成功 {describeProgress.success} 张</span>
              <span>失败 {describeProgress.failed} 张</span>
              <span>最多同时识别 4 张</span>
            </div>
          </div>
        ) : null}

        {selectionMode && images.length > 0 ? (
          <div className="ilb-select-bar">
            <label className="ilb-select-all">
              <input type="checkbox" checked={selectedImageIds.length === images.length} onChange={(event) => setSelectedImageIds(event.target.checked ? images.map((item) => item.imageId) : [])} />
              全选
            </label>
            <span>已选 {selectedImageIds.length} 张</span>
            <button type="button" className="danger-action" onClick={() => setDeleteImageTargets(images.filter((item) => selectedImageIds.includes(item.imageId)))} disabled={deletingImages || selectedImageIds.length === 0}>
              {deletingImages ? '删除中…' : '删除选中'}
            </button>
          </div>
        ) : null}

        <div className="ilb-grid">
          {loading ? <div className="ilb-empty"><strong>正在读取</strong><span>请稍候…</span></div> : null}
          {!loading && images.length === 0 ? (
            <div className="ilb-empty">
              <strong>这个文件夹还没有图片</strong>
              <span>点击「上传图片」添加，或「从文档知识库导入」把已有标书里的图提出来。</span>
            </div>
          ) : null}
          {!loading && images.map((image) => (
            <figure className={`ilb-card${selectionMode && selectedImageIds.includes(image.imageId) ? ' is-selected' : ''}`} key={image.imageId}>
              <button type="button" className="ilb-thumb" onClick={() => (selectionMode ? toggleImageSelection(image.imageId) : setPreviewImage(image))} title={selectionMode ? '点击选择' : '点击放大'}>
                <img
                  src={image.asset_url}
                  alt={image.name || image.fileName}
                  onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                />
                {selectionMode ? <span className="ilb-select-check">{selectedImageIds.includes(image.imageId) ? '✓' : ''}</span> : null}
              </button>
              <figcaption className="ilb-card-meta">
                <span title={image.name || image.fileName}>{image.name || image.fileName}</span>
                {image.description ? <small className="ilb-card-desc" title={image.description}>{image.description}</small> : <small className="ilb-card-desc ilb-card-desc-empty">未填写内容描述，AI 无法按内容复用</small>}
                <small className={`ilb-meta-status is-${image.metadataStatus}`} title={image.metadataError || ''}>
                  {image.metadataStatus === 'ready' ? 'AI 语义已完善' : image.metadataStatus === 'processing' ? 'AI 识别中' : image.metadataStatus === 'failed' ? `AI 识别失败${image.metadataError ? `：${image.metadataError}` : ''}` : '待 AI 识别'}
                </small>
                {image.tags ? <small className="ilb-card-tags">{image.tags.split(/[,，;；\s]+/).filter(Boolean).slice(0, 5).map((tag) => <em key={tag}>{tag}</em>)}</small> : null}
                <small>{image.width && image.height ? `${image.width}×${image.height}` : image.ext || ''}</small>
              </figcaption>
              {!selectionMode ? (
                <div className="ilb-card-actions">
                  <select defaultValue="" disabled={describing} onChange={(event) => { if (event.target.value) void handleMoveImage(image.imageId, event.target.value); }}>
                    <option value="" disabled>移到…</option>
                    {folders.filter((folder) => folder.folderId !== image.folderId).map((folder) => (
                      <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>
                    ))}
                  </select>
                  <button type="button" disabled={describing} onClick={() => { setRenameTarget(image); setRenameName(image.name || image.fileName); setRenameDescription(image.description || ''); setRenameTags(image.tags || ''); }}>编辑</button>
                  <button type="button" onClick={() => void handleDescribeImages([image.imageId])} disabled={describingImageIds.includes(image.imageId)}>{describingImageIds.includes(image.imageId) ? '识别中…' : image.metadataStatus === 'ready' ? '重新识别' : 'AI 识别'}</button>
                  <button type="button" className="is-danger" disabled={describing} onClick={() => setDeleteImageTargets([image])}>删除</button>
                </div>
              ) : null}
            </figure>
          ))}
        </div>
      </section>

      {showImport ? (
        <div className="ilb-dialog-backdrop">
          <div className="ilb-dialog" role="dialog" aria-modal="true">
            <div className="ilb-dialog-head">
              <h3>从文档知识库导入图片</h3>
              <p>选择文档知识库中已抽取的图片，加入当前文件夹「{selectedFolder?.name || '-'}」。已按内容去重，相同图片只显示一张。</p>
            </div>
            <label className="ilb-select-all">
              <input
                type="checkbox"
                checked={docImages.length > 0 && docImages.every((item) => selectedDocImageIds.includes(item.imageId))}
                onChange={(event) => setSelectedDocImageIds(event.target.checked ? docImages.map((item) => item.imageId) : [])}
              />
              全选（{docImages.length}）
            </label>
            <div className="ilb-dialog-body">
              {docImagesLoading ? <div className="ilb-empty"><strong>正在读取</strong><span>请稍候…</span></div> : null}
              {!docImagesLoading && docImages.length === 0 ? (
                <div className="ilb-empty"><strong>没有可从文档知识库导入的图片</strong><span>请先导入 PDF/Word 到文档知识库，并完成解析。</span></div>
              ) : null}
              {!docImagesLoading && docImages.map((docImage) => (
                <label className="ilb-doc-item" key={docImage.imageId}>
                  <input type="checkbox" checked={selectedDocImageIds.includes(docImage.imageId)} onChange={(event) => {
                    setSelectedDocImageIds((prev) => event.target.checked ? [...prev, docImage.imageId] : prev.filter((id) => id !== docImage.imageId));
                  }} />
                  <img src={docImage.asset_url} alt={docImage.file_name} loading="lazy" />
                  <div className="ilb-doc-item-meta">
                    <span>{docImage.file_name}</span>
                    <small>{docImage.documentName} · {docImage.byteSize} 字节</small>
                  </div>
                </label>
              ))}
            </div>
            <div className="ilb-dialog-actions">
              <button type="button" className="text-button" onClick={() => setShowImport(false)}>取消</button>
              <button type="button" className="primary-action" onClick={handleImportSelected} disabled={importing || !selectedDocImageIds.length}>
                {importing ? '导入中…' : `导入所选（${selectedDocImageIds.length}）`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewImage ? (
        <div className="ilb-lightbox-backdrop" onClick={() => setPreviewImage(null)}>
          <div className="ilb-lightbox" onClick={(event) => event.stopPropagation()}>
            <img src={previewImage.asset_url} alt={previewImage.name || previewImage.fileName} />
          </div>
        </div>
      ) : null}

      <AppDialog
        open={createFolderOpen}
        onOpenChange={(open) => { if (!open && !creatingFolder) setCreateFolderOpen(false); }}
        kicker="图片知识库"
        title="新建文件夹"
        actions={(
          <>
            <button type="button" className="text-button" onClick={() => setCreateFolderOpen(false)} disabled={creatingFolder}>取消</button>
            <button type="button" className="primary-action" onClick={() => void handleCreateFolder()} disabled={creatingFolder}>
              {creatingFolder ? '创建中…' : '创建'}
            </button>
          </>
        )}
      >
        <div className="ilb-field">
          <span>文件夹名称</span>
          <input className="ilb-rename-input" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="输入文件夹名称" autoFocus onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateFolder(); }} />
        </div>
      </AppDialog>

      <AppDialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
        kicker="图片知识库"
        title="编辑素材信息"
        actions={(
          <>
            <button type="button" className="text-button" onClick={() => setRenameTarget(null)} disabled={renaming}>取消</button>
            <button type="button" className="primary-action" onClick={() => void handleSaveImageMeta()} disabled={renaming}>
              {renaming ? '保存中…' : '保存'}
            </button>
          </>
        )}
      >
        <div className="ilb-field">
          <span>图片标题</span>
          <input className="ilb-rename-input" value={renameName} onChange={(event) => setRenameName(event.target.value)} placeholder="便于查找与 AI 识别的简短名称" autoFocus />
        </div>
        <div className="ilb-field">
          <span>内容描述</span>
          <textarea className="ilb-rename-input ilb-textarea" value={renameDescription} onChange={(event) => setRenameDescription(event.target.value)} placeholder="描述图片中的对象、场景或结构，AI 配图时将依据它匹配章节" rows={3} />
        </div>
        <div className="ilb-field">
          <span>标签</span>
          <input className="ilb-rename-input" value={renameTags} onChange={(event) => setRenameTags(event.target.value)} placeholder="多个标签用逗号或空格分隔，如：设备、现场、架构" />
        </div>
      </AppDialog>

      <AppDialog
        open={deleteImageTargets.length > 0}
        onOpenChange={(open) => { if (!open && !deletingImages) setDeleteImageTargets([]); }}
        kicker="图片知识库"
        title={deleteImageTargets.length > 1 ? `删除 ${deleteImageTargets.length} 张图片` : '删除图片'}
        description="删除前会检查技术方案引用；已被使用的图片不会被删除。未被引用的图片删除后无法恢复。"
        actions={(
          <>
            <button type="button" className="text-button" onClick={() => setDeleteImageTargets([])} disabled={deletingImages}>取消</button>
            <button type="button" className="danger-action" onClick={() => void handleBulkDelete()} disabled={deletingImages}>
              {deletingImages ? '删除中…' : '确认删除'}
            </button>
          </>
        )}
      />

      <AppDialog
        open={Boolean(deleteFolderTarget)}
        onOpenChange={(open) => { if (!open) setDeleteFolderTarget(null); }}
        kicker="图片知识库"
        title="删除文件夹"
        description={`确定删除文件夹「${deleteFolderTarget?.name || ''}」吗？其中的图片会一并删除，该操作不可撤销。`}
        actions={(
          <>
            <button type="button" className="text-button" onClick={() => setDeleteFolderTarget(null)} disabled={deletingFolder}>取消</button>
            <button type="button" className="danger-action" onClick={() => void handleDeleteFolder()} disabled={deletingFolder}>
              {deletingFolder ? '删除中…' : '删除'}
            </button>
          </>
        )}
      />
    </div>
  );
}

export default ImageLibraryPage;
