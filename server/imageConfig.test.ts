import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';

test('image configuration routes each resolution to its own upstream model', () => {
  const rows = db.getAiConfigs();
  const snapshot = rows.slice();
  rows.splice(0, rows.length,
    { id: 'test-2k', provider: 'custom', name: '高清', displayName: '高清', baseUrl: 'https://two.example/v1', apiKey: 'key-2', modelName: 'model-2k', resolution: '2K', resolutionSupport: ['2K'], enabled: true, isDefault: false, createdAt: 1, updatedAt: 1 },
    { id: 'test-4k', provider: 'custom', name: '超清', displayName: '超清', baseUrl: 'https://four.example/v1', apiKey: 'key-4', modelName: 'model-4k', resolution: '4K', resolutionSupport: ['4K'], enabled: true, isDefault: true, createdAt: 1, updatedAt: 1 },
  );
  try {
    assert.equal(db.resolveImageConfig('2K').modelName, 'model-2k');
    assert.equal(db.resolveImageConfig('4K').modelName, 'model-4k');
    assert.deepEqual(db.getImageDisplayModels().map(item => item.name), ['高清', '超清']);
  } finally {
    rows.splice(0, rows.length, ...snapshot);
  }
});

test('a missing tier never falls back to another resolution row', () => {
  const rows = db.getAiConfigs();
  const snapshot = rows.slice();
  rows.splice(0, rows.length, {
    id: 'only-4k', provider: 'custom', name: '超清', displayName: '超清', baseUrl: 'https://four.example/v1', apiKey: 'key-4', modelName: 'model-4k', resolution: '4K', resolutionSupport: ['4K'], enabled: true, isDefault: true, createdAt: 1, updatedAt: 1
  });
  try {
    assert.equal(db.resolveImageConfig('4K').modelName, 'model-4k');
  } finally {
    rows.splice(0, rows.length, ...snapshot);
  }
});
