import type { Lang } from '@ast-grep/napi';
import { Lang as AstLang } from '@ast-grep/napi';

/**
 * Extract the file name (without extension) from a file path
 */
function extractFileNameWithoutExtension(filePath: string): string {
  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown';
  return fileName.replace(/\.(js|ts)$/, '');
}

/**
 * Extract kebab-case base name (without extension) from a file path
 */
export function extractBaseName(filePath: string): string {
  return extractFileNameWithoutExtension(filePath);
}

/**
 * Extract camelCase name from file path (kebab-case to camelCase conversion)
 */
export function extractCamelCaseName(filePath: string): string {
  const baseName = extractFileNameWithoutExtension(filePath);

  // Convert kebab-case to camelCase for valid JavaScript identifier
  // test-plannable -> testPlannable
  return baseName.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * Convert kebab-case to PascalCase for model/mixin names
 * user-profile -> UserProfile
 */
export function extractPascalCaseName(filePath: string): string {
  const baseName = extractFileNameWithoutExtension(filePath);

  return baseName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Convert kebab-case or snake_case to PascalCase
 */
export function toPascalCase(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase())
    .replace(/\s+/g, '');
}

/**
 * Convert mixin name to trait name (e.g., "BaseModelMixin" -> "baseModel")
 * When forStringReference is true, returns dasherized format (e.g., "base-model")
 * Handles both mixin names and import paths
 */
export function mixinNameToTraitName(mixinNameOrPath: string, forStringReference = false): string {
  let traitName = mixinNameOrPath;

  // If this looks like a file path, extract the base name
  if (traitName.includes('/') || traitName.includes('\\')) {
    const fileName = traitName.split('/').pop() || traitName.split('\\').pop() || traitName;
    traitName = fileName.replace(/\.(js|ts)$/, '');

    // Convert kebab-case file name to PascalCase
    traitName = traitName
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  if (traitName.endsWith('Mixin')) {
    traitName = traitName.slice(0, -5); // Remove 'Mixin' suffix
  }

  if (forStringReference) {
    // Convert PascalCase to kebab-case for string references
    return traitName
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, ''); // Remove leading dash if present
  }

  // Convert PascalCase to camelCase for const names
  const baseName = traitName.charAt(0).toLowerCase() + traitName.slice(1);
  return baseName;
}

/**
 * Remove surrounding quotes from a string (single or double quotes)
 */
export function removeQuotes(text: string): string {
  return text.replace(/^['"]|['"]$/g, '');
}

/**
 * Determine AST language from file path
 */
export function getLanguageFromPath(filePath: string): Lang {
  if (filePath.endsWith('.ts')) {
    return AstLang.TypeScript;
  } else if (filePath.endsWith('.js')) {
    return AstLang.JavaScript;
  }

  // Default to TypeScript for unknown extensions
  return AstLang.TypeScript;
}

/**
 * Extract file extension from path (.js or .ts)
 */
export function getFileExtension(filePath: string): string {
  if (filePath.endsWith('.ts')) {
    return '.ts';
  } else if (filePath.endsWith('.js')) {
    return '.js';
  }

  // Default to .ts for unknown extensions
  return '.ts';
}

/**
 * Properly indent code while preserving existing indentation structure
 */
export function indentCode(code: string, indentLevel = 1): string {
  const indent = '  '.repeat(indentLevel);
  return code
    .split('\n')
    .map((line, index) => {
      if (index === 0) {
        return `${indent}${line}`;
      }
      // Preserve empty lines and existing indentation
      return line ? `${indent}${line}` : line;
    })
    .join('\n');
}

/**
 * Detect the predominant quote style in a source file
 */
export function detectQuoteStyle(source: string): 'single' | 'double' {
  // Count occurrences of single and double quotes in import/export statements
  const singleQuoteMatches = source.match(/import\s+.*?from\s+'[^']+'/g) || [];
  const doubleQuoteMatches = source.match(/import\s+.*?from\s+"[^"]+"/g) || [];

  // Default to single quotes if more single quotes are found (or equal)
  return singleQuoteMatches.length >= doubleQuoteMatches.length ? 'single' : 'double';
}
