/**
 * 图片输入降级提示（AC9）
 *
 * 文本模型/接口收到 image_url 内容块时，各家返回的报错五花八门（400 里夹一句
 * "does not support image"、"content type image is not supported"，或直接 415/422）。
 * 原样抛给用户的后果是：用户只看到 HTTP 400，不知道要换视觉模型还是换解析方式。
 * 这里把这类错误统一翻译成一句可行动的提示。
 */

const VISION_UNSUPPORTED_STATUS = new Set([400, 404, 415, 422, 501]);

const VISION_UNSUPPORTED_TEXT_PATTERNS = [
  /不支持图片/,
  /不支持图像/,
  /不支持视觉/,
  /不支持多模态/,
  /not\s+support(?:ed)?[^。.\n]{0,40}(?:image|vision|multimodal)/i,
  /(?:image|vision|multimodal)[^。.\n]{0,40}not\s+support(?:ed)?/i,
  /image[^。.\n]{0,20}unsupported/i,
  /invalid\s+(?:content\s+type|value)[^。.\n]{0,20}image/i,
  /content\s+type[^。.\n]{0,20}image[^。.\n]{0,20}(?:invalid|unsupported|not\s+allowed)/i,
  /text[- ]only\s+model/i,
];

const VISION_UNSUPPORTED_MESSAGE = '当前文本模型或接口不支持图片输入。请改用支持图片输入的视觉模型，或在「设置 → 文件解析」改用 MinerU / 本地解析后再导入图片。';

function collectErrorText(error) {
  const parts = [
    error?.message,
    error?.aiHttpResponse,
    error?.responseBody,
    error?.body,
    error?.details,
    error?.cause?.message,
  ];
  return parts
    .map((item) => (item && typeof item === 'object' ? JSON.stringify(item) : String(item || '')))
    .filter(Boolean)
    .join('\n');
}

function collectErrorStatus(error) {
  const candidates = [error?.status, error?.statusCode, error?.httpStatus, error?.code, error?.cause?.status, error?.cause?.statusCode];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 100 && numeric <= 599) return numeric;
  }
  return 0;
}

/**
 * 判断一次图片语义标注失败是否属于「模型/接口不支持图片输入」。
 */
function isVisionUnsupportedError(error) {
  if (!error) return false;
  const status = collectErrorStatus(error);
  const text = collectErrorText(error);
  if (!text.trim()) return false;
  const matchedByText = VISION_UNSUPPORTED_TEXT_PATTERNS.some((pattern) => pattern.test(text));
  if (!matchedByText) return false;
  // 有状态码时只认客户端侧的拒绝码；5xx 更可能是服务端故障，不该引导用户换模型。
  return status === 0 || VISION_UNSUPPORTED_STATUS.has(status);
}

/**
 * 命中即替换为可行动提示，否则原样抛出。
 */
function toVisionFallbackError(error, context = {}) {
  if (!isVisionUnsupportedError(error)) return error;
  const mapped = new Error(VISION_UNSUPPORTED_MESSAGE);
  mapped.code = 'VISION_INPUT_UNSUPPORTED';
  mapped.cause = error;
  mapped.detail = {
    file: context.filePath ? String(context.filePath) : '',
    model: context.modelName ? String(context.modelName) : '',
    original_message: String(error?.message || ''),
  };
  return mapped;
}

module.exports = {
  VISION_UNSUPPORTED_MESSAGE,
  isVisionUnsupportedError,
  toVisionFallbackError,
};
