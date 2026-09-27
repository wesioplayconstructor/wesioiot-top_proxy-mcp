import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MusicAPI } from '../build/api/music.js';
import { VALID_MUSIC_MODELS } from '../build/const/index.js';

function responseWithAudio(hex = '49443304') {
  return { data: { audio: hex, status: 2 }, base_resp: { status_code: 0 } };
}

test('allowlist do MCP aceita Music 3.0 e mantém Music 2.6 legado', () => {
  assert.deepEqual(VALID_MUSIC_MODELS, ['music-3.0', 'music-2.6']);
});

test('MCP envia music-3.0 quando o chamador escolhe o modelo e salva o áudio síncrono', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wesioiot-music-'));
  let received;
  try {
    const api = { post: async (endpoint, payload) => { received = { endpoint, payload }; return responseWithAudio(); } };
    const result = await new MusicAPI(api).generateMusic({
      model: 'music-3.0',
      prompt: 'Brazilian pop rock',
      lyrics: '[Verse]\nTeste da música',
      outputDirectory: tempDir,
    });

    assert.equal(received.endpoint, '/v1/music_generation');
    assert.equal(received.payload.model, 'music-3.0');
    assert.deepEqual(received.payload.audio_setting, { sample_rate: 44100, bitrate: 256000, format: 'mp3' });
    assert.equal('title' in received.payload, false);
    assert.equal('style' in received.payload, false);
    assert.equal('outputDirectory' in received.payload, false);
    assert.equal(result.mode, 'sync');
    assert.equal(result.sizeBytes, 4);
    assert.equal(fs.readFileSync(result.outputFile).toString('hex'), '49443304');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('MCP usa music-3.0 como padrão quando o modelo não foi especificado', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wesioiot-music-'));
  let payload;
  try {
    const api = { post: async (_endpoint, body) => { payload = body; return responseWithAudio(); } };
    await new MusicAPI(api).generateMusic({ lyrics: '[Verse]\nTeste', outputDirectory: tempDir });
    assert.equal(payload.model, 'music-3.0');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('MCP exibe o diagnóstico do Proxy para HTTP 410 e não repete a geração', async () => {
  let calls = 0;
  const api = { post: async () => {
    calls += 1;
    throw Object.assign(new Error('Request failed with status code 410'), {
      response: {
        status: 410,
        data: {
          error: 'music_api_unavailable',
          message: 'MiniMax encerrou o acesso Music API para novas contas; valide o entitlement.',
          upstream_status: 410,
        },
      },
    });
  } };
  await assert.rejects(
    () => new MusicAPI(api).generateMusic({ lyrics: '[Verse]\\nTeste' }),
    (err) => {
      assert.match(err.message, /encerrou o acesso Music API.*entitlement/i);
      assert.match(err.message, /não houve task_id nem áudio/i);
      assert.match(err.message, /PARE o processo/i);
      return true;
    }
  );
  assert.equal(calls, 1);
});
