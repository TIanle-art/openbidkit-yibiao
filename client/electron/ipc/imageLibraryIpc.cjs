const { dialog, ipcMain } = require('electron');
const path = require('node:path');

function registerImageLibraryIpc({ imageLibraryService }) {
  ipcMain.handle('image-library:list-folders', () => imageLibraryService.listFolders());
  ipcMain.handle('image-library:create-folder', (_event, name) => imageLibraryService.createFolder(name));
  ipcMain.handle('image-library:rename-folder', (_event, folderId, name) => imageLibraryService.renameFolder(folderId, name));
  ipcMain.handle('image-library:delete-folder', (_event, folderId) => imageLibraryService.deleteFolder(folderId));
  ipcMain.handle('image-library:list-images', (_event, folderId) => imageLibraryService.listImages(folderId));

  ipcMain.handle('image-library:upload-images', async (_event, folderId, filePaths) => {
    let paths = Array.isArray(filePaths) && filePaths.length ? filePaths : null;
    if (!paths) {
      const result = await dialog.showOpenDialog({
        title: '选择图片',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, message: '已取消选择' };
      }
      paths = result.filePaths;
    }
    const created = await imageLibraryService.uploadImages(paths, folderId);
    return { success: true, images: created, count: created.length };
  });

  ipcMain.handle('image-library:delete-image', (_event, imageId) => imageLibraryService.deleteImage(imageId));
  ipcMain.handle('image-library:delete-images', (_event, imageIds) => imageLibraryService.deleteImages(imageIds));
  ipcMain.handle('image-library:move-image', (_event, imageId, folderId) => imageLibraryService.moveImage(imageId, folderId));
  ipcMain.handle('image-library:rename-image', (_event, imageId, name) => imageLibraryService.renameImage(imageId, name));
  ipcMain.handle('image-library:update-image-meta', (_event, imageId, meta) => imageLibraryService.updateImageMeta(imageId, meta));
  ipcMain.handle('image-library:describe-images', (_event, imageIds) => imageLibraryService.describeImages(imageIds));

  ipcMain.handle('image-library:list-document-images', () => imageLibraryService.listDocumentImages());
  ipcMain.handle('image-library:import-document-images', async (_event, documentImageIds, folderId) => {
    const created = await imageLibraryService.importDocumentImages(documentImageIds, folderId);
    return { success: true, images: created, count: created.length };
  });
}

module.exports = {
  registerImageLibraryIpc,
};
