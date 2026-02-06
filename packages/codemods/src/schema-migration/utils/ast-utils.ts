/**
 * AST Utilities Module
 *
 * This module re-exports utilities from focused sub-modules for backward compatibility.
 * The implementation has been split into the following modules:
 *
 * - logging.ts: Debug and error logging utilities
 * - path-utils.ts: Path manipulation, case conversion, and file utilities
 * - type-utils.ts: TypeScript type extraction and generation
 * - ast-helpers.ts: AST parsing, traversal, and object literal parsing
 * - schema-generation.ts: Schema field and artifact generation
 * - import-utils.ts: Import resolution and transformation
 * - extension-generation.ts: Extension artifact creation
 */

// Re-export from logging
export { debugLog, errorLog } from './logging.js';

// Re-export from path-utils
export {
  extractBaseName,
  extractCamelCaseName,
  extractPascalCaseName,
  toPascalCase,
  mixinNameToTraitName,
  removeQuotes,
  getLanguageFromPath,
  getFileExtension,
  indentCode,
} from './path-utils.js';

// Re-export from type-utils
export {
  DEFAULT_EMBER_DATA_SOURCE,
  DEFAULT_MIXIN_SOURCE,
  BUILT_IN_TYPE_MAPPINGS,
  getTypeScriptTypeForAttribute,
  getTypeScriptTypeForBelongsTo,
  getTypeScriptTypeForHasMany,
  schemaFieldToTypeScriptType,
  extractImportsFromType,
  extractTypeFromDeclaration,
  extractTypeFromDecorator,
  extractTypeFromMethod,
  extractTypesFromInterface,
} from './type-utils.js';
export type { ExtractedType, SchemaFieldForType } from './type-utils.js';

// Re-export from ast-helpers
export {
  findExportStatements,
  findDefaultExport,
  findClassDeclaration,
  getExportedIdentifier,
  parseDecoratorArgumentsWithNodes,
  parseObjectLiteralFromNode,
  parseObjectPropertiesFromNode,
  parseObjectLiteral,
  extractExistingImports,
  withTransformWrapper,
  findAssociatedInterface,
  getEmberDataImports,
  getMixinImports,
} from './ast-helpers.js';

// Re-export from schema-generation
export {
  getFieldKindFromDecorator,
  generateExportStatement,
  schemaFieldToLegacyFormat,
  buildLegacySchemaObject,
  generateTraitSchemaCode,
  convertToSchemaField,
  generateInterfaceCode,
  createTypeArtifact,
  createExtensionArtifact,
  createExtensionArtifactWithTypes,
  traitNameToInterfaceName,
  traitNameToImportPath,
  generateMergedSchemaCode,
  generateMergedTraitSchemaCode,
} from './schema-generation.js';
export type {
  TransformArtifact,
  PropertyInfo,
  SchemaField,
  MergedSchemaOptions,
  MergedTraitSchemaOptions,
} from './schema-generation.js';

// Re-export from import-utils
export {
  transformWarpDriveImport,
  generateWarpDriveTypeImport,
  generateCommonWarpDriveImports,
  generateTraitImport,
  getModelImportSource,
  getResourcesImport,
  transformModelToResourceImport,
  extractTypeNameMapping,
  isModelImportPath,
  isMixinImportPath,
  isSpecialMixinImport,
  resolveRelativeImport,
  isMixinFile,
  isModelFile,
  findEmberImportLocalName,
  processImports,
} from './import-utils.js';

// Re-export from extension-generation
export { generateExtensionCode, createExtensionFromOriginalFile } from './extension-generation.js';
