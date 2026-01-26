import { parse } from '@ast-grep/napi';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { extractBaseName } from './common';
import { Logger } from '../utils/logger';
import { Codemod, FinalOptions } from '../codemod';
import { getLanguageFromPath } from '../utils/ast-utils';

/**
 * Analyze which mixins are actually used by models (directly or transitively)
 */
export function analyzeModelMixinUsage(codemod: Codemod, options: FinalOptions): Set<string> {
  const modelMixins = new Set<string>();
  const mixinDependencies = new Map<string, Set<string>>();
  const mixinFiles = Object.keys(codemod.input.mixins);

  const logger = codemod.logger;
  logger.info(`🔍 Analyzing mixin usage relationships...`);

  // Analyze model files for direct mixin usage AND polymorphic relationships
  let modelsProcessed = 0;
  for (const [modelFile, modelInput] of codemod.input.models) {
    try {
      // Extract direct mixin imports (including from .extend() calls)
      const mixinsUsedByModel = extractMixinImports(modelInput.code, modelFile, logger, options);

      modelsProcessed++;
      logger.debug(`📊 Analyzed ${modelsProcessed}/${codemod.input.models.size} models...`);

      for (const mixinPath of mixinsUsedByModel) {
        modelMixins.add(mixinPath);
        logger.debug(`📋 Model ${modelFile} uses mixin ${mixinPath}`);
      }

      // Also check for polymorphic relationships that reference mixins
      const polymorphicMixins = extractPolymorphicMixinReferences(
        modelInput.code,
        modelFile,
        mixinFiles,
        logger,
        options
      );
      if (polymorphicMixins.length > 0) {
        logger.debug(`🔍 Found ${polymorphicMixins.length} polymorphic mixin references in ${modelFile}`);
      } else if (modelFile.includes('share-record')) {
        logger.info(`🔍 No polymorphic references found in share-record, checking why...`);
      }
      for (const mixinPath of polymorphicMixins) {
        modelMixins.add(mixinPath);
        logger.info(`📋 Model ${modelFile} has polymorphic relationship to mixin ${mixinPath}`);
      }

      // Check for type-only mixin imports (import type { MixinName } from 'path')
      const typeOnlyMixins = extractTypeOnlyMixinReferences(modelInput.code, modelFile, mixinFiles, logger, options);
      for (const mixinPath of typeOnlyMixins) {
        modelMixins.add(mixinPath);
        logger.debug(`📋 Model ${modelFile} has type-only reference to mixin ${mixinPath}`);
      }

      if (
        options.verbose &&
        mixinsUsedByModel.length === 0 &&
        polymorphicMixins.length === 0 &&
        typeOnlyMixins.length === 0
      ) {
        logger.info(`📋 Model ${modelFile} uses no mixins`);
      }
    } catch (error) {
      logger.error(`❌ Error analyzing model ${modelFile}: ${String(error)}`);
    }
  }

  // Analyze mixin files for their dependencies on other mixins
  for (const [mixinFile, mixinInput] of codemod.input.mixins) {
    try {
      const mixinsUsedByMixin = extractMixinImports(mixinInput.code, mixinFile, logger, options);
      mixinDependencies.set(mixinFile, new Set(mixinsUsedByMixin));

      if (options.verbose && mixinsUsedByMixin.length > 0) {
        logger.info(`📋 Mixin ${mixinFile} uses mixins: ${mixinsUsedByMixin.join(', ')}`);
      }
    } catch (error) {
      if (options.verbose) {
        logger.error(`❌ Error analyzing mixin ${mixinFile}: ${String(error)}`);
      }
    }
  }

  // Transitively find all mixins that are connected to models
  const transitiveModelMixins = new Set(modelMixins);
  let changed = true;

  while (changed) {
    changed = false;
    for (const [mixinFile, dependencies] of mixinDependencies) {
      if (transitiveModelMixins.has(mixinFile)) {
        // This mixin is connected to models, so all its dependencies are too
        for (const dep of dependencies) {
          if (!transitiveModelMixins.has(dep)) {
            transitiveModelMixins.add(dep);
            changed = true;
            if (options.verbose) {
              logger.info(`📋 Mixin ${dep} is transitively connected to models via ${mixinFile}`);
            }
          }
        }
      }
    }
  }

  if (options.verbose) {
    logger.info(
      `✅ Found ${transitiveModelMixins.size} mixins connected to models (${modelMixins.size} direct, ${transitiveModelMixins.size - modelMixins.size} transitive)`
    );
    logger.info(`📋 Model-connected mixins:`);
    for (const mixinPath of transitiveModelMixins) {
      logger.info(`   - ${mixinPath}`);
    }
  }

  return transitiveModelMixins;
}

