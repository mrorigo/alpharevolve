/**
 * Simple logger utility for standardized logging.
 */
export class Logger {
  static info(...args: any[]) {
    console.log('[INFO]', ...args);
  }
  static warn(...args: any[]) {
    console.warn('[WARN]', ...args);
  }
  static error(...args: any[]) {
    console.error('[ERROR]', ...args);
  }
  static debug(...args: any[]) {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.debug('[DEBUG]', ...args);
    }
  }
}