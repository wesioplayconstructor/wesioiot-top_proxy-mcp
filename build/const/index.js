// Constants for the wesioiot MCP server
export const DEFAULT_API_HOST = 'https://api.wesioiot.top';
export const DEFAULT_SERVER_PORT = 3000;
export const DEFAULT_SERVER_ENDPOINT = '/mcp';
export const DEFAULT_TRANSPORT_MODE = 'stdio';
export const TRANSPORT_MODE_STDIO = 'stdio';
export const TRANSPORT_MODE_REST = 'rest';

export const ENV_API_KEY = 'WESIOIOT_API_KEY';
export const ENV_API_HOST = 'WESIOIOT_API_HOST';
export const ENV_BASE_PATH = 'WESIOIOT_MCP_BASE_PATH';

export const ERROR_TEXT_REQUIRED = 'O parâmetro text é obrigatório';
export const ERROR_PROMPT_REQUIRED = 'O parâmetro prompt é obrigatório';
export const ERROR_API_KEY_MISSING = 'A variável de ambiente WESIOIOT_API_KEY é obrigatória. Configure sua chave mmx-... do proxy wesioiot.';

export const VALID_TTS_MODELS = [
  'speech-02-hd', 'speech-02-turbo',
  'speech-2.8-hd', 'speech-2.8-turbo',
  'speech-2.6-hd', 'speech-2.6-turbo',
];

export const VALID_IMAGE_MODELS = ['image-01'];
export const VALID_VIDEO_MODELS = ['MiniMax-Hailuo-2.3'];
export const VALID_MUSIC_MODELS = ['music-3.0', 'music-2.6'];
