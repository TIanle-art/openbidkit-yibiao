const { dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const {
  runPastBidTemplateExtractionTask,
} = require('../services/pastBidTemplateExtractionTask.cjs');
const { buildDocxBuffer } = require('../services/exportService.cjs');
const { buildDefaultExportFormat } = require('../services/exportFormatDerive.cjs');

function skeletonToOutlineNodes(chapter) {
  const markdownLines = [];
  if (chapter.note) markdownLines.push(`> ${chapter.note}`);
  for (const point of chapter.points || []) {
    if (point) markdownLines.push(`- ${point}`);
  }
  if (chapter.placeholder) markdownLines.push(`**待填：** ${chapter.placeholder}`);
  return {
    title: chapter.title,
    content: markdownLines.join('\n'),
    children: (chapter.children || []).map(skeletonToOutlineNodes),
  };
}

function normalizeProvidedFilePaths(filePaths) {
  if (!Array.isArray(filePaths)) return [];
  return filePaths.map((item) => String(item || '').trim()).filter(Boolean);
}

function registerPastBidTemplateIpc({ pastBidTemplateStore, templateStore, taskService, fileService }) {
  ipcMain.handle('past-bid-template:list', () => pastBidTemplateStore.listTemplates());
  ipcMain.handle('past-bid-template:get', (_event, templateId) => pastBidTemplateStore.getTemplate(templateId));
  ipcMain.handle('past-bid-template:create', (_event, input) => pastBidTemplateStore.createTemplate(input));
  ipcMain.handle('past-bid-template:delete', (_event, templateId) => pastBidTemplateStore.deleteTemplate(templateId));
  ipcMain.handle('past-bid-template:read-source', (_event, templateId, fileName) => pastBidTemplateStore.readSourceMarkdown(templateId, fileName));

  // 启动后台提炼任务；不传 filePaths 时弹出标书选择框（限定 pdf/docx/doc/wps）。
  ipcMain.handle('past-bid-template:start-extract', async (_event, filePaths) => {
    let paths = normalizeProvidedFilePaths(filePaths);
    if (!paths.length) {
      const result = await dialog.showOpenDialog({
        title: '选择历史标书（.pdf / .docx）',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'PDF / Word / WPS 标书', extensions: ['pdf', 'docx', 'doc', 'wps'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, message: '已取消选择' };
      }
      paths = result.filePaths;
    }

    const runner = (context) => runPastBidTemplateExtractionTask({ ...context, fileService });
    const task = taskService.startPastBidTemplateExtraction({ file_paths: paths }, runner);
    return { success: true, task_id: task.task_id, group: 'past-bid-template' };
  });

  // 把提炼的内容模板导出为 Markdown 文件，供直接编辑/作为新标书结构骨架使用。
  ipcMain.handle('past-bid-template:save-markdown', async (_event, payload) => {
    const suggestedName = String(payload?.suggested_name || '内容模板').replace(/[\\/:*?"<>|]/g, '_') || '内容模板';
    const content = String(payload?.content || '');
    if (!content.trim()) {
      return { success: false, message: '内容为空，未导出' };
    }
    const result = await dialog.showSaveDialog({
      title: '导出内容模板为 Markdown',
      defaultPath: `${suggestedName}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) {
      return { success: false, message: '已取消导出' };
    }
    try {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return { success: true, message: '已导出', path: result.filePath };
    } catch (error) {
      return { success: false, message: `导出失败：${error?.message || String(error)}` };
    }
  });

  // 把内容模板骨架导出为 Word (.docx)，并套用指定的排版模板（未指定时用系统默认排版）。
  ipcMain.handle('past-bid-template:export-word', async (_event, payload) => {
    const skeleton = payload?.skeleton;
    if (!skeleton || !Array.isArray(skeleton.chapters)) {
      return { success: false, message: '内容模板为空，未导出' };
    }
    const suggestedName = String(payload?.suggested_name || '内容模板').replace(/[\\/:*?"<>|]/g, '_') || '内容模板';
    const openResult = await dialog.showSaveDialog({
      title: '导出内容模板为 Word',
      defaultPath: `${suggestedName}.docx`,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (openResult.canceled || !openResult.filePath) {
      return { success: false, message: '已取消导出' };
    }
    try {
      // 套用指定排版模板（我的模板 / export_templates）；未指定时用系统默认排版。
      const exportTemplate = payload?.template_id ? templateStore?.getTemplate(payload.template_id) : null;
      const exportFormat = exportTemplate?.config || buildDefaultExportFormat();
      const buffer = await buildDocxBuffer({
        outline: skeleton.chapters.map(skeletonToOutlineNodes),
        export_format: exportFormat,
        project_name: suggestedName,
      }, {});
      fs.writeFileSync(openResult.filePath, buffer);
      return { success: true, message: '已导出 Word 模板', path: openResult.filePath };
    } catch (error) {
      return { success: false, message: `导出失败：${error?.message || String(error)}` };
    }
  });
}

module.exports = {
  registerPastBidTemplateIpc,
};