/**
 * Extract mixin import paths from a source file using AST analysis
 */
function extractMixinImports(source: string, filePath: string, logger: Logger, finalOptions: FinalOptions): string[] {
  const mixinPaths: string[] = [];

  try {
    const lang = getLanguageFromPath(filePath);
    const ast = parse(lang, source);
    const root = ast.root();

    // Create a map of import identifiers to their source paths
    const importMap = new Map<string, string>();

    // Find all import statements
    const importStatements = root.findAll({ rule: { kind: 'import_statement' } });
    logger.debug(`[DEBUG] extractMixinImports for ${filePath}: found ${importStatements.length} import statements`);

    for (const importStatement of importStatements) {
      const sourceNode = importStatement.find({ rule: { kind: 'string' } });
      if (!sourceNode) {
        logger.debug(`[DEBUG] Import statement has no string literal: ${importStatement.text()}`);
        continue;
      }

      const importPath = sourceNode.text().replace(/['"]/g, '');
      logger.debug(`[DEBUG] Processing import: ${importPath}`);

      // Find the imported identifier(s)
      const importClause = importStatement.find({ rule: { kind: 'import_clause' } });
      if (!importClause) {
        logger.debug(`[DEBUG] Import has no clause: ${importStatement.text()}`);
        continue;
      }

      // Handle default imports (import Foo from 'path')
      const identifier = importClause.find({ rule: { kind: 'identifier' } });
      if (identifier) {
        const identifierName = identifier.text();
        logger.debug(`[DEBUG] Found default import: ${identifierName} from ${importPath}`);
        importMap.set(identifierName, importPath);
        continue;
      }

      // Handle named imports (import { Foo, Bar } from 'path')
      const namedImports = importClause.find({ rule: { kind: 'named_imports' } });
      if (namedImports) {
        const specifiers = namedImports.findAll({ rule: { kind: 'import_specifier' } });
        logger.debug(`[DEBUG] Found ${specifiers.length} named imports from ${importPath}`);
        for (const specifier of specifiers) {
          const name = specifier.find({ rule: { kind: 'identifier' } });
          if (name) {
            const identifierName = name.text();
            logger.debug(`[DEBUG] Named import: ${identifierName} from ${importPath}`);
            importMap.set(identifierName, importPath);
          }
        }
      }
    }

    logger.debug(`[DEBUG] Built import map with ${importMap.size} entries:`);
    for (const [identifier, importPath] of importMap) {
      logger.debug(`[DEBUG]   ${identifier} -> ${importPath}`);
    }

    // Check all imports to see if they resolve to mixin files
    for (const [, importPath] of importMap) {
      const resolved = resolveMixinPath(importPath, filePath, logger, finalOptions);
      logger.debug(`[DEBUG] resolveMixinPath(${importPath}): ${resolved || 'null'}`);
      if (resolved) {
        mixinPaths.push(resolved);
      }
    }

    // Look for .extend() calls and check if they use any imported mixins
    const extendCalls = root.findAll({
      rule: {
        kind: 'call_expression',
        has: {
          kind: 'member_expression',
          has: {
            field: 'property',
            kind: 'property_identifier',
            regex: 'extend',
          },
        },
      },
    });

    logger.debug(`[DEBUG] Found ${extendCalls.length} extend calls`);

    for (const extendCall of extendCalls) {
      logger.debug(`[DEBUG] Extend call: ${extendCall.text()}`);
      const args = extendCall.find({ rule: { kind: 'arguments' } });
      if (!args) {
        logger.debug(`[DEBUG] Extend call has no arguments`);
        continue;
      }

      // Find identifiers in the extend arguments
      const identifiers = args.findAll({ rule: { kind: 'identifier' } });
      logger.debug(`[DEBUG] Found ${identifiers.length} identifiers in extend args`);

      for (const identifier of identifiers) {
        const identifierName = identifier.text();
        logger.debug(`[DEBUG] Checking identifier: ${identifierName}`);
        const importPath = importMap.get(identifierName);

        if (importPath) {
          logger.debug(`[DEBUG] Identifier ${identifierName} maps to import ${importPath}`);
          const resolved = resolveMixinPath(importPath, filePath, logger, finalOptions);
          logger.debug(`[DEBUG] resolveMixinPath result: ${resolved || 'null'}`);
          if (resolved) {
            mixinPaths.push(resolved);
          }
        } else {
          logger.debug(`[DEBUG] Identifier ${identifierName} not found in import map`);
        }
      }
    }

    const finalPaths = [...new Set(mixinPaths)];
    logger.debug(`[DEBUG] Final mixin paths: [${finalPaths.join(', ')}]`);
    return finalPaths; // Remove duplicates
  } catch (error) {
    logger.debug(`Error extracting mixin imports from ${filePath}: ${String(error)}`);
    return [];
  }
}

/**
 * Resolve a mixin import path to an absolute file path
 */
function resolveMixinPath(
  importPath: string,
  currentFilePath: string,
  logger: Logger,
  options: FinalOptions
): string | null {
  try {
    // Handle relative paths
    if (importPath.startsWith('.')) {
      const resolvedPath = resolve(dirname(currentFilePath), importPath);
      const possiblePaths = [resolvedPath, `${resolvedPath}.js`, `${resolvedPath}.ts`];

      const mixinSourceDir = resolve(options.mixinSourceDir || './app/mixins');

      for (const path of possiblePaths) {
        if (existsSync(path)) {
          // Check if this resolved path is within the mixins source directory
          if (path.startsWith(mixinSourceDir)) {
            return path;
          }
          break;
        }
      }

      return null;
    }

    // Handle external/package imports using additionalMixinSources
    if (options.additionalMixinSources) {
      logger.debug(
        `📋 Trying to resolve external import '${importPath}' using ${options.additionalMixinSources.length} additional sources`
      );

      for (const source of options.additionalMixinSources) {
        // Convert glob pattern to regex
        const patternRegex = new RegExp('^' + source.pattern.replace(/\*/g, '(.*)') + '$');

        logger.debug(`📋 Testing pattern '${source.pattern}' (regex: ${patternRegex}) against import '${importPath}'`);

        const match = importPath.match(patternRegex);
        if (match) {
          // Replace the matched wildcards in the directory path
          let targetDir = source.dir;
          for (let i = 1; i < match.length; i++) {
            targetDir = targetDir.replace('*', match[i]);
          }

          // Try different extensions
          const possiblePaths = [targetDir, `${targetDir}.js`, `${targetDir}.ts`];

          logger.debug(`📋 Trying to resolve external mixin '${importPath}' to '${targetDir}'`);

          for (const path of possiblePaths) {
            if (existsSync(path)) {
              logger.debug(`📋 Successfully resolved '${importPath}' to '${path}'`);
              return path;
            }
          }
        }
      }
    }

    // If not found in external sources, try to resolve in local mixins directory
    const mixinSourceDir = resolve(options.mixinSourceDir || './app/mixins');

    // For local module imports like 'my-app/mixins/foo', extract just the last part
    const localMixinPath = importPath.includes('/mixins/') ? importPath.split('/mixins/')[1] : importPath;

    const localResolvedPath = resolve(mixinSourceDir, localMixinPath);
    const possiblePaths = [localResolvedPath, `${localResolvedPath}.js`, `${localResolvedPath}.ts`];

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        logger.debug(`📋 Successfully resolved local mixin '${importPath}' to '${path}'`);
        return path;
      }
    }

    logger.debug(`📋 Could not resolve mixin path '${importPath}'`);

    return null;
  } catch (error) {
    logger.debug(`📋 DEBUG: Error resolving path '${importPath}': ${String(error)}`);
    return null;
  }
}

