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
      'Convert text to audio with a given voice and save to a file. Uses the wesioiot proxy.',
      {
        text: z.string().describe('Text to convert to audio'),
        voiceId: z.string().optional().describe('Voice ID (e.g. Portuguese_FascinatingBoy)'),
        model: z.string().optional().default('speech-02-hd').describe('TTS model'),
        speed: z.number().optional().default(1.0).describe('Speech speed (0.5-2.0)'),
        vol: z.number().optional().default(1.0).describe('Volume (0.1-10.0)'),
        pitch: z.number().optional().default(0).describe('Pitch (-12 to 12)'),
        outputDirectory: z.string().optional().describe('Output directory'),
      },
      async ({ text, voiceId, model, speed, vol, pitch, outputDirectory }) => {
        try {
          const result = await this.ttsApi.generateSpeech({
            text, voiceId, model, speed, vol, pitch, outputDirectory: outputDirectory || this.basePath,
          });
          return {
            content: [{ type: 'text', text: `Audio saved to: ${result.outputFile} (${result.sizeBytes} bytes)` }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    // list_voices
    this.server.tool(
      'list_voices',
      'List available PT-BR voices for TTS via wesioiot proxy.',
      {},
      async () => {
        const result = await this.ttsApi.listVoices();
        const lines = result.voices.map(v => `- ${v.id} (${v.name})`).join('\n');
        return { content: [{ type: 'text', text: `Available voices:\n${lines}` }] };
      }
    );

    // text_to_image
    this.server.tool(
      'text_to_image',
      'Generate images from text prompts via wesioiot proxy (MiniMax image-01).',
      {
        prompt: z.string().describe('Image description prompt'),
        aspectRatio: z.string().optional().default('1:1').describe('Aspect ratio (1:1, 16:9, 9:16, etc.)'),
        n: z.number().optional().default(1).describe('Number of images to generate'),
        outputDirectory: z.string().optional().describe('Output directory'),
      },
      async ({ prompt, aspectRatio, n, outputDirectory }) => {
        try {
          const result = await this.imageApi.generateImage({
            prompt, aspectRatio, n, outputDirectory: outputDirectory || this.basePath,
          });
          return {
            content: [
              { type: 'text', text: `Generated ${result.imageUrls.length} image(s):\n${result.imageUrls.join('\n')}` },
            ],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    // generate_video
    this.server.tool(
      'generate_video',
      'Generate a video from a text prompt via wesioiot proxy (MiniMax Hailuo 2.3, async). Use query_video_generation to check status.',
      {
        prompt: z.string().describe('Video description prompt'),
        outputDirectory: z.string().optional().describe('Output directory'),
      },
      async ({ prompt, outputDirectory }) => {
        try {
          const result = await this.videoApi.generateVideo({
            prompt, outputDirectory: outputDirectory || this.basePath,
          });
          return {
            content: [{
              type: 'text',
              text: `Video job submitted. Task ID: ${result.taskId}\nPoll with query_video_generation using this task_id.`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    // query_video_generation
    this.server.tool(
      'query_video_generation',
      'Poll the status of a video generation task.',
      {
        taskId: z.string().describe('The task ID returned by generate_video'),
      },
      async ({ taskId }) => {
        try {
          const result = await this.videoApi.queryVideo(taskId);
          return {
            content: [{
              type: 'text',
              text: `Task: ${result.taskId}\nStatus: ${result.status}\n${result.videoUrl ? `Video URL: ${result.videoUrl}` : result.message || ''}`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    // music_generation
    this.server.tool(
      'music_generation',
      'Generate music from prompt and/or lyrics via wesioiot proxy (MiniMax music-2.6, async).',
      {
        lyrics: z.string().describe('Song lyrics (required by proxy)'),
        prompt: z.string().optional().describe('Musical description prompt'),
        title: z.string().optional().describe('Song title'),
        style: z.string().optional().describe('Musical style'),
        outputDirectory: z.string().optional().describe('Output directory'),
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
                text: `Music generated and saved to: ${result.outputFile} (${result.sizeBytes} bytes)`,
              }],
            };
          }
          return {
            content: [{
              type: 'text',
              text: `Music job submitted. Task ID: ${result.taskId}\nPoll with query_music_generation using this task_id.`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
      }
    );

    // query_music_generation
    this.server.tool(
      'query_music_generation',
      'Poll the status of a music generation task.',
      {
        taskId: z.string().describe('The task ID returned by music_generation'),
      },
      async ({ taskId }) => {
        try {
          const result = await this.musicApi.queryMusic(taskId);
          return {
            content: [{
              type: 'text',
              text: `Task: ${result.taskId}\nStatus: ${result.status}\n${result.musicUrl ? `Music URL: ${result.musicUrl}` : result.message || ''}`,
            }],
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
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
