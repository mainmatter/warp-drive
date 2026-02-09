# Schema-Migration Refactoring Plan

This document identifies repetitive logic patterns across the schema-migration codemods and provides a roadmap for making the code DRY (Don't Repeat Yourself).

## Overview

The schema-migration codebase has grown organically, leading to several patterns of code duplication. This plan categorizes these duplications and proposes extraction strategies.

## Categories of Repetitive Logic

### 1. Import Path Resolution and Matching

#### Pattern Description
Multiple functions implement similar logic for:
- Checking if import paths match expected patterns
- Resolving relative imports to absolute paths
- Pattern matching with wildcards
- Converting import sources to file system paths

#### Occurrences

**File: `processors/mixin-analyzer.ts`** (lines 84-117)
```typescript
function resolveRelativeImport(...) { ... }

function resolveExternalImport(...) {
  // Pattern matching with wildcards
  const patternRegex = globPatternToRegex(source.pattern);
  const match = importPath.match(patternRegex);
  if (match) {
    let targetDir = source.dir;
    for (let i = 1; i < match.length; i++) {
      targetDir = targetDir.replace('*', match[i]);
    }
  }
}

function resolveLocalModuleImport(...) { ... }
```

**File: `processors/model.ts`** (lines 408-472)
```typescript
function resolveImportPath(...) {
  // Try additionalModelSources first
  if (additionalModelSources) {
    for (const source of additionalModelSources) {
      if (matchesPattern(importPath, source.pattern)) {
        return replacePattern(importPath, source.pattern, source.dir);
      }
    }
  }
  // Try additionalMixinSources
  if (additionalMixinSources) {
    for (const source of additionalMixinSources) {
      if (matchesPattern(importPath, source.pattern)) {
        return replacePattern(importPath, source.pattern, source.dir);
      }
    }
  }
}

function matchesPattern(importPath: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    const regexPattern = pattern.replace(WILDCARD_REGEX, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(importPath);
  }
  return importPath === pattern;
}

function replacePattern(...) { ... }
```

**File: `utils/import-utils.ts`** (lines 514-543, 431-495)
```typescript
export function resolveRelativeImport(...) { ... }

function resolveAbsoluteImport(...) {
  // Similar pattern matching logic
  const sources: Array<{ pattern: string; dir: string }> = [];
  // Build sources array from configuration
  const matchedSource = sources.find((source) => importPath.startsWith(source.pattern));
  if (matchedSource) {
    const name = importPath.replace(matchedSource.pattern, '');
    // Try .ts and .js extensions
  }
}
```

**File: `utils/code-processing.ts`** (lines 226-236)
```typescript
export function findFileWithExtensions(basePath: string): string | null {
  const possiblePaths = [basePath, `${basePath}${FILE_EXTENSION_JS}`, `${basePath}${FILE_EXTENSION_TS}`];
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}
```

#### Refactoring Strategy

**Extract to:** `utils/path-resolution.ts`

**Proposed Functions:**
```typescript
// Unified path resolution
export function resolveImportToFilePath(
  importPath: string,
  fromFile: string,
  config: ImportResolutionConfig
): string | null;

// Pattern matching with wildcards  
export function matchWildcardPattern(pattern: string, value: string): boolean;

// Replace wildcards in patterns
export function replaceWildcardPattern(pattern: string, value: string, replacement: string): string;

// Try multiple file extensions
export function resolveWithExtensions(basePath: string, extensions?: string[]): string | null;

// Configuration-based source resolution
interface ImportSourceConfig {
  primarySource?: string;
  primaryDir?: string;
  additionalSources?: Array<{ pattern: string; dir: string }>;
}
```

**Benefits:**
- Single source of truth for path resolution logic
- Consistent wildcard pattern handling
- Easier testing and maintenance
- Reduced code duplication (~150 lines)

---

### 2. Type-Only Import Detection

#### Pattern Description
Multiple places check for type-only imports using regex or string matching.

#### Occurrences

**File: `utils/code-processing.ts`** (lines 256-258)
```typescript
export function isTypeOnlyImport(importText: string): boolean {
  return importText.includes('import type');
}
```

**File: `processors/mixin-analyzer.ts`** (lines 561-567)
```typescript
const importText = importStatement.text();
// Check if this is a type-only import (import type ...)
if (!isTypeOnlyImport(importText)) continue;
```

**File: `utils/import-utils.ts`** (multiple places check for `import type` pattern)

#### Refactoring Strategy

**Consolidate in:** `utils/code-processing.ts`

The function `isTypeOnlyImport` already exists but should be used consistently across all files instead of inline checks.

**Action Items:**
1. Audit all files for inline `import type` checks
2. Replace with calls to `isTypeOnlyImport`
3. Consider adding related utilities like `extractTypeOnlyImportName`

---

### 3. Extension Signature Type Generation

#### Pattern Description
Identical logic for generating TypeScript type aliases for extension signatures appears in both model and mixin processors.

#### Occurrences

**File: `processors/model.ts`** (lines 756-773)
```typescript
// Create extension signature type alias if there are extension properties
if (extensionProperties.length > 0 && extensionArtifact) {
  const extensionSignatureType = `${modelName}ExtensionSignature`;
  const extensionClassName = `${modelName}Extension`;

  // Check if the extension file is TypeScript
  const isExtensionTypeScript = extensionArtifact.suggestedFileName.endsWith('.ts');

  if (isExtensionTypeScript) {
    // Generate TypeScript type alias
    const signatureCode = `export type ${extensionSignatureType} = typeof ${extensionClassName};`;
    extensionArtifact.code += '\n\' + signatureCode;
  }
}
```

**File: `processors/model.ts`** (lines 1004-1016) - In `generateIntermediateModelTraitArtifacts`
```typescript
// Create extension signature type alias if there are extension properties
const extensionSignatureType = `${traitPascalName}ExtensionSignature`;
const extensionClassName = `${traitPascalName}Extension`;

// Check if the extension file is TypeScript
const isExtensionTypeScript = extensionArtifact.suggestedFileName.endsWith('.ts');

if (isExtensionTypeScript) {
  // Generate TypeScript type alias
  const signatureCode = `export type ${extensionSignatureType} = typeof ${extensionClassName};`;
  // Add the signature type alias to the extension file
  extensionArtifact.code += '\n\n' + signatureCode;
}
```

#### Refactoring Strategy

**Extract to:** `utils/extension-generation.ts`

**Proposed Function:**
```typescript
export function appendExtensionSignatureType(
  extensionArtifact: TransformArtifact,
  entityName: string
): void {
  const isTypeScript = extensionArtifact.suggestedFileName.endsWith('.ts');
  if (!isTypeScript) return;

  const signatureType = `${entityName}ExtensionSignature`;
  const className = `${entityName}Extension`;
  const signatureCode = `export type ${signatureType} = typeof ${className};`;
  
  extensionArtifact.code += '\n\n' + signatureCode;
}
```

---

### 4. Relationship/Decorator Extraction Logic

#### Pattern Description
Similar logic for extracting polymorphic relationships and decorator arguments appears in multiple places.

#### Occurrences

**File: `processors/mixin-analyzer.ts`** (lines 432-537)
```typescript
function extractPolymorphicMixinReferences(...) {
  // Find all decorator nodes
  const decorators = findDecorators(root);
  
  for (const decorator of decorators) {
    const decoratorText = decorator.text();
    if (!decoratorText.includes(BELONGS_TO_NAME)) continue;
    
    const callExpr = decorator.find({ rule: { kind: NODE_KIND_CALL_EXPRESSION } });
    const args = callExpr.field('arguments');
    const stringArgs = findStringArguments(args);
    const objectArgs = findObjectArguments(args);
    
    if (objectArgs.length >= 1) {
      const optionsText = objectArgs[0].text();
      if (isPolymorphicRelationship(optionsText)) {
        // Process polymorphic mixin
      }
    }
  }
  
  // Also check for regular function calls (non-decorator syntax)
  const callExpressions = findCallExpressions(root);
  // ... similar logic
}
```

**Similar logic appears in model field extraction for determining relationship types**

#### Refactoring Strategy

**Extract to:** `utils/relationship-analysis.ts` (new file)

**Proposed Functions:**
```typescript
export interface RelationshipInfo {
  kind: 'belongsTo' | 'hasMany';
  type: string;
  isPolymorphic: boolean;
  options: Record<string, unknown>;
}

export function extractRelationshipsFromDecorators(
  root: SgNode,
  options?: TransformOptions
): RelationshipInfo[];

export function extractRelationshipsFromCalls(
  root: SgNode,
  options?: TransformOptions
): RelationshipInfo[];

export function isPolymorphicRelationship(optionsText: string): boolean;
```

---

### 5. Import Map Building

#### Pattern Description
Building a map of import identifiers to their source paths is done in several places with slight variations.

#### Occurrences

**File: `processors/mixin-analyzer.ts`** (lines 40-79)
```typescript
function buildImportMap(root: SgNode, logger: Logger): Map<string, string> {
  const importMap = new Map<string, string>();
  const importStatements = findImportStatements(root);

  for (const importStatement of importStatements) {
    const importPath = getImportSourcePath(importStatement);
    if (!importPath) continue;

    const importClause = getImportClause(importStatement);
    if (!importClause) continue;

    // Handle default imports
    const defaultIdentifier = getDefaultImportIdentifier(importClause);
    if (defaultIdentifier) {
      importMap.set(defaultIdentifier, importPath);
      continue;
    }

    // Handle named imports
    const namedIdentifiers = getNamedImportIdentifiers(importClause);
    for (const identifierName of namedIdentifiers) {
      importMap.set(identifierName, importPath);
    }
  }

  return importMap;
}
```

**File: `utils/ast-helpers.ts`** - `getEmberDataImports` and `getMixinImports` do similar mapping but with different filtering

**File: `utils/import-utils.ts`** - `extractTypeNameMapping` builds a similar map with type-specific logic

#### Refactoring Strategy

**Extract to:** `utils/import-utils.ts`

**Proposed Functions:**
```typescript
export interface ImportMapOptions {
  filter?: (importPath: string) => boolean;
  includeDefault?: boolean;
  includeNamed?: boolean;
}

export function buildImportMap(
  root: SgNode,
  options?: ImportMapOptions
): Map<string, string>;

// Specialized versions using the generic builder
export function buildEmberDataImportMap(root: SgNode, sources: string[]): Map<string, string>;
export function buildMixinImportMap(root: SgNode, options?: TransformOptions): Map<string, string>;
```

---

### 6. String/Path Transformation Utilities

#### Pattern Description
Common string transformations for converting between naming conventions are scattered and duplicated.

#### Occurrences

**File: `utils/string.ts`** - Contains many regex patterns and transformation functions

**File: `utils/path-utils.ts`** - Has `toPascalCase`, `extractBaseName`, etc.

**Duplications found:**
- Kebab-case to PascalCase conversion appears in multiple forms
- File extension handling logic repeated
- Quote removal logic

#### Refactoring Strategy

**Consolidate in:** `utils/string.ts` and `utils/path-utils.ts`

The utilities exist but need audit for:
1. Remove redundant functions
2. Standardize naming conventions
3. Ensure all transformations have consistent implementations

**Functions to audit:**
- `pascalToKebab` vs `toKebabCase`
- `mixinNameToKebab` vs `mixinNameToTraitName`
- `removeQuotes` vs `removeQuoteChars`
- `extractBaseName` implementations

---

### 7. AST Node Type Checking

#### Pattern Description
Checking node types against constants is verbose and repeated throughout.

#### Occurrences

**File: `utils/code-processing.ts`** - Exports NODE_KIND_* constants

**File: `processors/model.ts`** (lines 145-165)
```typescript
function isClassMethodSyntax(methodNode: SgNode): boolean {
  const methodKind = methodNode.kind();
  
  if (methodKind === NODE_KIND_METHOD_DEFINITION) {
    return true;
  }
  
  if (methodKind === NODE_KIND_FIELD_DEFINITION) {
    const value = methodNode.field('value');
    if (value) {
      const valueKind = value.kind();
      if (valueKind === NODE_KIND_ARROW_FUNCTION || valueKind === NODE_KIND_FUNCTION) {
        return false;
      }
    }
  }
  
  return false;
}
```

**File: `processors/mixin.ts`** (lines 112-140) - Similar `isObjectMethodSyntax` function

#### Refactoring Strategy

**Extract to:** `utils/ast-helpers.ts`

**Proposed Functions:**
```typescript
export function isMethodDefinition(node: SgNode): boolean;
export function isFieldWithFunctionValue(node: SgNode): boolean;
export function isObjectMethodSyntax(node: SgNode): boolean;
export function isClassMethodSyntax(node: SgNode): boolean;

// Higher-level helpers
export function isFunctionNode(node: SgNode): boolean {
  const kind = node.kind();
  return kind === NODE_KIND_FUNCTION || 
         kind === NODE_KIND_ARROW_FUNCTION ||
         kind === NODE_KIND_METHOD_DEFINITION;
}
```

---

### 8. Trait Name Resolution and Conversion

#### Pattern Description
Converting between mixin names, trait names, and import paths follows patterns that should be centralized.

#### Occurrences

**File: `utils/import-utils.ts`** (lines 141-177)
```typescript
function shouldImportFromTraits(relatedType: string, options?: TransformOptions): boolean {
  // Check if any of the connected mixins correspond to this related type
  const connectedMixins = options?.modelConnectedMixins;
  if (connectedMixins) {
    for (const mixinPath of connectedMixins) {
      const mixinName = extractBaseName(mixinPath);
      if (mixinName === relatedType) {
        return true;
      }
    }
  }
  
  // Check if any of the intermediate models correspond to this related type
  const intermediateModelPaths = options?.intermediateModelPaths;
  if (intermediateModelPaths) {
    for (const modelPath of intermediateModelPaths) {
      const traitBaseName =
        modelPath
          .split('/')
          .pop()
          ?.replace(/-?model$/i, '') || modelPath;
      const traitName = traitBaseName
        .replace(UPPERCASE_LETTER_REGEX, '-$1')
        .toLowerCase()
        .replace(LEADING_HYPHEN_REGEX, '');
      
      if (traitName === relatedType) {
        return true;
      }
    }
  }
  
  return false;
}
```

**Similar logic in:** `processors/model.ts` for trait extraction and naming

#### Refactoring Strategy

**Extract to:** `utils/schema-generation.ts` or new `utils/trait-utils.ts`

**Proposed Functions:**
```typescript
export function extractTraitNameFromModelPath(modelPath: string): string;
export function shouldUseTraitImport(
  typeName: string,
  options: TransformOptions
): boolean;
export function convertModelPathToTraitName(
  modelPath: string,
  options?: TransformOptions
): string;
```

---

### 9. Polymorphic Relationship Detection

#### Pattern Description
Detecting polymorphic relationships by checking for `polymorphic: true` in options objects.

#### Occurrences

**File: `utils/code-processing.ts`** (lines 263-265)
```typescript
export function isPolymorphicRelationship(objectText: string): boolean {
  return objectText.includes('polymorphic') && objectText.includes('true');
}
```

**Used in:**
- `processors/mixin-analyzer.ts` for extracting polymorphic mixin references
- Model field extraction for relationship handling

#### Refactoring Strategy

**Already centralized in:** `utils/code-processing.ts`

**Action Items:**
1. Ensure all polymorphic checks use this function
2. Consider enhancing to use AST parsing instead of string matching for reliability

---

### 10. Schema Import Generation

#### Pattern Description
Generating import statements for schema files (traits and resources) with type aliases.

#### Occurrences

**File: `utils/import-utils.ts`** (lines 188-246)
```typescript
export function transformModelToResourceImport(...) {
  // Always check traits first for intermediate models
  if (shouldImportFromTraits(relatedType, options)) {
    const traitInterfaceName = `${toPascalCase(relatedType)}Trait`;
    const aliasName = toPascalCase(relatedType);
    if (traitsImport) {
      return `type { ${traitInterfaceName} as ${aliasName} } from '${traitsImport}/${relatedType}.schema'`;
    }
  }
  
  // Check if we have a model for this related type
  // ... check allModelFiles
  
  // Check if we have a mixin/trait to fall back to
  // ... check allMixinFiles
  
  // Default to resource import
  return `type { ${modelName} } from '${resourcesImport}/${relatedType}.schema'`;
}
```

**Similar logic in:** `processors/mixin.ts` for trait imports

#### Refactoring Strategy

**Already centralized in:** `utils/import-utils.ts`

**Action Items:**
1. Audit all import generation to use this function
2. Add more specialized variants if needed

---

## Priority Matrix

| Pattern | Occurrences | Complexity | Impact | Priority |
|---------|-------------|------------|--------|----------|
| Path Resolution | 4+ files | Medium | High | **P0** |
| Import Map Building | 3+ files | Low | Medium | **P1** |
| Extension Signature | 2 files | Low | Low | **P2** |
| Relationship Extraction | 2 files | Medium | Medium | **P1** |
| AST Type Checking | 3+ files | Low | Medium | **P2** |
| Trait Name Resolution | 2 files | Low | Low | **P2** |

---

## Implementation Phases

### Phase 1: Foundation (P0 Items)
- Create `utils/path-resolution.ts` with unified path resolution
- Update all existing code to use the new utilities
- Add comprehensive tests for path resolution

### Phase 2: Import Analysis (P1 Items)
- Refactor `buildImportMap` to be generic and reusable
- Create `utils/relationship-analysis.ts` for relationship extraction
- Standardize import detection across all processors

### Phase 3: Code Cleanup (P2 Items)
- Extract extension signature generation
- Consolidate AST type checking helpers
- Audit and deduplicate string transformation utilities

---

## Files to Create/Modify

### New Files
1. `utils/path-resolution.ts` - Unified path resolution
2. `utils/relationship-analysis.ts` - Relationship extraction utilities

### Files to Modify
1. `processors/model.ts` - Use new utilities
2. `processors/mixin.ts` - Use new utilities
3. `processors/mixin-analyzer.ts` - Use new utilities
4. `utils/import-utils.ts` - Consolidate import map building
5. `utils/code-processing.ts` - Ensure all helpers are used consistently
6. `utils/ast-helpers.ts` - Add AST type checking helpers

---

## Testing Strategy

For each extraction:
1. Write unit tests for the new utility function
2. Ensure existing tests still pass
3. Add integration tests for the refactored processors
4. Verify no regression in output generation

---

## Success Metrics

- [ ] Reduce total lines of code by ~10-15%
- [ ] Eliminate duplicate logic across processors
- [ ] Maintain or improve test coverage
- [ ] All existing tests pass without modification
- [ ] No functional changes to generated output
