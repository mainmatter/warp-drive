import type { SgNode } from '@ast-grep/napi';
import { Lang, parse } from '@ast-grep/napi';

import type { TransformOptions } from '../config.js';
import { parseObjectPropertiesFromNode } from './ast-helpers.js';
import { debugLog } from './logging.js';
import { removeQuotes, toPascalCase } from './path-utils.js';
import type { ExtractedType } from './type-utils.js';

/**
 * Parse an object literal from an AST node directly
 * Wrapper around parseObjectPropertiesFromNode with error handling
 */
function parseObjectLiteralFromNodeInternal(objectNode: SgNode): Record<string, unknown> {
  try {
    return parseObjectPropertiesFromNode(objectNode);
  } catch {
    // Return empty object if parsing fails
    return {};
  }
}

/**
 * Shared artifact interface for both transforms
 */
export interface TransformArtifact {
  /** Type determines output directory routing */
  type: string;
  /** Suggested export name */
  name: string;
  /** Code to write to the artifact file */
  code: string;
  /** Suggested filename (without directory) */
  suggestedFileName: string;
}

/**
 * Interface for property information including TypeScript types
 */
export interface PropertyInfo {
  name: string;
  originalKey: string;
  value: string;
  /** Extracted TypeScript type information */
  typeInfo?: ExtractedType;
  /** Whether this property is defined using object method syntax */
  isObjectMethod?: boolean;
}

/**
 * Interface for schema field information
 * Shared between model-to-schema and mixin-to-schema transforms
 */
export interface SchemaField {
  name: string;
  kind: 'attribute' | 'belongsTo' | 'hasMany' | 'schema-object' | 'schema-array' | 'array';
  type?: string;
  options?: Record<string, unknown>;
  comment?: string;
}

/**
 * Map EmberData decorator names to WarpDrive field kinds
 * Shared between model-to-schema and mixin-to-schema transforms
 */
export function getFieldKindFromDecorator(decoratorName: string): string {
  switch (decoratorName) {
    case 'hasMany':
      return 'hasMany';
    case 'belongsTo':
      return 'belongsTo';
    case 'attr':
      return 'attribute';
    case 'fragment':
      return 'schema-object';
    case 'fragmentArray':
      return 'schema-array';
    case 'array':
      return 'array';
    default:
      return 'field'; // fallback
  }
}

/**
 * Generate an export statement with a JSON object
 * Shared pattern used by both model-to-schema and mixin-to-schema transforms
 */
export function generateExportStatement(
  exportName: string,
  jsonObject: Record<string, unknown>,
  useSingleQuotes = false
): string {
  // JSON.stringify handles quoting correctly - strings are quoted, booleans/numbers are not
  let jsonString = JSON.stringify(jsonObject, null, 2);

  // Convert all double quotes to single quotes if using single quotes
  if (useSingleQuotes) {
    // Replace all double quotes with single quotes, but be careful with escaped quotes
    jsonString = jsonString.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, "'$1'");
  }

  return `export const ${exportName} = ${jsonString};`;
}

/**
 * Convert a SchemaField to the legacy schema field format
 * Shared between model-to-schema and mixin-to-schema transforms
 */
export function schemaFieldToLegacyFormat(field: SchemaField): Record<string, unknown> {
  const schemaField: Record<string, unknown> = {
    kind: field.kind,
    name: field.name,
  };

  if (field.type) {
    schemaField.type = field.type;
  }

  if (field.options && Object.keys(field.options).length > 0) {
    schemaField.options = field.options;
  }

  return schemaField;
}

/**
 * Build the core legacy schema object structure
 * Shared between model-to-schema and mixin-to-schema transforms
 */
