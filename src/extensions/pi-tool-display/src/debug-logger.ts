import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toRecord } from "./tool-metadata.js";

const EXTENSION_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DEBUG_CONFIG_FILE = join(EXTENSION_ROOT, "config.json");
const DEFAULT_DEBUG_DIR = join(EXTENSION_ROOT, "debug");
const DEFAULT_DEBUG_LOG_FILE = join(DEFAULT_DEBUG_DIR, "debug.log");

const DEFAULT_DEBUG_CONFIG_CACHE_TTL_MS = 1_000;

const SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{12,})\b/g;

interface ToolDisplayDebugLoggerFileSystem {
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  readFileSync: typeof readFileSync;
  statSync: typeof statSync;
  appendFile: typeof appendFile;
}

export interface ToolDisplayDebugLoggerOptions {
  configFile?: string;
  debugDir?: string;
  debugLogFile?: string;
  cacheTtlMs?: number;
  now?: () => number;
  createDate?: () => Date;
  fileSystem?: ToolDisplayDebugLoggerFileSystem;
}

export interface ToolDisplayDebugLogger {
  log(message: string, error?: unknown): void;
  flush(): Promise<void>;
}

const DEFAULT_FILE_SYSTEM: ToolDisplayDebugLoggerFileSystem = {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  appendFile,
};

function redactMessage(value: string): string {
  return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}

export function createToolDisplayDebugLogger(options: ToolDisplayDebugLoggerOptions = {}): ToolDisplayDebugLogger {
  const configFile = options.configFile ?? DEFAULT_DEBUG_CONFIG_FILE;
  const debugDir = options.debugDir ?? DEFAULT_DEBUG_DIR;
  const debugLogFile = options.debugLogFile ?? DEFAULT_DEBUG_LOG_FILE;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_DEBUG_CONFIG_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const createDate = options.createDate ?? (() => new Date());
  const fileSystem = options.fileSystem ?? DEFAULT_FILE_SYSTEM;

  let cachedDebugFingerprint: string | undefined;
  let cachedDebugEnabled = false;
  let cachedDebugCheckedAt = 0;
  let debugDirectoryReady = false;
  let writeQueue: Promise<void> = Promise.resolve();

  function getDebugConfigFingerprint(): string {
    try {
      const stats = fileSystem.statSync(configFile);
      return `${stats.mtimeMs}:${stats.size}`;
    } catch {
      return "missing";
    }
  }

  function isDebugEnabled(): boolean {
    const checkedAt = now();
    if (cachedDebugFingerprint !== undefined && checkedAt - cachedDebugCheckedAt < cacheTtlMs) {
      return cachedDebugEnabled;
    }

    cachedDebugCheckedAt = checkedAt;
    const fingerprint = getDebugConfigFingerprint();
    if (fingerprint === cachedDebugFingerprint) {
      return cachedDebugEnabled;
    }

    cachedDebugFingerprint = fingerprint;
    cachedDebugEnabled = false;
    try {
      if (!fileSystem.existsSync(configFile)) {
        return cachedDebugEnabled;
      }

      const rawConfig = JSON.parse(fileSystem.readFileSync(configFile, "utf8") as string) as unknown;
      cachedDebugEnabled = toRecord(rawConfig).debug === true;
      return cachedDebugEnabled;
    } catch {
      return cachedDebugEnabled;
    }
  }

  function ensureDebugDirectory(): void {
    if (debugDirectoryReady) {
      return;
    }

    fileSystem.mkdirSync(debugDir, { recursive: true });
    debugDirectoryReady = true;
  }

  function appendLine(line: string): Promise<void> {
    return fileSystem.appendFile(debugLogFile, line, "utf8");
  }

  return {
    log(message: string, error?: unknown): void {
      if (!isDebugEnabled()) {
        return;
      }

      try {
        ensureDebugDirectory();
        const errorText = error instanceof Error
          ? `${error.name}: ${error.message}`
          : error === undefined
            ? ""
            : String(error);
        const suffix = errorText ? ` ${redactMessage(errorText)}` : "";
        const line = `${createDate().toISOString()} ${redactMessage(message)}${suffix}\n`;
        writeQueue = writeQueue.then(
          () => appendLine(line),
          () => appendLine(line),
        );
        void writeQueue.catch(() => undefined);
      } catch (logError) {
        // Debug logging must never affect extension behavior.
        void logError;
      }
    },
    flush(): Promise<void> {
      return writeQueue.catch(() => undefined);
    },
  };
}

const defaultDebugLogger = createToolDisplayDebugLogger();

export function logToolDisplayDebug(message: string, error?: unknown): void {
  defaultDebugLogger.log(message, error);
}
