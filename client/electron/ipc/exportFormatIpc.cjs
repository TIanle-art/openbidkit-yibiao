const { dialog, ipcMain } = require('electron');
const path = require('node:path');
const { deriveExportFormatFromFile } = require('../services/exportFormatDerive.cjs');

function registerExportFormatIpc() {
  // 从 .docx 或 .pdf 标书推导导出排版配置；不传 filePaths 时弹出选择框（限定 docx/pdf）。
  ipcMain.handle('templates:derive-from-file', async (_event, filePaths) => {
    let paths = Array.isArray(filePaths) && filePaths.length ? filePaths : null;
    if (!paths) {
      const result = await dialog.showOpenDialog({
        title: '选择标书（.docx / .pdf）',
        properties: ['openFile'],
        filters: [
          { name: 'Word / PDF 标书', extensions: ['docx', 'pdf'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, message: '已取消选择' };
      }
      paths = result.filePaths;
    }

    const filePath = paths[0];
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.docx' && ext !== '.pdf') {
      return { success: false, message: '当前只支持 .docx / .pdf 标书推导排版' };
    }

    try {
      const { config, summary } = await deriveExportFormatFromFile(filePath);
      return { success: true, config, summary, fileName: path.basename(filePath) };
    } catch (error) {
      return { success: false, message: error?.message || String(error) };
    }
  });
}

module.exports = {
  registerExportFormatIpc,
};