export function buildLegacySchemaObject(
  type: string,
  schemaFields: SchemaField[],
  mixinTraits: string[],
  mixinExtensions: string[],
  isFragment?: boolean
): Record<string, unknown> {
  const legacySchema: Record<string, unknown> = {
    type: isFragment ? `fragment:${type}` : type,
    legacy: true,
    identity: isFragment ? null : { kind: '@id', name: 'id' },
    fields: schemaFields.map(schemaFieldToLegacyFormat),
  };

  if (mixinTraits.length > 0) {
    legacySchema.traits = mixinTraits;
  }

  // For Fragment classes, always add objectExtensions ['ember-object', 'fragment']
  // Otherwise, only add mixinExtensions if they exist
  if (isFragment) {
    const fragmentExtensions = ['ember-object', 'fragment'];
    legacySchema.objectExtensions =
      mixinExtensions.length > 0 ? [...fragmentExtensions, ...mixinExtensions] : fragmentExtensions;
  } else if (mixinExtensions.length > 0) {
    legacySchema.objectExtensions = mixinExtensions;
  }

  return legacySchema;
}

/**
 * Generate trait schema code
 * Shared between model-to-schema and mixin-to-schema transforms
 */
export function generateTraitSchemaCode(
  traitName: string,
  traitBaseName: string,
  schemaFields: SchemaField[],
  mixinTraits: string[]
): string {
  const trait: Record<string, unknown> = {
    fields: schemaFields.map(schemaFieldToLegacyFormat),
  };

  if (mixinTraits.length > 0) {
    trait.traits = mixinTraits;
  }

  return generateExportStatement(traitName, trait);
}

/**
 * Parse options object from an AST node for schema field conversion
 * Returns the parsed options object
 */
function parseSchemaFieldOptions(optionsNode: SgNode | undefined): Record<string, unknown> {
  if (!optionsNode || optionsNode.kind() !== 'object') {
    return {};
  }

  try {
    return parseObjectLiteralFromNodeInternal(optionsNode);
  } catch {
    return {};
  }
}

/**
 * Core implementation for converting EmberData decorator calls to schema fields
 * This is the shared logic used by the schema field conversion function
 */
