import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { attachWebSocket } from './ws-server.js';
import { eventBus } from './event-bus.js';

test('attachWebSocket removes dashboard event listeners when the server closes', async () => {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(0, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const before = eventBus.listenerCount('agent:start');
  const wss = attachWebSocket(server);

  assert.equal(eventBus.listenerCount('agent:start'), before + 1);

  await new Promise<void>((resolve, reject) => {
    wss.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  assert.equal(eventBus.listenerCount('agent:start'), before);
});

test('attachWebSocket rejects duplicate attachment while one server is active', async () => {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(0, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const wss = attachWebSocket(server);
  try {
    assert.throws(() => attachWebSocket(server), /already attached/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
