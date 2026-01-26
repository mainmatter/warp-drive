import { parse } from '@ast-grep/napi';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { glob } from 'glob';
import { basename, dirname, extname, join, resolve } from 'path';

import { processIntermediateModelsToTraits, willModelHaveExtension } from './model-to-schema.js';
import type { TransformOptions } from './utils/ast-utils.js';
import {
  debugLog,
  DEFAULT_MIXIN_SOURCE,
  extractBaseName,
  findEmberImportLocalName,
  getLanguageFromPath,
  isModelFile as astIsModelFile,
} from './utils/ast-utils.js';
import { Logger } from './utils/logger.js';
import { analyzeModelMixinUsage } from './processors/mixin.js';

export interface MigrateOptions extends Partial<TransformOptions> {
  mixinsOnly?: boolean;
  modelsOnly?: boolean;
  skipProcessed?: boolean;
  inputDir?: string;
  modelSourceDir?: string;
  mixinSourceDir?: string;
}

/**
 * JSCodeshift transform function that throws an error
 * migrate-to-schema is designed to run as a batch operation only
 */
export default function (): never {
  throw new Error(
    'migrate-to-schema should be run as a batch operation, not on individual files. Use the CLI command directly.'
  );
}

/**
 * Check if a file is a mixin file using AST analysis
 */
function astIsMixinFile(filePath: string, source: string, options?: TransformOptions): boolean {
  try {
    const lang = getLanguageFromPath(filePath);
    const ast = parse(lang, source);
    const root = ast.root();

    // Look for Mixin imports from @ember/object/mixin
    const mixinSources = [DEFAULT_MIXIN_SOURCE];
    const mixinImportLocal = findEmberImportLocalName(root, mixinSources, options, filePath, process.cwd());

    return !!mixinImportLocal;
  } catch (error) {
    debugLog(options, `Error checking if file is mixin: ${String(error)}`);
    return false;
  }
}

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
          const sourceDirResolved = resolve(source.dir.replace(/\/?\*+$/, ''));
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

/**
 * Get relative path for a file from additionalModelSources
 */
function getRelativePathFromAdditionalSources(
  filePath: string,
  additionalSources?: Array<{ pattern: string; dir: string }>
): string | null {
  if (!additionalSources) return null;

  for (const source of additionalSources) {
    const sourceDirResolved = resolve(source.dir.replace(/\/?\*+$/, '')); // Remove trailing wildcards
    if (filePath.startsWith(sourceDirResolved)) {
      // File is from this additional source, extract just the basename
      return `/${basename(filePath)}`;
    }
  }
  return null;
}

/**
 * Get the output path for an artifact based on its type and source file
 */
