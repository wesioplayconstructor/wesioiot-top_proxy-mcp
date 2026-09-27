import { WesioiotMCPError } from '../exceptions/index.js';
import { ensureDir, buildOutputFile } from '../utils/file.js';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export class MusicAPI {
  constructor(api) {
    this.api = api;
  }

  async generateMusic(request) {
    const outputDir = request.outputDirectory || '/tmp';
    const model = request.model || 'music-3.0';
    ensureDir(outputDir);

    const requestData = {
      model,
      audio_setting: request.audioSetting || { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
    };
    if (request.prompt) requestData.prompt = request.prompt;
    if (request.lyrics) requestData.lyrics = request.lyrics;
    if (request.lyricsOptimizer === true) requestData.lyrics_optimizer = true;
    if (request.isInstrumental === true) requestData.is_instrumental = true;

    const filteredData = {};
    for (const [k, v] of Object.entries(requestData)) {
      if (v !== undefined) filteredData[k] = v;
    }

    let response;
    try {
      response = await this.api.post('/v1/music_generation', filteredData);
    } catch (error) {
      const status = Number(error?.response?.status) || null;
      const data = error?.response?.data;
      const message = typeof data?.message === 'string'
        ? data.message
        : (typeof data?.base_resp?.status_msg === 'string' ? data.base_resp.status_msg : error.message);
      const statusLabel = status ? ` (HTTP ${status})` : '';
      let errorMsg = `Falha na geração de música${statusLabel}: ${message}`;
      if (status === 410) {
        errorMsg += `\n\nATENÇÃO (Instrução ao Agente): A geração falhou definitivamente. Não houve task_id nem áudio criado; o diretório de saída (${outputDir}) é apenas local e não pode ser lido. PARE o processo. NÃO faça retry automático.`;
      }
      
      throw new WesioiotMCPError(errorMsg);
    }

    // Music can return sync (direct audio) or async (task_id)
    const audioHex = response?.data?.audio;
    const taskId = response?.data?.task_id;

    if (audioHex) {
      // Sync mode — save audio directly
      const audioBytes = Buffer.from(audioHex, 'hex');
      const outFile = buildOutputFile(`music_${Date.now()}`, outputDir, 'mp3');
      fs.writeFileSync(outFile, audioBytes);
      return {
        outputFile: outFile,
        sizeBytes: audioBytes.length,
        model,
        mode: 'sync',
      };
    }

    if (taskId) {
      // Async mode — return task_id for polling
      return {
        taskId,
        status: 'processing',
        model,
        mode: 'async',
        message: 'Music is being generated. Poll with query_music_generation using the task_id.',
      };
    }

    throw new WesioiotMCPError(`Falha na geração de música: ${JSON.stringify(response)}`);
  }

  async queryMusic(taskId) {
    if (!taskId) {
      throw new WesioiotMCPError('O parâmetro task_id é obrigatório');
    }

    const response = await this.api.get('/v1/query/music_generation', { task_id: taskId });

    const status = response?.data?.status || response?.status;
    const musicUrl = response?.data?.music_url || response?.music_url;

    if (status === 'success' && musicUrl) {
      return {
        taskId,
        status: 'success',
        musicUrl,
        message: 'Music generation complete.',
      };
    }

    return {
      taskId,
      status: status || 'processing',
      progress: response?.data?.progress || null,
      message: response?.data?.desc || 'Still processing...',
    };
  }
}
