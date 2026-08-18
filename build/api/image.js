import { WesioiotMCPError } from '../exceptions/index.js';
import { ERROR_PROMPT_REQUIRED } from '../const/index.js';
import { ensureDir } from '../utils/file.js';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

export class ImageAPI {
  constructor(api) {
    this.api = api;
  }

  async generateImage(request) {
    if (!request.prompt || request.prompt.trim() === '') {
      throw new WesioiotMCPError(ERROR_PROMPT_REQUIRED);
    }

    const outputDir = request.outputDirectory || '/tmp';
    ensureDir(outputDir);

    const requestData = {
      model: 'image-01',
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio || '1:1',
      n: request.n || 1,
    };

    const filteredData = {};
    for (const [k, v] of Object.entries(requestData)) {
      if (v !== undefined) filteredData[k] = v;
    }

    // Proxy uses /v1/images/generations
    const response = await this.api.post('/v1/images/generations', filteredData);

    const imageUrls = response?.data?.image_urls || response?.image_urls || [];
    if (!imageUrls || imageUrls.length === 0) {
      throw new WesioiotMCPError(`Image gen failed: ${JSON.stringify(response)}`);
    }

    // Try to download images locally
    const outputFiles = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const ext = url.includes('.png') ? 'png' : 'jpg';
      const outFile = path.join(outputDir, `img_${Date.now()}_${i}.${ext}`);

      try {
        const imgResp = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
        });
        fs.writeFileSync(outFile, Buffer.from(imgResp.data));
        outputFiles.push(outFile);
      } catch {
        // Could not download — return URL only
        outputFiles.push(url);
      }
    }

    return {
      imageUrls,
      outputFiles,
      model: 'image-01',
      prompt: request.prompt,
    };
  }
}
