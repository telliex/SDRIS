import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

test('GET /health/live returns status ok', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const { port } = app.getHttpServer().address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await app.close();
  }
});
