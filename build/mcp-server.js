import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiClient } from './utils/api.js';
import { TTSAPI } from './api/tts.js';
import { ImageAPI } from './api/image.js';
import { VideoAPI } from './api/video.js';
import { MusicAPI } from './api/music.js';
import {
  ENV_API_KEY, ENV_API_HOST, ENV_BASE_PATH,
  ERROR_API_KEY_MISSING,
  DEFAULT_API_HOST,
} from './const/index.js';

export class WesioiotMCPServer {
  constructor() {
    const apiKey = process.env[ENV_API_KEY];
    if (!apiKey) {
      throw new Error(ERROR_API_KEY_MISSING);
    }

    const apiHost = process.env[ENV_API_HOST] || DEFAULT_API_HOST;
    this.basePath = process.env[ENV_BASE_PATH] || '/tmp';

    this.api = new ApiClient(apiHost, apiKey);
    this.ttsApi = new TTSAPI(this.api);
    this.imageApi = new ImageAPI(this.api);
    this.videoApi = new VideoAPI(this.api);
    this.musicApi = new MusicAPI(this.api);

    this.server = new McpServer(
      { name: 'wesioiot-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    this._registerTools();
  }

  _registerTools() {
    // text_to_audio
    this.server.tool(
      'text_to_audio',
      'Sintetiza áudio a partir de texto usando o proxy wesioiot. Retorna um arquivo .mp3 salvo em disco. Use voz PT-BR (Portuguese_FascinatingBoy, Portuguese_SmartYoungGirl, etc.). Custo aproximado: $0.10/1k chars.',
      {
        text: z.string().describe('Texto a converter em áudio'),
        voiceId: z.string().optional().describe('ID da voz (ex: Portuguese_FascinatingBoy, Portuguese_SmartYoungGirl)'),
        model: z.string().optional().default('speech-02-hd').describe('Modelo TTS (speech-02-hd, speech-02-turbo, speech-2.6-hd, speech-2.8-turbo)'),
        speed: z.number().optional().default(1.0).describe('Velocidade da fala (0.5 a 2.0)'),
        vol: z.number().optional().default(1.0).describe('Volume (0.1 a 10.0)'),
        pitch: z.number().optional().default(0).describe('Tom (-12 a 12)'),
        outputDirectory: z.string().optional().describe('Diretório de saída do arquivo'),
      },
      async ({ text, voiceId, model, speed, vol, pitch, outputDirectory }) => {
        try {
          const result = await this.ttsApi.generateSpeech({
            text, voiceId, model, speed, vol, pitch, outputDirectory: outputDirectory || this.basePath,
          });
          return {
            content: [{ type: 'text', text: `Áudio salvo em: ${result.outputFile} (${result.sizeBytes} bytes)` }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Erro: ${err.message}` }], isError: true };
        }
      }
    );

    // list_voices
    this.server.tool(
      'list_voices',
      'Lista as 8 vozes PT-BR disponíveis para TTS no proxy wesioiot.',
      {},
      async () => {
        const result = await this.ttsApi.listVoices();
        const lines = result.voices.map(v => `- ${v.id} (${v.name})`).join('\n');
        return { content: [{ type: 'text', text: `Vozes disponíveis:\n${lines}` }] };
      }
    );

    // text_to_image
    this.server.tool(
      'text_to_image',
      'Gera imagens a partir de prompt de texto usando o proxy wesioiot (MiniMax image-01). Retorna URLs das imagens. Custo aproximado: $0.02/imagem.',
      {
        prompt: z.string().describe('Descrição da imagem em inglês ou português'),
        aspectRatio: z.string().optional().default('1:1').describe('Proporção (1:1, 16:9, 9:16, 4:3, etc.)'),
        n: z.number().optional().default(1).describe('Quantidade de imagens (1-4)'),
        outputDirectory: z.string().optional().describe('Diretório para salvar a imagem'),
      },
      async ({ prompt, aspectRatio, n, outputDirectory }) => {
        try {
          const result = await this.imageApi.generateImage({
            prompt, aspectRatio, n, outputDirectory: outputDirectory || this.basePath,
          });
          return {
            content: [
              { type: 'text', text: `${result.imageUrls.length} imagem(ns) gerada(s):\n${result.imageUrls.join('\n')}` },
            ],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Erro: ${err.message}` }], isError: true };
        }
      }
    );

    // generate_video
    this.server.tool(
      'generate_video',
      'Gera vídeo a partir de prompt de texto usando o proxy wesioiot (MiniMax Hailuo 2.3, assíncrono). Retorna um task_id. Use query_video_generation para checar o status. Custo aproximado: $0.20-0.50/vídeo.',
      {
        prompt: z.string().describe('Descrição do vídeo'),
        outputDirectory: z.string().optional().describe('Diretório de saída'),
      },
      async ({ prompt, outputDirectory }) => {
        try {
          const result = await this.videoApi.generateVideo({
            prompt, outputDirectory: outputDirectory || this.basePath,
          });
          return {
            content: [{
              type: 'text',
              text: `Job de vídeo enviado. Task ID: ${result.taskId}\nUse query_video_generation com este task_id para checar o progresso.`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Erro: ${err.message}` }], isError: true };
        }
      }
    );

    // query_video_generation
    this.server.tool(
      'query_video_generation',
      'Consulta o status de um job de vídeo. Retorna a URL do vídeo quando concluído.',
      {
        taskId: z.string().describe('Task ID retornado por generate_video'),
      },
      async ({ taskId }) => {
        try {
          const result = await this.videoApi.queryVideo(taskId);
          return {
            content: [{
              type: 'text',
              text: `Task: ${result.taskId}\nStatus: ${result.status}\n${result.videoUrl ? `URL do vídeo: ${result.videoUrl}` : result.message || 'Processando...'}`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Erro: ${err.message}` }], isError: true };
        }
      }
    );

    // music_generation
    this.server.tool(
      'music_generation',
      'Gera música a partir de letra e prompt de estilo usando o proxy wesioiot (MiniMax music-2.6). Pode retornar áudio direto (sync) ou task_id (async). Custo aproximado: $0.10/música.',
      {
        lyrics: z.string().describe('Letra da música (obrigatório)'),
        prompt: z.string().optional().describe('Descrição do estilo musical'),
        title: z.string().optional().describe('Título da música'),
        style: z.string().optional().describe('Estilo musical (gênero, energia)'),
        outputDirectory: z.string().optional().describe('Diretório de saída'),
      },
      async ({ prompt, lyrics, title, style, outputDirectory }) => {
        try {
          const result = await this.musicApi.generateMusic({
            prompt, lyrics, title, style, outputDirectory: outputDirectory || this.basePath,
          });
          if (result.mode === 'sync') {
            return {
              content: [{
                type: 'text',
                text: `Música gerada e salva em: ${result.outputFile} (${result.sizeBytes} bytes)`,
              }],
            };
          }
          return {
            content: [{
              type: 'text',
              text: `Job de música enviado. Task ID: ${result.taskId}\nUse query_music_generation com este task_id para checar o progresso.`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Erro: ${err.message}` }], isError: true };
        }
      }
    );

    // query_music_generation
    this.server.tool(
      'query_music_generation',
      'Consulta o status de um job de música. Retorna a URL do áudio quando concluído.',
      {
        taskId: z.string().describe('Task ID retornado por music_generation'),
      },
      async ({ taskId }) => {
        try {
          const result = await this.musicApi.queryMusic(taskId);
          return {
            content: [{
              type: 'text',
              text: `Task: ${result.taskId}\nStatus: ${result.status}\n${result.musicUrl ? `URL da música: ${result.musicUrl}` : result.message || 'Processando...'}`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Erro: ${err.message}` }], isError: true };
        }
      }
    );
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // Keep alive — stdin stays open for Hermes
  }
}
