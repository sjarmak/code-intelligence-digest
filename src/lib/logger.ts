/**
 * Structured logging utility
 */

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${msg}`, meta ? JSON.stringify(meta) : "");
    }
  },

  info: (msg: string, meta?: Record<string, unknown>) => {
    console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : "");
  },

  warn: (msg: string, meta?: Record<string, unknown>) => {
    console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : "");
  },

  error: (msg: string, error?: unknown) => {
    console.error(`[ERROR] ${msg}`, error);
  },
};
