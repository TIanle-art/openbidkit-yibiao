const { ipcMain, shell } = require('electron');
const { runTemplateFillTask, cancelTemplateFill } = require('../services/templateFillTask.cjs');

function registerTechnicalPlanIpc({ technicalPlanStore, taskService, aiService, knowledgeBaseService }) {
  ipcMain.handle('technical-plan:load-state', () => technicalPlanStore.loadTechnicalPlan());
  ipcMain.handle('technical-plan:import-tender-document', (_event, filePaths) => taskService.importTenderDocument(filePaths));
  ipcMain.handle('technical-plan:remove-tender-document', (_event, sourceId) => taskService.removeTenderDocument(sourceId));
  ipcMain.handle('technical-plan:import-original-plan-document', (_event, filePaths) => taskService.importOriginalPlanDocument(filePaths));
  ipcMain.handle('technical-plan:check-bid-sections', () => technicalPlanStore.checkBidSections());
  ipcMain.handle('technical-plan:select-bid-section', (_event, selectedSection) => technicalPlanStore.selectBidSection(selectedSection));
  ipcMain.handle('technical-plan:read-tender-markdown', () => technicalPlanStore.readTenderMarkdown());
  ipcMain.handle('technical-plan:read-tender-source-markdown', (_event, sourceId) => technicalPlanStore.readTenderSourceMarkdown(sourceId));
  ipcMain.handle('technical-plan:read-original-plan-markdown', () => technicalPlanStore.readOriginalPlanMarkdown());
  ipcMain.handle('technical-plan:update-step', (_event, step) => technicalPlanStore.updateStep(step));
  ipcMain.handle('technical-plan:set-workflow-kind', (_event, workflowKind) => technicalPlanStore.setWorkflowKind(workflowKind));
  ipcMain.handle('technical-plan:switch-workflow-kind', (_event, workflowKind) => technicalPlanStore.switchWorkflowKind(workflowKind));
  ipcMain.handle('technical-plan:save-bid-analysis-config', (_event, payload) => technicalPlanStore.saveBidAnalysisConfig(payload));
  ipcMain.handle('technical-plan:save-outline-config', (_event, payload) => technicalPlanStore.saveOutlineConfig(payload));
  ipcMain.handle('technical-plan:save-outline-selection', (_event, payload) => technicalPlanStore.saveOutlineSelection(payload));
  ipcMain.handle('technical-plan:save-outline', (_event, outlineData) => technicalPlanStore.saveOutline(outlineData));
  ipcMain.handle('technical-plan:save-global-facts-config', (_event, payload) => technicalPlanStore.saveGlobalFactsConfig(payload));
  ipcMain.handle('technical-plan:save-global-facts', (_event, globalFacts) => technicalPlanStore.saveGlobalFacts(globalFacts));
  ipcMain.handle('technical-plan:save-content-generation-options', (_event, options) => technicalPlanStore.saveContentGenerationOptions(options));
  ipcMain.handle('technical-plan:save-chapter-content', (_event, payload) => technicalPlanStore.saveChapterContent(payload));
  // 合规章节（响应函/资格声明/业绩表/财务表）必须能读到文档知识库里的真实企业材料，
  // 否则只能靠模型编造，因此这里与正文生成一样传入 knowledgeBaseService。
  // 同时逐章节回传进度并提供取消：这是一串串行 AI 请求，没有进度事件时界面就是「无响应」。
  ipcMain.handle('technical-plan:run-template-fill', async (event) => {
    const sendProgress = (progress) => {
      if (event?.sender?.isDestroyed?.()) return;
      event?.sender?.send?.('technical-plan:template-fill-progress', progress);
    };
    return runTemplateFillTask({
      aiService,
      workspaceStore: technicalPlanStore,
      knowledgeBaseService,
      onProgress: sendProgress,
    });
  });
  ipcMain.handle('technical-plan:cancel-template-fill', () => cancelTemplateFill());
  ipcMain.handle('technical-plan:clear', () => taskService.resetTechnicalPlan());
  ipcMain.handle('technical-plan:open-bid-template', async () => {
    const filePath = technicalPlanStore.getBidTemplatePath?.();
    if (!filePath || !technicalPlanStore.hasBidTemplate?.()) {
      return { success: false, message: '还没有投标模版，请先确认一级目录' };
    }
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      return { success: false, message: errorMessage };
    }
    return { success: true };
  });
}

module.exports = {
  registerTechnicalPlanIpc,
};
