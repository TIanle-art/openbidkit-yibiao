const test = require('node:test');
const assert = require('node:assert/strict');
const { isVisionUnsupportedError, toVisionFallbackError, VISION_UNSUPPORTED_MESSAGE } = require('./visionFallback.cjs');

function httpError(status, body) {
  const error = new Error(`HTTP ${status} ${body}`);
  error.status = status;
  error.aiHttpResponse = body;
  return error;
}

test('文本模型返回 400 且声明不支持图片时被识别', () => {
  assert.equal(isVisionUnsupportedError(httpError(400, '{"error":{"message":"this model does not support image input"}}')), true);
});

test('415 内容类型被拒时被识别', () => {
  assert.equal(isVisionUnsupportedError(httpError(415, 'content type image/jpeg is not supported')), true);
});

test('中文「不支持图片」报错被识别', () => {
  assert.equal(isVisionUnsupportedError(httpError(400, '当前接口不支持图片输入')), true);
});

test('服务端 5xx 不归因为模型不支持', () => {
  assert.equal(isVisionUnsupportedError(httpError(503, 'image gateway not supported right now')), false);
});

test('无关错误不被误判', () => {
  assert.equal(isVisionUnsupportedError(new Error('请求超时')), false);
  assert.equal(isVisionUnsupportedError(null), false);
});

test('命中时替换为可行动提示并保留原始信息', () => {
  const original = httpError(400, 'this model does not support image input');
  const mapped = toVisionFallbackError(original, { filePath: 'C:/kb/a.png', modelName: 'gemini-3.8-flash' });
  assert.equal(mapped.message, VISION_UNSUPPORTED_MESSAGE);
  assert.equal(mapped.code, 'VISION_INPUT_UNSUPPORTED');
  assert.equal(mapped.cause, original);
  assert.equal(mapped.detail.model, 'gemini-3.8-flash');
  assert.match(mapped.detail.original_message, /does not support image/);
  assert.match(mapped.message, /视觉模型|MinerU/);
});

test('未命中时原样抛出', () => {
  const original = new Error('请求超时');
  assert.equal(toVisionFallbackError(original, {}), original);
});
