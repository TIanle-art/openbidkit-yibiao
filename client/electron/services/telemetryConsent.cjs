'use strict';

/**
 * 联网授权 / 遥测告知的单一事实来源。
 *
 * 背景：应用启动后 800ms 会调用授权刷新（license/activate），请求体里包含
 * machineFingerprintHash（设备指纹哈希）等字段。过去这一步在用户未被告知、
 * 也没有关闭开关的情况下自动发生，属于静默的设备指纹上传。
 *
 * 本模块把「是否允许联网」收敛成一个可测试的纯逻辑：
 * - 只有在用户明确授权（consent === 'granted'）时才允许发送任何含设备指纹的请求；
 * - 默认值 'unset' 一律按「不允许」处理（保守的 opt-in，而不是先传后问）；
 * - 用户可以改成 'denied' 关闭联网，只走离线授权。
 *
 * 模块本身不依赖 electron，方便单测锁定行为。
 */

const TELEMETRY_CONSENT_KEY = 'telemetry_consent';
const CONSENT_UNSET = 'unset';
const CONSENT_GRANTED = 'granted';
const CONSENT_DENIED = 'denied';
const CONSENT_VALUES = [CONSENT_UNSET, CONSENT_GRANTED, CONSENT_DENIED];

function normalizeConsent(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CONSENT_VALUES.includes(normalized) ? normalized : CONSENT_UNSET;
}

/** 只有明确授权才允许联网发送含设备指纹的请求。 */
function isNetworkAllowed(consent) {
  return normalizeConsent(consent) === CONSENT_GRANTED;
}

/**
 * 结构化隐私告知，供主进程弹窗与设置页展示。
 * 字段与真实请求体保持一致，避免「告知一套、实际传另一套」。
 */
function buildPrivacyNotice() {
  return {
    version: '2026-10',
    summary: '易标在联网验证授权时会发送设备指纹哈希等信息，用于授权激活与设备绑定；不联网也可以使用离线授权。',
    licenseEndpoint: 'https://analytics.agnet.top/license/activate',
    purpose: '在线授权激活、续期与设备绑定校验。',
    fields: [
      { name: 'projectName', description: '项目（应用）名称，固定值，用于区分产品。' },
      { name: 'appId', description: '应用包标识，固定值。' },
      { name: 'productName', description: '产品展示名，固定值。' },
      { name: 'appVersion', description: '当前应用版本号。' },
      { name: 'platform / arch', description: '操作系统平台与 CPU 架构。' },
      { name: 'clientId', description: '首次运行时生成的随机 UUID，用于区分授权对象；不是硬件序列号。' },
      { name: 'clientCreatedAt', description: 'clientId 的生成日期。' },
      { name: 'machineFingerprintHash', description: '设备指纹的 SHA-256 哈希（由系统机器码、网卡 MAC、主机名等拼接后哈希），服务端拿不到原始值。' },
      { name: 'fingerprintVersion', description: '设备指纹算法版本。' },
      { name: 'buildAttestation', description: '构建证明信息（buildId/keyId 等），用于确认程序未被篡改。' },
    ],
    notUploaded: [
      '标书 / 文档正文、文件名、文件路径',
      '原始 MachineGuid / 网卡 MAC / 主机名（只上传它们的拼接哈希）',
      '授权码明文、模型 API Key、账号密码',
    ],
    otherNetworkCalls: [
      { name: '远程公告', endpoint: 'https://analytics.agnet.top/notice', note: '仅携带项目名，用于拉取应用内公告。' },
      { name: '更新检查', endpoint: 'https://openbidkit-oss.agnet.top/release/latest.json', note: '检查新版本。' },
    ],
    optOut: '在授权设置里把「允许联网验证授权」关闭（telemetry_consent=denied），应用将不再发送含设备指纹的请求，仅可使用离线授权。',
    storage: '设备指纹哈希只随授权请求发送，不落地到本地磁盘；授权结果保存在本地 license.json。',
  };
}

/** 首次运行授权弹窗的正文（纯文本）。 */
function buildConsentPromptText() {
  return [
    '易标需要联网验证授权。联网时会上传：应用与版本信息、随机 clientId、设备指纹的 SHA-256 哈希、构建证明。',
    '不会上传：标书或文档正文、文件名、文件路径、原始机器码/MAC/主机名、授权码明文。',
    '选择「仅离线使用」将不联网，也不会发送任何设备指纹；之后可在设置中重新开启或关闭。',
  ].join('\n');
}

module.exports = {
  TELEMETRY_CONSENT_KEY,
  CONSENT_UNSET,
  CONSENT_GRANTED,
  CONSENT_DENIED,
  CONSENT_VALUES,
  normalizeConsent,
  isNetworkAllowed,
  buildPrivacyNotice,
  buildConsentPromptText,
};
