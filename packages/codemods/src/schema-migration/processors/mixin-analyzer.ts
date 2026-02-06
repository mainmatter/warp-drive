import { parse, type SgNode } from '@ast-grep/napi';
import { dirname, resolve } from 'path';

import type { Codemod } from '../codemod.js';
import type { FinalOptions } from '../config.js';
import { extractBaseName, getLanguageFromPath } from '../utils/ast-utils.js';
import {
  findCallExpressions,
  findDecorators,
  findIdentifiersInArguments,
  findImportStatements,
  findObjectArguments,
  findStringArguments,
  getCallArguments,
  getDefaultImportIdentifier,
  getImportClause,
  getImportSourcePath,
  getNamedImportIdentifiers,
  isInsideDecorator,
  isPolymorphicRelationship,
  isTypeOnlyImport,
  NODE_KIND_CALL_EXPRESSION,
  NODE_KIND_MEMBER_EXPRESSION,
  NODE_KIND_PROPERTY_IDENTIFIER,
} from '../utils/code-processing.js';
import type { Logger } from '../utils/logger.js';
import { getImportSourceConfig, resolveImportPath, resolveRelativeImport } from '../utils/path-utils.js';
import { removeQuoteChars } from '../utils/string.js';

/** The 'extend' method name used in Ember's class extension pattern */
const EXTEND_METHOD_NAME = 'extend';

/** The 'belongsTo' relationship decorator/function name */
const BELONGS_TO_NAME = 'belongsTo';

/**
 * Build a map of imported identifiers to their source paths
 */
function buildImportMap(root: SgNode, logger: Logger): Map<string, string> {
  const importMap = new Map<string, string>();
  const importStatements = findImportStatements(root);

  for (const importStatement of importStatements) {
    const importPath = getImportSourcePath(importStatement);
    if (!importPath) {
      logger.debug(`[DEBUG] Import statement has no string literal: ${importStatement.text()}`);
      continue;
    }

    logger.debug(`[DEBUG] Processing import: ${importPath}`);

    const importClause = getImportClause(importStatement);
    if (!importClause) {
      logger.debug(`[DEBUG] Import has no clause: ${importStatement.text()}`);
      continue;
    }

    // Handle default imports (import Foo from 'path')
    const defaultIdentifier = getDefaultImportIdentifier(importClause);
    if (defaultIdentifier) {
      logger.debug(`[DEBUG] Found default import: ${defaultIdentifier} from ${importPath}`);
      importMap.set(defaultIdentifier, importPath);
      continue;
    }

    // Handle named imports (import { Foo, Bar } from 'path')
    const namedIdentifiers = getNamedImportIdentifiers(importClause);
    if (namedIdentifiers.length > 0) {
      logger.debug(`[DEBUG] Found ${namedIdentifiers.length} named imports from ${importPath}`);
      for (const identifierName of namedIdentifiers) {
        logger.debug(`[DEBUG] Named import: ${identifierName} from ${importPath}`);
        importMap.set(identifierName, importPath);
      }
    }
  }

  return importMap;
}

/**
 * Find all .extend() call expressions in the AST
 */
function findExtendCalls(root: SgNode): SgNode[] {
  return root.findAll({
    rule: {
      kind: NODE_KIND_CALL_EXPRESSION,
      has: {
        kind: NODE_KIND_MEMBER_EXPRESSION,
        has: {
          field: 'property',
          kind: NODE_KIND_PROPERTY_IDENTIFIER,
          regex: EXTEND_METHOD_NAME,
        },
      },
    },
  });
}

/**
 * Check if a resolved path is within the mixin source directory
 */
function isInMixinSourceDir(resolvedPath: string | null, mixinSourceDir: string): boolean {
  return !!resolvedPath && resolvedPath.startsWith(mixinSourceDir);
}

export type connectedMixins = Set<string>;
export type modelToMixinsMap = Map<string, connectedMixins>;

export interface ModelMixinAnalysisResult {
  /** Set of all mixin file paths connected to models (directly or transitively) */
  connectedMixins: connectedMixins;
  /** Map of model file paths to the set of mixin file paths they use */
  modelToMixinsMap: modelToMixinsMap;
}

/**
 * Analyze which mixins are actually used by models (directly or transitively)
 * Returns both the set of connected mixins and a map of model -> mixin relationships
 */