function getArtifactOutputPath(
  artifact: { type: string; suggestedFileName?: string },
  filePath: string,
  finalOptions: TransformOptions,
  isFromMixin = false
): { outputDir: string; outputPath: string } {
  let outputDir: string;
  let outputPath: string;

  if (artifact.type === 'schema') {
    // Schema files go to resourcesDir
    outputDir = finalOptions.resourcesDir || './app/data/resources';

    // Try standard model source directory first
    let relativePath = filePath.replace(resolve(finalOptions.modelSourceDir || './app/models'), '');

    // If not in standard directory, check additionalModelSources
    if (relativePath === filePath) {
      const additionalPath = getRelativePathFromAdditionalSources(filePath, finalOptions.additionalModelSources);
      if (additionalPath) {
        relativePath = additionalPath;
      } else if (finalOptions.generateExternalResources) {
        // Fallback: extract just the filename for external models
        const fileName = basename(filePath);
        relativePath = `/${fileName}`;
      }
    }

    // Resources should include .schema and match original source file extension
    const extension = filePath.endsWith('.ts') ? '.ts' : '.js';
    const outputName = relativePath.replace(/\.(js|ts)$/, `.schema${extension}`);
    outputPath = join(resolve(outputDir), outputName);
  } else if (artifact.type === 'resource-type') {
    // Type files are colocated with their schemas in resourcesDir
    outputDir = finalOptions.resourcesDir || './app/data/resources';

    // Try standard model source directory first
    let relativePath = filePath.replace(resolve(finalOptions.modelSourceDir || './app/models'), '');

    // If not in standard directory, check additionalModelSources
    if (relativePath === filePath) {
      const additionalPath = getRelativePathFromAdditionalSources(filePath, finalOptions.additionalModelSources);
      if (additionalPath) {
        relativePath = additionalPath;
      } else if (finalOptions.generateExternalResources) {
        // Fallback: extract just the filename for external models
        const fileName = basename(filePath);
        relativePath = `/${fileName}`;
      }
    }

    outputPath = join(resolve(outputDir), relativePath.replace(/\.(js|ts)$/, '.schema.types.ts'));
  } else if (artifact.type === 'trait') {
    // Trait files go to traitsDir
    outputDir = finalOptions.traitsDir ?? './app/data/traits';
    const relativePath = getRelativePathForMixin(filePath, finalOptions);
    // Traits should include .schema and match original source file extension
    const extension = filePath.endsWith('.ts') ? '.ts' : '.js';
    const outputName = relativePath.replace(/\.(js|ts)$/, `.schema${extension}`);
    outputPath = join(resolve(outputDir), outputName);
  } else if (artifact.type === 'trait-type') {
    // Type files are colocated with their traits in traitsDir
    outputDir = finalOptions.traitsDir ?? './app/data/traits';
    const relativePath = getRelativePathForMixin(filePath, finalOptions);
    outputPath = join(resolve(outputDir), relativePath.replace(/\.(js|ts)$/, '.schema.types.ts'));
  } else if (artifact.type === 'extension' || artifact.type === 'extension-type') {
    // Extension files go to extensionsDir
    outputDir = finalOptions.extensionsDir || './app/data/extensions';
    // Use the suggested filename from the artifact instead of calculating relative path
    // This handles external package files correctly
    const outputName =
      artifact.type === 'extension'
        ? artifact.suggestedFileName || 'unknown-extension.ts'
        : artifact.suggestedFileName?.replace(/\.(js|ts)$/, '.schema.types.ts') || 'unknown-extension-type.ts';
    outputPath = join(resolve(outputDir), outputName);
  } else if (artifact.type === 'resource-type-stub') {
    // Resource type stubs go to resourcesDir like other resource types
    debugLog(finalOptions, `RESOURCE-TYPE-STUB: redirecting to resources dir`);
    outputDir = finalOptions.resourcesDir || './app/data/resources';
    outputPath = join(resolve(outputDir), artifact.suggestedFileName || 'unknown-stub.ts');
  } else {
    // Default fallback
    outputDir = finalOptions.outputDir ?? './app/schemas';
    outputPath = join(resolve(outputDir), artifact.suggestedFileName || 'unknown');
  }

  return { outputDir, outputPath };
}

/**
 * Get the relative path for a mixin file, handling both local and external mixins
 */
