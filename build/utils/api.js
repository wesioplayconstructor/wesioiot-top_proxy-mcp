import axios from 'axios';

export class ApiClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  _headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async post(endpoint, data, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await axios.post(url, data, {
      headers: this._headers(),
      timeout: options.timeout || 120000,
      responseType: options.responseType || 'json',
      ...options.axiosOptions,
    });
    return response.data;
  }

  async get(endpoint, params, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await axios.get(url, {
      headers: this._headers(),
      params,
      timeout: options.timeout || 120000,
      responseType: options.responseType || 'json',
      ...options.axiosOptions,
    });
    return response.data;
  }

  async delete(endpoint) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await axios.delete(url, {
      headers: this._headers(),
    });
    return response.data;
  }
}
