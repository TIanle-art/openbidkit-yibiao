const { ipcMain } = require('electron');
const { createFullFidelitySadingBidService } = require('../services/fullFidelitySadingBidService.cjs');
const { createFullFidelityGuaguiBidService } = require('../services/fullFidelityGuaguiBidService.cjs');

function registerFullFidelityBidIpc({ masterBidDecompositionService, fullFidelityBidAssemblyService }) {
  const sadingService = createFullFidelitySadingBidService();
  const guaguiService = createFullFidelityGuaguiBidService();

  ipcMain.handle('full-fidelity:decompose-master', async (_event, masterDocxPath) => {
    return masterBidDecompositionService.decomposeMasterDocx(masterDocxPath);
  });

  ipcMain.handle('full-fidelity:assemble-bid', async (_event, payload) => {
    return fullFidelityBidAssemblyService.assembleFullFidelityBid(payload);
  });

  ipcMain.handle('full-fidelity:assemble-sading-bid', async (_event, payload) => {
    return sadingService.generateSadingNingboBid(payload);
  });

  ipcMain.handle('full-fidelity:assemble-guagui-bid', async (_event, payload) => {
    return guaguiService.generateGuaguiBid(payload);
  });
}

module.exports = {
  registerFullFidelityBidIpc,
};