function getRelativePathForMixin(filePath: string, options: TransformOptions): string {
  // First, try to get relative path from the main mixin source directory
  const mixinSourceDir = resolve(options.mixinSourceDir || './app/mixins');
  if (filePath.startsWith(mixinSourceDir)) {
    return filePath.replace(mixinSourceDir, '').replace(/^\//, '');
  }

  // Check if this is an external mixin from additionalMixinSources
  if (options.additionalMixinSources) {
    for (const source of options.additionalMixinSources) {
      // Get the base directory (remove trailing /* if present)
      let baseDir = source.dir;
      if (baseDir.endsWith('/*')) {
        baseDir = baseDir.slice(0, -2);
      } else if (baseDir.endsWith('*')) {
        baseDir = baseDir.slice(0, -1);
      }

      const resolvedBaseDir = resolve(baseDir);
      if (filePath.startsWith(resolvedBaseDir)) {
        // For external mixins, use just the filename
        return basename(filePath);
      }
    }
  }

  // Fallback: use just the filename
  return basename(filePath);
}

type Filename = string;
type InputFile = { path: string; code: string; isMixin: boolean; isModel: boolean };

export type FinalOptions = TransformOptions & MigrateOptions & { kind: 'finalized' };

class Input {
  models: Map<Filename, InputFile> = new Map();
  mixins: Map<Filename, InputFile> = new Map();
  skipped: string[] = [];
  errors: Error[] = [];
}

export class Codemod {
  logger: Logger;
  finalOptions: FinalOptions;
  input: Input = new Input();

  constructor(logger: Logger, finalOptions: FinalOptions) {
    this.logger = logger;
    this.finalOptions = finalOptions;
  }

  mixinsImportedByModels: Set<string> = new Set();

  findMixinsUsedByModels() {
    this.mixinsImportedByModels = analyzeModelMixinUsage(this, this.finalOptions);
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
          (!this.finalOptions.skipProcessed || !isAlreadyProcessed(file, this.finalOptions)) &&
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
        return existsSync(file) && (!this.finalOptions.skipProcessed || !isAlreadyProcessed(file, this.finalOptions));
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

function expandGlobPattern(dir: string): string {
  // Convert dir pattern to glob pattern (e.g., "path/to/models/*" -> "path/to/models/**/*.{js,ts}")
  let dirGlobPattern = dir;
  if (dirGlobPattern.endsWith('*')) {
    // Replace trailing * with **/*.{js,ts}
    dirGlobPattern = dirGlobPattern.replace(/\*$/, '**/*.{js,ts}');
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

          let isModel = false;
          let isMixin = false;

          if (astIsModelFile(file, content, finalOptions)) {
            isModel = true;
          }

          if (!isModel && astIsMixinFile(file, content, finalOptions)) {
            isMixin = true;
          }

          output.push({ path: file, code: content, isMixin, isModel });
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

/**
 * Run the migration for multiple files
 */
export async function runMigration(options: MigrateOptions): Promise<void> {
  const finalOptions: FinalOptions = {
    kind: 'finalized',
    appImportPrefix: 'my-app',
    inputDir: options.inputDir || './app',
    outputDir: options.outputDir || './app/schemas',
    dryRun: options.dryRun || false,
    verbose: options.verbose || false,
    modelSourceDir: options.modelSourceDir || './app/models',
    mixinSourceDir: options.mixinSourceDir || './app/mixins',
    ...options,
  };

  const logger = new Logger(finalOptions.verbose);
  logger.info(`🚀 Starting schema migration...`);
  logger.info(`📁 Input directory: ${resolve(finalOptions.inputDir || './app')}`);
  logger.info(`📁 Output directory: ${resolve(finalOptions.outputDir || './app/schemas')}`);

  const codemod = new Codemod(logger, finalOptions);

  // Ensure output directories exist (specific directories are created as needed)
  if (!finalOptions.dryRun) {
    // Only create specific directories if they are configured
    // The generic outputDir is only used for fallback artifacts and shouldn't be pre-created
    if (finalOptions.traitsDir) {
      mkdirSync(resolve(finalOptions.traitsDir), { recursive: true });
    }
    if (finalOptions.extensionsDir) {
      mkdirSync(resolve(finalOptions.extensionsDir), { recursive: true });
    }
    if (finalOptions.resourcesDir) {
      mkdirSync(resolve(finalOptions.resourcesDir), { recursive: true });
    }
  }

  if (!options.mixinsOnly) {
    await codemod.findModels();
    codemod.findMixinsUsedByModels();
  }

  if (!options.modelsOnly) {
    await codemod.findMixins();
  }

  const filesToProcess: number = codemod.input.mixins.size + codemod.input.models.size;

  if (filesToProcess === 0) {
    logger.info('✅ No files found to process.');
    return;
  }

  logger.info(`📋 Processing ${filesToProcess} files total`);
  logger.info(`📋 Found ${codemod.input.models.size} model and ${codemod.input.mixins.size} mixin files`);

  logger.warn(`📋 Skipped ${codemod.input.skipped.length} files total`);
  logger.warn(`📋 Errors found while reading files: ${codemod.input.errors.length}`);

  finalOptions.allModelFiles = Object.keys(codemod.input.models);
  finalOptions.allMixinFiles = Object.keys(codemod.input.mixins);

  // Pre-analyze which models will have extensions
  // This allows imports to reference extension types instead of schema types for better type coverage
  const modelsWithExtensions = new Set<string>();
  if (!options.mixinsOnly) {
    logger.info(`🔍 Analyzing which models will have extensions...`);
    let analyzed = 0;
    for (const [modelFile, modelInput] of codemod.input.models) {
      try {
        if (willModelHaveExtension(modelFile, modelInput.code, finalOptions)) {
          const modelBaseName = extractBaseName(modelFile);
          modelsWithExtensions.add(modelBaseName);
        }
        analyzed++;
        if (analyzed % 100 === 0 && finalOptions.verbose) {
          logger.info(`📊 Analyzed ${analyzed}/${finalOptions.allModelFiles.length} models for extensions...`);
        }
      } catch (error) {
        if (finalOptions.verbose) {
          logger.error(`❌ Error analyzing model ${modelFile} for extensions: ${String(error)}`);
        }
      }
    }
    logger.info(`✅ Found ${modelsWithExtensions.size} models with extensions.`);
  }
  finalOptions.modelsWithExtensions = modelsWithExtensions;

  // Process intermediate models to generate trait artifacts first
  // This must be done before processing regular models that extend these intermediate models
  if (finalOptions.intermediateModelPaths && finalOptions.intermediateModelPaths.length > 0) {
    try {
      logger.info(`🔄 Processing ${finalOptions.intermediateModelPaths.length} intermediate models...`);
      const intermediateResults = processIntermediateModelsToTraits(
        Array.isArray(finalOptions.intermediateModelPaths)
          ? finalOptions.intermediateModelPaths
          : [finalOptions.intermediateModelPaths],
        finalOptions.additionalModelSources,
        finalOptions.additionalMixinSources,
        finalOptions
      );

      // Write intermediate model trait artifacts
      for (const artifact of intermediateResults.artifacts) {
        let outputDir: string;
        let outputPath: string;

        if (artifact.type === 'trait') {
          // Trait files go to traitsDir
          outputDir = finalOptions.traitsDir ?? './app/data/traits';
          outputPath = join(resolve(outputDir), artifact.suggestedFileName);
        } else if (artifact.type === 'trait-type') {
          // Type files are colocated with their traits in traitsDir
          outputDir = finalOptions.traitsDir ?? './app/data/traits';
          // Generate type file name from the trait artifact name
          const typeFileName = artifact.suggestedFileName.replace(/\.js$/, '.schema.types.ts');
          outputPath = join(resolve(outputDir), typeFileName);
        } else if (artifact.type === 'extension') {
          // Extension files go to extensionsDir
          outputDir = finalOptions.extensionsDir || './app/data/extensions';
          outputPath = join(resolve(outputDir), artifact.suggestedFileName);
        } else if (artifact.type === 'extension-type') {
          // Extension type files go to extensionsDir
          outputDir = finalOptions.extensionsDir || './app/data/extensions';
          outputPath = join(resolve(outputDir), artifact.suggestedFileName);
        } else if (artifact.type === 'resource-type') {
          // Resource type interfaces go to resourcesDir
          outputDir = finalOptions.resourcesDir || './app/data/resources';
          outputPath = join(resolve(outputDir), artifact.suggestedFileName);
        } else if (artifact.type === 'resource-type-stub') {
          // Resource type stubs go to resourcesDir like other resource types
          outputDir = finalOptions.resourcesDir || './app/data/resources';
          outputPath = join(resolve(outputDir), artifact.suggestedFileName);
        } else {
          // Default fallback
          outputDir = finalOptions.outputDir ?? './app/schemas';
          outputPath = join(resolve(outputDir), artifact.suggestedFileName);
        }

        if (!finalOptions.dryRun) {
          // Ensure output directory exists
          const outputDirPath = dirname(outputPath);
          if (!existsSync(outputDirPath)) {
            mkdirSync(outputDirPath, { recursive: true });
          }

          writeFileSync(outputPath, artifact.code, 'utf-8');
          if (finalOptions.verbose) {
            logger.info(`✅ Generated intermediate ${artifact.type}: ${outputPath}`);
          }
        } else if (finalOptions.verbose) {
          logger.info(`✅ Would generate intermediate ${artifact.type}: ${outputPath} (dry run)`);
        }
      }

      if (intermediateResults.errors.length > 0) {
        logger.error(`⚠️ Errors processing intermediate models:`);
        for (const error of intermediateResults.errors) {
          logger.error(`   ${String(error)}`);
        }
      }

      logger.info(`✅ Processed ${intermediateResults.artifacts.length} intermediate model artifacts`);
    } catch (error) {
      logger.error(`❌ Error processing intermediate models: ${String(error)}`);
    }
  }

  // Pass the model-connected mixins and models with extensions to the transform options
  const enhancedOptions = {
    ...finalOptions,
    modelConnectedMixins: codemod.mixinsImportedByModels,
    modelsWithExtensions,
  };

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Process model files individually using the model transform
  for (const [filePath, modelInput] of codemod.input.models) {
    try {
      if (finalOptions.verbose) {
        logger.debug(`🔄 Processing: ${filePath}`);
      }

      // Apply the model transform to get artifacts
      const { toArtifacts } = await import('./model-to-schema.js');
      const artifacts = toArtifacts(filePath, modelInput.code, enhancedOptions);

      if (artifacts.length > 0) {
        processed++;

        // Write each artifact to the appropriate directory
        for (const artifact of artifacts) {
          const { outputPath } = getArtifactOutputPath(artifact, filePath, finalOptions, false);

          if (!finalOptions.dryRun) {
            // Ensure output directory exists
            const outputDirPath = dirname(outputPath);
            if (!existsSync(outputDirPath)) {
              mkdirSync(outputDirPath, { recursive: true });
            }

            writeFileSync(outputPath, artifact.code, 'utf-8');
            if (finalOptions.verbose) {
              logger.info(`✅ Generated ${artifact.type}: ${outputPath}`);
            }
          } else if (finalOptions.verbose) {
            logger.info(`✅ Would generate ${artifact.type}: ${outputPath} (dry run)`);
          }
        }
      } else {
        skipped++;
        if (finalOptions.verbose) {
          logger.debug(`⏭️  Skipped (no artifacts generated): ${filePath}`);
        }
      }
    } catch (error) {
      errors++;
      logger.error(`❌ Error processing ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Process mixin files (only model mixins will be transformed)
  for (const [filePath, mixinInput] of codemod.input.mixins) {
    try {
      if (finalOptions.verbose) {
        logger.debug(`🔄 Processing: ${filePath}`);
      }

      // Apply the mixin transform to get artifacts
      const { toArtifacts } = await import('./mixin-to-schema.js');
      const artifacts = toArtifacts(filePath, mixinInput.code, enhancedOptions);

      if (artifacts.length > 0) {
        processed++;

        // Write each artifact to the appropriate directory
        for (const artifact of artifacts) {
          const { outputPath } = getArtifactOutputPath(artifact, filePath, finalOptions, true);

          if (!finalOptions.dryRun) {
            // Ensure output directory exists
            const outputDirPath = dirname(outputPath);
            if (!existsSync(outputDirPath)) {
              mkdirSync(outputDirPath, { recursive: true });
            }

            writeFileSync(outputPath, artifact.code, 'utf-8');
            if (finalOptions.verbose) {
              logger.info(`✅ Generated ${artifact.type}: ${outputPath}`);
            }
          } else if (finalOptions.verbose) {
            logger.info(`✅ Would generate ${artifact.type}: ${outputPath} (dry run)`);
          }
        }
      } else {
        skipped++;
        if (finalOptions.verbose) {
          logger.debug(`⏭️  Skipped (not a model mixin): ${filePath}`);
        }
      }
    } catch (error) {
      errors++;
      logger.error(`❌ Error processing ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  logger.info(`\n✅ Migration complete!`);
  logger.info(`   📊 Processed: ${processed} files`);
  logger.info(`   ⏭️  Skipped: ${skipped} files (not applicable for transformation)`);
  if (errors > 0) {
    logger.info(`   ❌ Errors: ${errors} files`);
  }
}

/**
 * Check if a file has already been processed
 */
function isAlreadyProcessed(filePath: string, options: TransformOptions): boolean {
  // Simple heuristic: check if a corresponding schema file exists
  const outputPath = filePath
    .replace('/models/', '/schemas/')
    .replace('/mixins/', '/traits/')
    .replace(/\.(js|ts)$/, '.ts');

  return existsSync(outputPath);
}