function convertToSchemaFieldCore(
  name: string,
  decoratorType: string,
  firstArg: string | undefined,
  options: Record<string, unknown>
): SchemaField | null {
  switch (decoratorType) {
    case 'attr': {
      const type = firstArg ? removeQuotes(firstArg) : undefined;
      return {
        name,
        kind: getFieldKindFromDecorator('attr') as 'attribute',
        type,
        options: Object.keys(options).length > 0 ? options : undefined,
      };
    }
    case 'belongsTo': {
      const type = firstArg ? removeQuotes(firstArg) : undefined;
      return {
        name,
        kind: getFieldKindFromDecorator('belongsTo') as 'belongsTo',
        type,
        options: Object.keys(options).length > 0 ? options : undefined,
      };
    }
    case 'hasMany': {
      const type = firstArg ? removeQuotes(firstArg) : undefined;
      return {
        name,
        kind: getFieldKindFromDecorator('hasMany') as 'hasMany',
        type,
        options: Object.keys(options).length > 0 ? options : undefined,
      };
    }
    case 'fragment': {
      const fragmentType = firstArg ? removeQuotes(firstArg) : name;
      return {
        name,
        kind: getFieldKindFromDecorator('fragment') as 'schema-object',
        type: `fragment:${fragmentType}`,
        options: {
          objectExtensions: ['ember-object', 'fragment'],
          ...options,
        },
      };
    }
    case 'fragmentArray': {
      const fragmentType = firstArg ? removeQuotes(firstArg) : name;
      return {
        name,
        kind: getFieldKindFromDecorator('fragmentArray') as 'schema-array',
        type: `fragment:${fragmentType}`,
        options: {
          arrayExtensions: ['ember-object', 'ember-array-like', 'fragment-array'],
          defaultValue: true,
          ...options,
        },
      };
    }
    case 'array': {
      // For array decorator, options are passed directly
      return {
        name,
        kind: getFieldKindFromDecorator('array') as 'array',
        type: `array:${name}`, // Will be singularized during schema generation
        options: {
          arrayExtensions: ['ember-object', 'ember-array-like', 'fragment-array'],
          ...options,
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Convert EmberData decorator call to schema field using AST nodes
 */
export function convertToSchemaField(
  name: string,
  decoratorType: string,
  args: { text: string[]; nodes: SgNode[] }
): SchemaField | null {
  // For 'array' decorator, the first arg is options (not type), so we need special handling
  const isArrayDecorator = decoratorType === 'array';
  const firstArg = isArrayDecorator ? undefined : args.text[0];
  const optionsArg = isArrayDecorator ? args.nodes[0] : args.nodes[1];
  const options = parseSchemaFieldOptions(optionsArg);

  return convertToSchemaFieldCore(name, decoratorType, firstArg, options);
}

/**
 * Generate TypeScript interface code
 */
export function generateInterfaceCode(
  interfaceName: string,
  properties: Array<{
    name: string;
    type: string;
    readonly?: boolean;
    optional?: boolean;
    comment?: string;
  }>,
  extendsClause?: string,
  imports?: string[]
): string {
  const lines: string[] = [];

  // Add imports
  if (imports && imports.length > 0) {
    imports.forEach((importStatement) => {
      // Check if the import statement already includes the 'import' keyword
      if (importStatement.startsWith('import ')) {
        lines.push(`${importStatement};`);
      } else {
        lines.push(`import ${importStatement};`);
      }
    });
    lines.push('');
  }

  // Add interface declaration
  let interfaceDeclaration = `export interface ${interfaceName}`;
  if (extendsClause) {
    interfaceDeclaration += ` extends ${extendsClause}`;
  }
  interfaceDeclaration += ' {';
  lines.push(interfaceDeclaration);

  // Add properties
  properties.forEach((prop) => {
    if (prop.comment) {
      // Wrap comment in JSDoc format if not already formatted
      const formattedComment = prop.comment.startsWith('/**') ? prop.comment : `/** ${prop.comment} */`;
      lines.push(`	${formattedComment}`);
    }

    const readonly = prop.readonly ? 'readonly ' : '';
    const optional = prop.optional ? '?' : '';

    lines.push(`	${readonly}${prop.name}${optional}: ${prop.type};`);
  });

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate JSDoc interface for JavaScript files
 */
export function generateJSDocInterface(
  interfaceName: string,
  properties: Array<{
    name: string;
    type: string;
    readonly?: boolean;
    optional?: boolean;
    comment?: string;
  }>
): string {
  const lines: string[] = [];

  lines.push('/**');
  lines.push(` * @typedef {Object} ${interfaceName}`);

  for (const prop of properties) {
    const optional = prop.optional ? '?' : '';
    const readonly = prop.readonly ? 'readonly ' : '';
    const comment = prop.comment ? ` - ${prop.comment}` : '';
    lines.push(` * @property {${prop.type}} ${readonly}${prop.name}${optional}${comment}`);
  }

  lines.push(' */');
  lines.push('');

  return lines.join('\n');
}

/**
 * Create type artifact for interfaces
 */
export function createTypeArtifact(
  baseName: string,
  interfaceName: string,
  properties: Array<{
    name: string;
    type: string;
    readonly?: boolean;
    optional?: boolean;
    comment?: string;
  }>,
  artifactContext?: 'resource' | 'extension' | 'trait',
  extendsClause?: string,
  imports?: string[],
  fileExtension?: string
): TransformArtifact {
  const code = generateInterfaceCode(interfaceName, properties, extendsClause, imports);

  // Determine the type based on context to help with directory routing
  const typeString = artifactContext ? `${artifactContext}-type` : 'type';

  // Generate filename - use .schema.types for all artifact types for consistency
  const extension = fileExtension || '.ts';
  const fileName =
    artifactContext === 'extension'
      ? `${baseName}${extension}` // Extensions don't need .types suffix
      : `${baseName}.schema.types${extension}`; // Use .schema.types for schemas and traits

  return {
    type: typeString,
    name: interfaceName,
    code,
    suggestedFileName: fileName,
  };
}

/**
 * Create extension artifact if extension properties exist
 * Shared utility for consistent extension artifact generation
 */
export function createExtensionArtifact(
  baseName: string,
  entityName: string,
  extensionProperties: Array<{ name: string; originalKey: string; value: string; isObjectMethod?: boolean }>,
  extensionFormat: 'class' | 'object',
  fileExtension?: string,
  generateExtensionCode?: (
    name: string,
    props: Array<{ name: string; originalKey: string; value: string; isObjectMethod?: boolean }>,
    format: 'object' | 'class'
  ) => string
): TransformArtifact | null {
  if (extensionProperties.length === 0) {
    return null;
  }

  const extensionName = `${entityName}Extension`;

  // Use provided generator or create a simple fallback
  const generator =
    generateExtensionCode ||
    ((name, props, format) => {
      if (format === 'class') {
        const methods = props.map((p) => `  ${p.value}`).join('\n\n');
        return `export class ${name} {\n${methods}\n}`;
      }
      const properties = props.map((p) => `  ${p.originalKey}: ${p.value}`).join(',\n');
      return `export const ${name} = {\n${properties}\n};`;
    });

  const extensionCode = generator(extensionName, extensionProperties, extensionFormat);

  return {
    type: 'extension',
    name: extensionName,
    code: extensionCode,
    suggestedFileName: `${baseName}${fileExtension || '.ts'}`,
  };
}

/**
 * Create extension and type artifacts for properties with TypeScript types
 */
export function createExtensionArtifactWithTypes(
  baseName: string,
  entityName: string,
  extensionProperties: PropertyInfo[],
  extensionFormat: 'class' | 'object',
  fileExtension?: string,
  generateExtensionCode?: (
    name: string,
    props: Array<{ name: string; originalKey: string; value: string; isObjectMethod?: boolean }>,
    format: 'object' | 'class'
  ) => string
): { extensionArtifact: TransformArtifact | null; typeArtifact: TransformArtifact | null } {
  if (extensionProperties.length === 0) {
    return { extensionArtifact: null, typeArtifact: null };
  }

  const extensionName = entityName.endsWith('Extension') ? entityName : `${entityName}Extension`;

  // Use provided generator or create a simple fallback
  const generator =
    generateExtensionCode ||
    ((name, props, format) => {
      if (format === 'class') {
        const methods = props.map((p) => `  ${p.value}`).join('\n\n');
        return `export class ${name} {\n${methods}\n}`;
      }
      const properties = props.map((p) => `  ${p.originalKey}: ${p.value}`).join(',\n');
      return `export const ${name} = {\n${properties}\n};`;
    });

  // Create the extension artifact (JavaScript code)
  const extensionCode = generator(extensionName, extensionProperties, extensionFormat);
  const extensionArtifact: TransformArtifact = {
    type: 'extension',
    name: extensionName,
    code: extensionCode,
    suggestedFileName: `${baseName}${fileExtension || '.ts'}`,
  };

  // Create the type artifact (TypeScript interface)
  const hasTypes = extensionProperties.some((prop) => prop.typeInfo?.type);
  if (hasTypes) {
    // Transform PropertyInfo to the format expected by createTypeArtifact
    const typeProperties = extensionProperties
      .filter((prop): prop is PropertyInfo & { typeInfo: ExtractedType } => Boolean(prop.typeInfo?.type))
      .map((prop) => ({
        name: prop.name,
        type: prop.typeInfo.type,
        readonly: prop.typeInfo.readonly,
        optional: prop.typeInfo.optional,
        // comment field is optional and not provided by ExtractedType
      }));

    const typeArtifact = createTypeArtifact(baseName, `${extensionName}Signature`, typeProperties, 'extension');
    return { extensionArtifact, typeArtifact };
  }

  return { extensionArtifact, typeArtifact: null };
}
