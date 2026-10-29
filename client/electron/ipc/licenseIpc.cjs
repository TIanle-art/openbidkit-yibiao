const { ipcMain } = require('electron');

function registerLicenseIpc({ licenseService }) {
  ipcMain.handle('license:get-status', () => licenseService.getStatus());
  ipcMain.handle('license:refresh', () => licenseService.refresh());
  ipcMain.handle('license:import-offline-file', () => licenseService.importOfflineFile());
  ipcMain.handle('license:activate-offline-code', (_event, code) => licenseService.activateOfflineCode(code));
  ipcMain.handle('license:get-privacy-notice', () => licenseService.getPrivacyNotice());
  ipcMain.handle('license:get-consent', () => ({ consent: licenseService.getConsent() }));
  ipcMain.handle('license:set-consent', (_event, consent) => licenseService.setConsent(consent));
}

module.exports = {
  registerLicenseIpc,
};
