export class WesioiotMCPError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WesioiotMCPError';
  }
}
