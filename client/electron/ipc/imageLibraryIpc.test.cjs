const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('Main 注册 image-library:describe-images 并转发到图片库服务', async () => {
  const handlers = new Map();
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return {
        dialog: {},
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let registerImageLibraryIpc;
  try {
    delete require.cache[require.resolve('./imageLibraryIpc.cjs')];
    ({ registerImageLibraryIpc } = require('./imageLibraryIpc.cjs'));
  } finally {
    Module._load = originalLoad;
  }

  const calls = [];
  const service = new Proxy({}, {
    get: (_target, property) => (...args) => {
      calls.push([property, args]);
      if (property === 'describeImages') return { success: true, successCount: 0, failedCount: 0, images: [] };
      return [];
    },
  });
  registerImageLibraryIpc({ imageLibraryService: service });

  const handler = handlers.get('image-library:describe-images');
  assert.equal(typeof handler, 'function');
  const result = await handler({}, []);
  assert.deepEqual(result, { success: true, successCount: 0, failedCount: 0, images: [] });
  assert.deepEqual(calls.at(-1), ['describeImages', [[]]]);
});
