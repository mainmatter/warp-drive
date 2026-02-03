import { existsSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { glob } from 'glob';
import { basename, extname, join, resolve } from 'path';

import type { FinalOptions } from './config.js';
import { extractBaseName } from './utils/ast-utils.js';
import { Logger } from './utils/logger.js';
import { analyzeModelMixinUsage } from './processors/mixin-analyzer.js';
import { willModelHaveExtension } from './processors/model.js';
import { FILE_EXTENSION_REGEX, TRAILING_SINGLE_WILDCARD_REGEX, TRAILING_WILDCARD_REGEX } from './utils/string.js';

type Filename = string;
type InputFile = { path: string; code: string };

/**
 * Check if a file path matches any intermediate model path
 */
function isIntermediateModel(
  filePath: string,
  intermediateModelPaths?: string[],
  additionalModelSources?: Array<{ pattern: string; dir: string }>
): boolean {
  if (!intermediateModelPaths) return false;

  const fileBaseName = basename(filePath, extname(filePath));

  for (const intermediatePath of intermediateModelPaths) {
    // Handle paths with extensions (e.g., "my-app/core/base-model.js")
    const intermediateBaseName = basename(intermediatePath, extname(intermediatePath));

    if (fileBaseName === intermediateBaseName) {
      // Check if file is from a matching additional source
      if (additionalModelSources) {
        for (const source of additionalModelSources) {
          const sourceDirResolved = resolve(source.dir.replace(TRAILING_WILDCARD_REGEX, ''));
          if (filePath.startsWith(sourceDirResolved)) {
            return true;
          }
        }
      }

      // Also check if it's in app/core
      if (filePath.includes('/app/core/')) {
        return true;
      }
    }
  }

  return false;
}

function expandGlobPattern(dir: string): string {
  // Convert dir pattern to glob pattern (e.g., "path/to/models/*" -> "path/to/models/**/*.{js,ts}")
  let dirGlobPattern = dir;
  if (dirGlobPattern.endsWith('*')) {
    // Replace trailing * with **/*.{js,ts}
    dirGlobPattern = dirGlobPattern.replace(TRAILING_SINGLE_WILDCARD_REGEX, '**/*.{js,ts}');
  } else {
    // Add **/*.{js,ts} if no glob pattern
    dirGlobPattern = join(dirGlobPattern, '**/*.{js,ts}');
  }

  return resolve(dirGlobPattern);
}

async function findFiles(
  sources: string[],
  predicate: (file: string) => boolean,
  finalOptions: FinalOptions,
  logger: Logger
): Promise<{ output: InputFile[]; skipped: string[]; errors: Error[] }> {
  let output: InputFile[] = [];
  let errors: Error[] = [];
  let skipped: string[] = [];

  for (const source of sources) {
    try {
      const files = await glob(source);

      for (const file of files) {
        if (predicate(file)) {
          const content = await readFile(file, 'utf-8');

          output.push({ path: file, code: content });
        } else {
          skipped.push(file);
        }
      }

      if (finalOptions.verbose) {
        logger.info(
          `📋 Found ${output.length} files at '${source}' (Total: '${output.length}', Skipped: '${skipped.length}' Sources: '[${sources.join(',')}]')`
        );
      }
    } catch (error: unknown) {
      logger.error(`Failed to process file source ${source}: ${String(error)}`);
      errors.push(error as Error);
    }
  }

  return { output, skipped, errors };
}

export class Input {
  models: Map<Filename, InputFile> = new Map();
  mixins: Map<Filename, InputFile> = new Map();
  skipped: string[] = [];
  errors: Error[] = [];
}

export class Codemod {
  logger: Logger;
  finalOptions: FinalOptions;
  input: Input = new Input();

  mixinsImportedByModels: Set<string> = new Set();
  modelsWithExtensions: Set<string> = new Set();

  constructor(logger: Logger, finalOptions: FinalOptions) {
    this.logger = logger;
    this.finalOptions = finalOptions;
  }

  findMixinsUsedByModels() {
    this.mixinsImportedByModels = analyzeModelMixinUsage(this, this.finalOptions);
  }

  findModelExtensions() {
    this.logger.info(`🔍 Analyzing which models will have extensions...`);
    for (const [modelFile, modelInput] of this.input.models) {
      try {
        if (willModelHaveExtension(modelFile, modelInput.code, this.finalOptions)) {
          const modelBaseName = extractBaseName(modelFile);
          this.modelsWithExtensions.add(modelBaseName);
        }
      } catch (error) {
        this.logger.error(`❌ Error analyzing model ${modelFile} for extensions: ${String(error)}`);
      }
    }
    this.logger.info(`✅ Found ${this.modelsWithExtensions.size} models with extensions.`);
  }

  createDestinationDirectories() {
    // Only create specific directories if they are configured
    // The generic outputDir is only used for fallback artifacts and shouldn't be pre-created
    if (this.finalOptions.traitsDir) {
      mkdirSync(resolve(this.finalOptions.traitsDir), { recursive: true });
    }
    if (this.finalOptions.extensionsDir) {
      mkdirSync(resolve(this.finalOptions.extensionsDir), { recursive: true });
    }
    if (this.finalOptions.resourcesDir) {
      mkdirSync(resolve(this.finalOptions.resourcesDir), { recursive: true });
    }
  }

  async findModels() {
    // TODO: || './app/models'
    if (!this.finalOptions.modelSourceDir) {
      throw new Error('`options.modelSourceDir` must be specified before looking for files');
    }

    const filePattern = join(resolve(this.finalOptions.modelSourceDir), '**/*.{js,ts}');
    let fileSources = [filePattern];

    if (this.finalOptions.additionalModelSources) {
      for (const source of this.finalOptions.additionalModelSources) {
        fileSources.push(expandGlobPattern(source.dir));
      }
    }

    const models = await findFiles(
      fileSources,
      (file) => {
        return (
          existsSync(file) &&
          (!this.finalOptions.skipProcessed || !isAlreadyProcessed(file)) &&
          !isIntermediateModel(file, this.finalOptions.intermediateModelPaths, this.finalOptions.additionalModelSources)
        );
      },
      this.finalOptions,
      this.logger
    );

    for (const inputFile of models.output) {
      this.input.models.set(inputFile.path, inputFile);
    }
    this.input.errors.push(...models.errors);
    this.input.skipped.push(...models.skipped);
  }

  async findMixins() {
    if (!this.finalOptions.mixinSourceDir) {
      throw new Error('`options.mixinSourceDir` must be specified before looking for files');
    }

    const filePattern = join(resolve(this.finalOptions.mixinSourceDir), '**/*.{js,ts}');
    let fileSources = [filePattern];

    if (this.finalOptions.additionalMixinSources) {
      for (const source of this.finalOptions.additionalMixinSources) {
        fileSources.push(expandGlobPattern(source.dir));
      }
    }

    const models = await findFiles(
      fileSources,
      (file) => {
        return existsSync(file) && (!this.finalOptions.skipProcessed || !isAlreadyProcessed(file));
      },
      this.finalOptions,
      this.logger
    );

    for (const inputFile of models.output) {
      this.input.mixins.set(inputFile.path, inputFile);
    }

    this.input.errors.push(...models.errors);
    this.input.skipped.push(...models.skipped);
  }
}

/**
 * Check if a file has already been processed
 */
function isAlreadyProcessed(filePath: string): boolean {
  // Simple heuristic: check if a corresponding schema file exists
  const outputPath = filePath
    .replace('/models/', '/schemas/')
    .replace('/mixins/', '/traits/')
    .replace(FILE_EXTENSION_REGEX, '.ts');

  return existsSync(outputPath);
}
