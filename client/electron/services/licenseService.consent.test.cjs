'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLicenseService } = require('./licenseService.cjs');

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-license-consent-'));
  return {
    dir,
    app: {
      isPackaged: true,
      getVersion: () => '9.9.9-test',
      getPath: () => dir,
    },
  };
}

function makeConfigStore(initialConsent) {
  let cfg = {
    analytics_client_id: 'test-client-id',
    analytics_created_at: '2026-01-01',
    telemetry_consent: initialConsent,
  };
  return {
    load: () => ({ ...cfg }),
    save: (next) => { cfg = { ...cfg, ...next }; },
    get consent() { return cfg.telemetry_consent; },
  };
}

function makeFetch() {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, body: options && options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => ({ code: 0, license: null }) };
  };
  fn.calls = calls;
  return fn;
}

test('未授权（denied）时启动刷新不发任何网络请求，也不产生设备指纹上传', async () => {
  const { app, dir } = makeApp();
  const configStore = makeConfigStore('denied');
  const fetchImpl = makeFetch();
  const service = createLicenseService({ app, configStore, fetchImpl, dialogImpl: { showMessageBox: async () => ({ response: 0 }) } });
  const status = await service.refreshOnStartup();
  assert.equal(fetchImpl.calls.length, 0, 'denied 状态不得发起授权请求');
  assert.equal(status.telemetryConsent, 'denied');
  assert.equal(status.networkConsentRequired, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('首次未表态（unset）+ 用户选仅离线：不联网，并记为 denied', async () => {
  const { app, dir } = makeApp();
  const configStore = makeConfigStore('unset');
  const fetchImpl = makeFetch();
  const service = createLicenseService({ app, configStore, fetchImpl, dialogImpl: { showMessageBox: async () => ({ response: 1 }) } });
  const status = await service.refreshOnStartup();
  assert.equal(fetchImpl.calls.length, 0, '用户选择离线时不得发起授权请求');
  assert.equal(configStore.consent, 'denied');
  assert.equal(status.telemetryConsent, 'denied');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('首次未表态 + 用户允许联网：先记 granted，再发一次授权请求且只上传指纹哈希', async () => {
  const { app, dir } = makeApp();
  const configStore = makeConfigStore('unset');
  const fetchImpl = makeFetch();
  const service = createLicenseService({ app, configStore, fetchImpl, dialogImpl: { showMessageBox: async () => ({ response: 0 }) } });
  await service.refreshOnStartup();
  assert.equal(configStore.consent, 'granted');
  assert.equal(fetchImpl.calls.length, 1, '授权后只应发一次授权请求');
  const body = fetchImpl.calls[0].body;
  assert.match(body.machineFingerprintHash, /^[a-f0-9]{64}$/, '只上传 64 位十六进制哈希');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('已授权后关闭联网开关：后续刷新不再发请求（可随时关闭）', async () => {
  const { app, dir } = makeApp();
  const configStore = makeConfigStore('granted');
  const fetchImpl = makeFetch();
  const service = createLicenseService({ app, configStore, fetchImpl, dialogImpl: { showMessageBox: async () => ({ response: 0 }) } });
  await service.refresh();
  const afterGrant = fetchImpl.calls.length;
  assert.equal(afterGrant, 1, '授权状态应发一次请求');
  service.setConsent('denied');
  await service.refresh();
  assert.equal(fetchImpl.calls.length, afterGrant, '关闭后不得再发请求');
  assert.equal(configStore.consent, 'denied');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('getPrivacyNotice 返回告知内容并带上当前授权状态', async () => {
  const { app, dir } = makeApp();
  const configStore = makeConfigStore('unset');
  const service = createLicenseService({ app, configStore, fetchImpl: makeFetch(), dialogImpl: { showMessageBox: async () => ({ response: 1 }) } });
  const notice = service.getPrivacyNotice();
  assert.equal(notice.consent, 'unset');
  assert.ok(Array.isArray(notice.fields) && notice.fields.length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
