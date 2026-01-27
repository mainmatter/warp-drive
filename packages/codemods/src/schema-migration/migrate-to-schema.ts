import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

import { Codemod, FinalOptions, MigrateOptions } from './codemod.js';
import { processIntermediateModelsToTraits, toArtifacts as modelToArtifacts } from './model-to-schema.js';
import { toArtifacts as mixinToArtifacts } from './mixin-to-schema.js';
import type { TransformOptions } from './utils/ast-utils.js';
import { debugLog } from './utils/ast-utils.js';
import { Logger } from './utils/logger.js';

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

interface ProcessingResult {
  processed: number;
  skipped: number;
  errors: number;
}

/**
 * Write intermediate model trait artifacts to disk
 */
function writeIntermediateArtifacts(
  artifacts: Array<{ type: string; code: string; suggestedFileName: string }>,
  finalOptions: FinalOptions,
  logger: Logger
): void {
  for (const artifact of artifacts) {
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
}

/**
 * Process model files and generate schema artifacts
 */
async function processModelFiles(
  models: Map<string, { code: string }>,
  enhancedOptions: TransformOptions,
  finalOptions: FinalOptions,
  logger: Logger
): Promise<ProcessingResult> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const [filePath, modelInput] of models) {
    try {
      if (finalOptions.verbose) {
        logger.debug(`🔄 Processing: ${filePath}`);
      }

      const artifacts = modelToArtifacts(filePath, modelInput.code, enhancedOptions);

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

  return { processed, skipped, errors };
}

/**
 * Process mixin files and generate trait artifacts
 */
async function processMixinFiles(
  mixins: Map<string, { code: string }>,
  enhancedOptions: TransformOptions,
  finalOptions: FinalOptions,
  logger: Logger
): Promise<ProcessingResult> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const [filePath, mixinInput] of mixins) {
    try {
      if (finalOptions.verbose) {
        logger.debug(`🔄 Processing: ${filePath}`);
      }

      const artifacts = mixinToArtifacts(filePath, mixinInput.code, enhancedOptions);

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

  return { processed, skipped, errors };
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
    codemod.createDestinationDirectories();
  }

  if (!options.mixinsOnly) {
    await codemod.findModels();
    codemod.findMixinsUsedByModels();
    codemod.findModelExtensions();
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
  finalOptions.modelsWithExtensions = codemod.modelsWithExtensions;

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
      writeIntermediateArtifacts(intermediateResults.artifacts, finalOptions, logger);

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
    modelsWithExtensions: codemod.modelsWithExtensions,
  };

  // Process model files individually using the model transform
  const modelResults = await processModelFiles(codemod.input.models, enhancedOptions, finalOptions, logger);

  // Process mixin files (only model mixins will be transformed)
  const mixinResults = await processMixinFiles(codemod.input.mixins, enhancedOptions, finalOptions, logger);

  // Aggregate results
  const processed = modelResults.processed + mixinResults.processed;
  const skipped = modelResults.skipped + mixinResults.skipped;
  const errors = modelResults.errors + mixinResults.errors;

  logger.info(`\n✅ Migration complete!`);
  logger.info(`   📊 Processed: ${processed} files`);
  logger.info(`   ⏭️  Skipped: ${skipped} files (not applicable for transformation)`);
  if (errors > 0) {
    logger.info(`   ❌ Errors: ${errors} files`);
  }
}
