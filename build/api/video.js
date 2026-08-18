import { WesioiotMCPError } from '../exceptions/index.js';
import { ERROR_PROMPT_REQUIRED } from '../const/index.js';
import { ensureDir } from '../utils/file.js';
import * as path from 'path';
import * as fs from 'fs';

export class VideoAPI {
  constructor(api) {
    this.api = api;
  }

  async generateVideo(request) {
    if (!request.prompt || request.prompt.trim() === '') {
      throw new WesioiotMCPError(ERROR_PROMPT_REQUIRED);
    }

    const outputDir = request.outputDirectory || process.env.WESIOIOT_MCP_BASE_PATH || '/tmp';
    ensureDir(outputDir);

    const requestData = {
      model: 'MiniMax-Hailuo-2.3',
      prompt: request.prompt,
    };

    const filteredData = {};
    for (const [k, v] of Object.entries(requestData)) {
      if (v !== undefined) filteredData[k] = v;
    }

    // Async — submit and get task_id
    const response = await this.api.post('/v1/video_generation', filteredData);

    const taskId = response?.data?.task_id || response?.task_id;
    if (!taskId) {
      throw new WesioiotMCPError(`Falha ao enviar job de vídeo: ${JSON.stringify(response)}`);
    }

    return {
      taskId,
      status: 'processing',
      model: 'MiniMax-Hailuo-2.3',
      prompt: request.prompt,
      message: 'Video is being generated. Poll with query_video_generation using the task_id.',
    };
  }

  async queryVideo(taskId) {
    if (!taskId) {
      throw new WesioiotMCPError('O parâmetro task_id é obrigatório');
    }

    const response = await this.api.get('/v1/query/video_generation', { task_id: taskId });

    const status = response?.data?.status || response?.status;
    const videoUrl = response?.data?.video_url || response?.video_url;

    if (status === 'success' && videoUrl) {
      return {
        taskId,
        status: 'success',
        videoUrl,
        message: 'Video generation complete.',
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
