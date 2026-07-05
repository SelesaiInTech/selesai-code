import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DIR_NAME, getAgentDir } from '@selesai/code';
import {
  DEFAULT_BACKEND_CONFIG,
  extractBackendConfigOverride,
  mergeBackendConfigLayers,
  type BackendConfig,
  type BackendConfigFile,
  type BackendConfigOverride
} from '../backends/config.js';
import {
  DEFAULT_PRESENTATION_CONFIG,
  extractPresentationConfigOverride,
  mergePresentationConfigLayers
} from './config.js';
import type {
  PresentationConfig,
  PresentationConfigFile,
  PresentationConfigOverride,
  PresentationScope
} from './types.js';

export type PresentationConfigStoreOptions = {
  homeDir?: string;
  projectDir?: string;
};

export type PresentationConfigLayer = {
  path: string;
  exists: boolean;
  rawConfig?: PresentationConfigOverride;
  rawBackends?: BackendConfigOverride;
  error?: string;
};

export type LoadedPresentationConfig = {
  global: PresentationConfigLayer;
  project: PresentationConfigLayer;
  effectiveConfig: PresentationConfig;
  effectiveBackends: BackendConfig;
};

export function getPresentationConfigPaths(options: PresentationConfigStoreOptions = {}) {
  // ponytail: use selesai's getAgentDir() so the config dir respects the active
  // CONFIG_DIR_NAME (e.g. .selesai) instead of upstream's hardcoded .pi. Ceiling:
  // if selesai changes the extensions config layout, update here; upgrade path =
  // upstream pi-web-agent accepting a config-dir resolver.
  const projectDir = options.projectDir ?? process.cwd();
  const agentDir = getAgentDir();
  const globalConfigRoot = path.join(agentDir, 'extensions', 'pi-web-agent', 'config.json');

  return {
    globalPath: globalConfigRoot,
    // ponytail: project config dir is CONFIG_DIR_NAME (e.g. .selesai), not the
    // upstream hardcoded .pi. Ceiling: assumes the project-local extension
    // config layout matches the global one; upgrade path = upstream accepting a
    // config-dir resolver for project paths too.
    projectPath: path.join(projectDir, CONFIG_DIR_NAME, 'extensions', 'pi-web-agent', 'config.json')
  };
}

type AgentConfigFile = PresentationConfigFile & BackendConfigFile;

type LegacyPresentationConfigFile = NonNullable<PresentationConfigFile['presentation']>;

function hasPresentationRoot(parsed: AgentConfigFile) {
  return parsed.presentation !== undefined;
}

async function readPresentationConfigFile(filePath: string): Promise<PresentationConfigLayer> {
  try {
    const rawText = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(rawText) as AgentConfigFile;
    const presentationFile: PresentationConfigFile = hasPresentationRoot(parsed)
      ? parsed
      : { presentation: parsed as LegacyPresentationConfigFile };

    return {
      path: filePath,
      exists: true,
      rawConfig: extractPresentationConfigOverride(presentationFile),
      rawBackends: extractBackendConfigOverride(parsed)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return { path: filePath, exists: false };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      path: filePath,
      exists: true,
      error: message
    };
  }
}

function serializePresentationConfigOverride(config: PresentationConfigOverride): PresentationConfigFile {
  const presentation: NonNullable<PresentationConfigFile['presentation']> = {};

  if (config.defaultMode) {
    presentation.defaultMode = config.defaultMode;
  }

  if (Object.keys(config.tools).length > 0) {
    presentation.tools = config.tools;
  }

  return { presentation };
}

function serializeBackendConfigOverride(config: BackendConfigOverride): BackendConfigFile {
  const backends: NonNullable<BackendConfigFile['backends']> = {};

  if (config.search && Object.keys(config.search).length > 0) {
    backends.search = { ...config.search };
  }

  if (config.fetch && Object.keys(config.fetch).length > 0) {
    const { apiKey: _apiKey, ...fetch } = config.fetch;
    backends.fetch = { ...fetch };
  }

  if (config.headless && Object.keys(config.headless).length > 0) {
    backends.headless = { ...config.headless };
  }

  return { backends };
}

async function readConfigFileForWrite(filePath: string): Promise<AgentConfigFile> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as AgentConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function writeConfigFile(filePath: string, config: AgentConfigFile) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export async function loadPresentationConfigLayers(
  options: PresentationConfigStoreOptions = {}
): Promise<LoadedPresentationConfig> {
  const { globalPath, projectPath } = getPresentationConfigPaths(options);
  const global = await readPresentationConfigFile(globalPath);
  const project = await readPresentationConfigFile(projectPath);

  return {
    global,
    project,
    effectiveConfig: mergePresentationConfigLayers(
      DEFAULT_PRESENTATION_CONFIG,
      global.rawConfig,
      project.rawConfig
    ),
    effectiveBackends: mergeBackendConfigLayers(
      DEFAULT_BACKEND_CONFIG,
      global.rawBackends,
      project.rawBackends
    )
  };
}

export async function savePresentationConfigScope(
  options: PresentationConfigStoreOptions,
  scope: PresentationScope,
  config: PresentationConfigOverride
) {
  const { globalPath, projectPath } = getPresentationConfigPaths(options);
  const filePath = scope === 'global' ? globalPath : projectPath;
  const existing = await readConfigFileForWrite(filePath);

  await writeConfigFile(filePath, {
    ...existing,
    ...serializePresentationConfigOverride(config)
  });
}

export async function saveBackendConfigScope(
  options: PresentationConfigStoreOptions,
  scope: PresentationScope,
  config: BackendConfigOverride
) {
  const { globalPath, projectPath } = getPresentationConfigPaths(options);
  const filePath = scope === 'global' ? globalPath : projectPath;
  const existing = await readConfigFileForWrite(filePath);

  await writeConfigFile(filePath, {
    ...existing,
    ...serializeBackendConfigOverride(config)
  });
}

export async function resetPresentationConfigScope(
  options: PresentationConfigStoreOptions,
  scope: PresentationScope
) {
  const { globalPath, projectPath } = getPresentationConfigPaths(options);
  const filePath = scope === 'global' ? globalPath : projectPath;

  await rm(filePath, { force: true });
}
