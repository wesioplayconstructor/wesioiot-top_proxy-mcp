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
    ensureDir(outputDir);

    const requestData = { model: 'music-2.6' };
    if (request.prompt) requestData.prompt = request.prompt;
    if (request.lyrics) requestData.lyrics = request.lyrics;
    if (request.title) requestData.title = request.title;
    if (request.style) requestData.style = request.style;

    const filteredData = {};
    for (const [k, v] of Object.entries(requestData)) {
      if (v !== undefined) filteredData[k] = v;
    }

    const response = await this.api.post('/v1/music_generation', filteredData);

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
        model: 'music-2.6',
        mode: 'sync',
      };
    }

    if (taskId) {
      // Async mode — return task_id for polling
      return {
        taskId,
        status: 'processing',
        model: 'music-2.6',
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
