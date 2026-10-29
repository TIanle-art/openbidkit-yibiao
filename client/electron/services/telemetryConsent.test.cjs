'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  TELEMETRY_CONSENT_KEY,
  normalizeConsent,
  isNetworkAllowed,
  buildPrivacyNotice,
  buildConsentPromptText,
} = require('./telemetryConsent.cjs');

test('telemetry_consent 键名稳定，避免配置迁移时丢值', () => {
  assert.equal(TELEMETRY_CONSENT_KEY, 'telemetry_consent');
});

test('normalizeConsent 只接受已知值，其余一律按 unset', () => {
  assert.equal(normalizeConsent('granted'), 'granted');
  assert.equal(normalizeConsent('DENIED'), 'denied');
  assert.equal(normalizeConsent('unset'), 'unset');
  assert.equal(normalizeConsent(''), 'unset');
  assert.equal(normalizeConsent(undefined), 'unset');
  assert.equal(normalizeConsent('yes'), 'unset');
});

test('只有明确 granted 才允许联网，默认 unset 必须视为不允许', () => {
  assert.equal(isNetworkAllowed('granted'), true);
  assert.equal(isNetworkAllowed('unset'), false);
  assert.equal(isNetworkAllowed('denied'), false);
  assert.equal(isNetworkAllowed(undefined), false);
});

test('隐私告知必须覆盖真实上传字段，并声明不上传的内容与关闭方式', () => {
  const notice = buildPrivacyNotice();
  const names = notice.fields.map((f) => f.name).join(',');
  for (const required of ['projectName', 'appId', 'appVersion', 'clientId', 'machineFingerprintHash', 'buildAttestation']) {
    assert.ok(names.includes(required), `缺少字段说明: ${required}`);
  }
  assert.ok(notice.licenseEndpoint.includes('analytics.agnet.top'));
  assert.ok(notice.notUploaded.some((t) => t.includes('标书')));
  assert.ok(String(notice.optOut).includes('telemetry_consent=denied'));
  assert.ok(buildConsentPromptText().includes('设备指纹'));
});