/**
 * Extract polymorphic mixin references from model relationships
 */
function extractPolymorphicMixinReferences(
  source: string,
  filePath: string,
  mixinFiles: string[],
  logger: Logger,
  options: FinalOptions
): string[] {
  const polymorphicMixins: string[] = [];

  try {
    const lang = getLanguageFromPath(filePath);
    const ast = parse(lang, source);
    const root = ast.root();

    // Find all decorator nodes (for @belongsTo syntax)
    const decorators = root.findAll({ rule: { kind: 'decorator' } });

    logger.debug(`Found ${decorators.length} decorators in ${filePath}`);

    for (const decorator of decorators) {
      const decoratorText = decorator.text();
      if (!decoratorText.includes('belongsTo')) continue;

      // Extract the call expression from the decorator
      const callExpr = decorator.find({ rule: { kind: 'call_expression' } });
      if (!callExpr) continue;

      const args = callExpr.field('arguments');
      if (!args) continue;

      // Get the string and object arguments directly
      const stringArgs = args.findAll({ rule: { kind: 'string' } });
      const objectArgs = args.findAll({ rule: { kind: 'object' } });

      if (stringArgs.length < 1) continue;

      const typeName = stringArgs[0].text().replace(/['"]/g, '');

      // Check if there's an object argument with polymorphic: true
      if (objectArgs.length >= 1) {
        const optionsText = objectArgs[0].text();
        if (optionsText.includes('polymorphic') && optionsText.includes('true')) {
          // This is a polymorphic relationship - check if the type matches a mixin
          for (const mixinFile of mixinFiles) {
            const mixinName = extractBaseName(mixinFile);
            if (mixinName === typeName) {
              if (!polymorphicMixins.includes(mixinFile)) {
                polymorphicMixins.push(mixinFile);
                logger.debug(`Found polymorphic reference to mixin '${typeName}' in ${filePath}`);
              }
              break;
            }
          }
        }
      }
    }

    // Also check for regular function calls (non-decorator syntax)
    const callExpressions = root.findAll({ rule: { kind: 'call_expression' } });

    for (const call of callExpressions) {
      const fn = call.field('function');
      if (!fn) continue;

      // Check if this is a belongsTo call (but not inside a decorator, which we already handled)
      const fnText = fn.text();
      if (!fnText.includes('belongsTo')) continue;

      // Skip if this call is inside a decorator (already handled above)
      const parentDecorator = call.parent()?.parent();
      if (parentDecorator && parentDecorator.kind() === 'decorator') continue;

      const args = call.field('arguments');
      if (!args) continue;

      // Get the string and object arguments directly
      const stringArgs = args.findAll({ rule: { kind: 'string' } });
      const objectArgs = args.findAll({ rule: { kind: 'object' } });

      if (stringArgs.length < 1) continue;

      const typeName = stringArgs[0].text().replace(/['"]/g, '');

      // Check if there's an object argument with polymorphic: true
      if (objectArgs.length >= 1) {
        const optionsText = objectArgs[0].text();
        if (optionsText.includes('polymorphic') && optionsText.includes('true')) {
          // This is a polymorphic relationship - check if the type matches a mixin
          for (const mixinFile of mixinFiles) {
            const mixinName = extractBaseName(mixinFile);
            if (mixinName === typeName) {
              if (!polymorphicMixins.includes(mixinFile)) {
                polymorphicMixins.push(mixinFile);
                if (options.verbose) {
                  logger.debug(`Found polymorphic reference to mixin '${typeName}' in ${filePath}`);
                }
              }
              break;
            }
          }
        }
      }
    }
  } catch (error) {
    logger.debug(`Error extracting polymorphic mixin references from ${filePath}: ${String(error)}`);
  }

  return polymorphicMixins;
}

/**
 * Extract mixins referenced via type-only imports (import type { MixinName } from 'path')
 * These are often used for type annotations without actually extending the mixin
 */
function extractTypeOnlyMixinReferences(
  source: string,
  filePath: string,
  mixinFiles: string[],
  logger: Logger,
  options: FinalOptions
): string[] {
  const typeOnlyMixins: string[] = [];

  try {
    const lang = getLanguageFromPath(filePath);
    const ast = parse(lang, source);
    const root = ast.root();

    // Find all import statements
    const importStatements = root.findAll({ rule: { kind: 'import_statement' } });

    for (const importStatement of importStatements) {
      const importText = importStatement.text();

      // Check if this is a type-only import (import type ...)
      if (!importText.includes('import type')) continue;

      const sourceNode = importStatement.find({ rule: { kind: 'string' } });
      if (!sourceNode) continue;

      const importPath = sourceNode.text().replace(/['"]/g, '');

      // Check if this import path resolves to a mixin file
      const resolved = resolveMixinPath(importPath, filePath, logger, options);
      if (resolved && mixinFiles.includes(resolved)) {
        if (!typeOnlyMixins.includes(resolved)) {
          typeOnlyMixins.push(resolved);
          logger.debug(`Found type-only mixin reference: ${importPath} -> ${resolved}`);
        }
      }
    }
  } catch (error) {
    logger.debug(`Error extracting type-only mixin references from ${filePath}: ${String(error)}`);
  }

  return typeOnlyMixins;
}
