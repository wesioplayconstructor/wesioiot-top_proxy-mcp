import { WesioiotMCPError } from '../exceptions/index.js';
import { VALID_TTS_MODELS, ERROR_TEXT_REQUIRED } from '../const/index.js';
import * as path from 'path';
import { buildOutputFile, ensureDir } from '../utils/file.js';
import * as fs from 'fs';

export class TTSAPI {
  constructor(api) {
    this.api = api;
  }

  ensureValidModel(model) {
    if (!model) return 'speech-02-hd';
    return VALID_TTS_MODELS.includes(model) ? model : 'speech-02-hd';
  }

  async generateSpeech(request) {
    if (!request.text || request.text.trim() === '') {
      throw new WesioiotMCPError(ERROR_TEXT_REQUIRED);
    }

    const outputDir = request.outputDirectory || process.env.WESIOIOT_MCP_BASE_PATH || '/tmp';
    ensureDir(outputDir);

    let outputFile = request.outputFile;
    if (!outputFile) {
      const textPrefix = request.text.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
      outputFile = `tts_${textPrefix}_${Date.now()}`;
    }
    if (!path.extname(outputFile)) {
      outputFile = buildOutputFile(outputFile, outputDir, request.format || 'mp3');
    }

    const requestData = {
      model: this.ensureValidModel(request.model),
      text: request.text,
      stream: false,
      voice_setting: {
        voice_id: request.voiceId || 'Portuguese_FascinatingBoy',
        speed: request.speed || 1.0,
        vol: request.vol || 1.0,
        pitch: request.pitch || 0,
      },
    };

    // Remove undefined fields
    const filteredData = {};
    for (const [k, v] of Object.entries(requestData)) {
      if (v !== undefined) filteredData[k] = v;
    }

    const response = await this.api.post('/v1/t2a_v2', filteredData);

    const audioHex = response?.data?.audio;
    if (!audioHex) {
      throw new WesioiotMCPError(`Falha no TTS: ${JSON.stringify(response)}`);
    }

    const audioBytes = Buffer.from(audioHex, 'hex');
    fs.writeFileSync(outputFile, audioBytes);

    return {
      outputFile,
      sizeBytes: audioBytes.length,
      model: requestData.model,
      voiceId: requestData.voice_setting.voice_id,
    };
  }

  async listVoices() {
    // Proxy doesn't have /v1/voices, but we know the catalog
    return {
      voices: [
        { id: 'Portuguese_FascinatingBoy', name: 'Portuguese Fascinating Boy', language: 'pt-BR' },
        { id: 'Portuguese_SmartYoungGirl', name: 'Portuguese Smart Young Girl', language: 'pt-BR' },
        { id: 'Portuguese_ConfidentWoman', name: 'Portuguese Confident Woman', language: 'pt-BR' },
        { id: 'Portuguese_Wiselady', name: 'Portuguese Wise Lady', language: 'pt-BR' },
        { id: 'Portuguese_Deep-VoicedGentleman', name: 'Portuguese Deep-Voiced Gentleman', language: 'pt-BR' },
        { id: 'Portuguese_Jovialman', name: 'Portuguese Jovial Man', language: 'pt-BR' },
        { id: 'Portuguese_ThoughtfulMan', name: 'Portuguese Thoughtful Man', language: 'pt-BR' },
        { id: 'Portuguese_Strong-WilledBoy', name: 'Portuguese Strong-Willed Boy', language: 'pt-BR' },
      ],
    };
  }
}