export function analyzeModelMixinUsage(codemod: Codemod, options: FinalOptions): ModelMixinAnalysisResult {
  const modelMixins = new Set<string>();
  const mixinDependencies = new Map<string, Set<string>>();
  const mixinFiles = Object.keys(codemod.input.mixins);

  // Track which mixins each model uses directly
  const modelToMixinsMap = new Map<string, Set<string>>();

  const logger = codemod.logger;
  logger.info(`🔍 Analyzing mixin usage relationships...`);

  // Analyze model files for direct mixin usage AND polymorphic relationships
  let modelsProcessed = 0;
  for (const [modelFile, modelInput] of codemod.input.models) {
    const modelMixinsSet = new Set<string>();

    try {
      // Extract direct mixin imports (including from .extend() calls)
      const mixinsUsedByModel = extractMixinImports(modelInput.code, modelFile, logger, options);

      modelsProcessed++;
      logger.debug(`📊 Analyzed ${modelsProcessed}/${codemod.input.models.size} models...`);

      for (const mixinPath of mixinsUsedByModel) {
        modelMixins.add(mixinPath);
        modelMixinsSet.add(mixinPath);
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
        modelMixinsSet.add(mixinPath);
        logger.info(`📋 Model ${modelFile} has polymorphic relationship to mixin ${mixinPath}`);
      }

      // Check for type-only mixin imports (import type { MixinName } from 'path')
      const typeOnlyMixins = extractTypeOnlyMixinReferences(modelInput.code, modelFile, mixinFiles, logger, options);
      for (const mixinPath of typeOnlyMixins) {
        modelMixins.add(mixinPath);
        modelMixinsSet.add(mixinPath);
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

    // Store the mixins used by this model
    if (modelMixinsSet.size > 0) {
      modelToMixinsMap.set(modelFile, modelMixinsSet);
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
    logger.info(`📋 Model -> Mixins mapping:`);
    for (const [modelFile, mixins] of modelToMixinsMap) {
      logger.info(`   - ${modelFile}: ${[...mixins].join(', ')}`);
    }
  }

  return { connectedMixins: transitiveModelMixins, modelToMixinsMap };
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

    // Build import map
    const importMap = buildImportMap(root, logger);

    logger.debug(`[DEBUG] extractMixinImports for ${filePath}: found ${importMap.size} imports`);
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
    const extendCalls = findExtendCalls(root);
    logger.debug(`[DEBUG] Found ${extendCalls.length} extend calls`);

    for (const extendCall of extendCalls) {
      logger.debug(`[DEBUG] Extend call: ${extendCall.text()}`);
      const args = getCallArguments(extendCall);
      if (!args) {
        logger.debug(`[DEBUG] Extend call has no arguments`);
        continue;
      }

      // Find identifiers in the extend arguments
      const identifiers = findIdentifiersInArguments(args);
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
    const mixinSourceDir = resolve(options.mixinSourceDir || './app/mixins');
    const config = getImportSourceConfig('mixin', options);

    // Handle relative paths - must be within mixin source directory
    if (importPath.startsWith('.')) {
      const resolved = resolveRelativeImport(importPath, currentFilePath, process.cwd());
      if (isInMixinSourceDir(resolved, mixinSourceDir)) {
        return resolved;
      }
      return null;
    }

    // Use unified import path resolution
    const resolved = resolveImportPath(importPath, config);
    if (resolved) {
      return resolved;
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
    const decorators = findDecorators(root);
    logger.debug(`Found ${decorators.length} decorators in ${filePath}`);

    for (const decorator of decorators) {
      const decoratorText = decorator.text();
      if (!decoratorText.includes(BELONGS_TO_NAME)) continue;

      // Extract the call expression from the decorator
      const callExpr = decorator.find({ rule: { kind: NODE_KIND_CALL_EXPRESSION } });
      if (!callExpr) continue;

      const args = callExpr.field('arguments');
      if (!args) continue;

      // Get the string and object arguments directly
      const stringArgs = findStringArguments(args);
      const objectArgs = findObjectArguments(args);

      if (stringArgs.length < 1) continue;

      const typeName = removeQuoteChars(stringArgs[0].text());

      // Check if there's an object argument with polymorphic: true
      if (objectArgs.length >= 1) {
        const optionsText = objectArgs[0].text();
        if (isPolymorphicRelationship(optionsText)) {
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
    const callExpressions = findCallExpressions(root);

    for (const call of callExpressions) {
      const fn = call.field('function');
      if (!fn) continue;

      // Check if this is a belongsTo call (but not inside a decorator, which we already handled)
      const fnText = fn.text();
      if (!fnText.includes(BELONGS_TO_NAME)) continue;

      // Skip if this call is inside a decorator (already handled above)
      if (isInsideDecorator(call)) continue;

      const args = call.field('arguments');
      if (!args) continue;

      // Get the string and object arguments directly
      const stringArgs = findStringArguments(args);
      const objectArgs = findObjectArguments(args);

      if (stringArgs.length < 1) continue;

      const typeName = removeQuoteChars(stringArgs[0].text());

      // Check if there's an object argument with polymorphic: true
      if (objectArgs.length >= 1) {
        const optionsText = objectArgs[0].text();
        if (isPolymorphicRelationship(optionsText)) {
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
    const importStatements = findImportStatements(root);

    for (const importStatement of importStatements) {
      const importText = importStatement.text();

      // Check if this is a type-only import (import type ...)
      if (!isTypeOnlyImport(importText)) continue;

      const importPath = getImportSourcePath(importStatement);
      if (!importPath) continue;

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
