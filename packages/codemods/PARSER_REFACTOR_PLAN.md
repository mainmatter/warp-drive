# Parser Refactor Plan

## Status: Phases 1-3 Complete ✅

**Completed:**
- Created `file-parser.ts` with `ParsedFile` intermediate structure
- Added `parsedModels` and `parsedMixins` Maps to `Input` class
- Added `parseAllFiles()` method to `Codemod` class
- Updated `migrate.ts` to call parsing step after file discovery

**All tests passing:** 140 fixture tests + 163 unit tests

## Overview

This document outlines the plan to introduce a `ParsedFile` intermediate structure in the schema-migration codemod. The goal is to pre-process files into a structure that can be used inside functions that generate final code, reducing repetitiveness and enabling easy cross-file reference lookups without re-parsing.

## Problem Statement

Currently, files are processed multiple times during migration:

1. **File discovery** (`codemod.findModels()`, `codemod.findMixins()`) - reads files, stores raw code
2. **Mixin usage analysis** (`analyzeModelMixinUsage()`) - parses models to find mixin imports
3. **Extension detection** (`findModelExtensions()`) - parses models to check for extension properties
4. **Pre-analysis** (`preAnalyzeConnectedMixinExtensions()`) - parses mixins to analyze extensions
5. **Artifact generation** (`toArtifacts()`) - parses files again to generate output

This leads to:
- Redundant AST parsing
- Difficulty referencing other files' exports
- Code duplication across analysis functions

## Solution: ParsedFile Intermediate Structure

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage approach | Store alongside raw files | Allows raw access when needed |
| Cross-file references | Store paths only | Look up in maps when needed |
| Parsing strategy | Eager parsing | Parse all files immediately after discovery |

### Type Definitions

```typescript
interface ParsedFileImport {
  path: string;
  type: 'library' | 'mixin' | 'model' | 'ember-data' | 'other';
  localNames: string[];
  isDefault: boolean;
}

interface ParsedField {
  name: string;
  kind: 'attribute' | 'belongsTo' | 'hasMany' | 'schema-object' | 'schema-array' | 'array';
  type?: string;
  options?: Record<string, unknown>;
  tsType?: string;
}

interface ParsedBehavior {
  name: string;
  originalKey: string;
  value: string;
  typeInfo?: ExtractedType;
  isObjectMethod: boolean;
  kind: 'method' | 'computed' | 'getter' | 'setter' | 'property';
}

interface ParsedFile {
  name: string;
  path: string;
  extension: '.ts' | '.js';
  imports: ParsedFileImport[];
  fields: ParsedField[];
  behaviors: ParsedBehavior[];
  fileType: 'model' | 'mixin' | 'fragment' | 'unknown';
  traits: string[];
  hasExtension: boolean;
  baseClass?: string;
  pascalName: string;
  camelName: string;
  baseName: string;
}
```

## Implementation Tasks

### Phase 1: Create File Parser Module ✅ Complete

**File:** `packages/codemods/src/schema-migration/utils/file-parser.ts`

- [x] Define `ParsedFileImport`, `ParsedField`, `ParsedBehavior`, `ParsedFile` interfaces
- [x] Implement `classifyImport()` - categorize imports by type
- [x] Implement `parseImports()` - extract all imports from AST
- [x] Implement `findClassDeclarationInRoot()` - local helper for class finding
- [x] Implement `isClassMethodSyntax()` - detect method syntax
- [x] Implement `findPropertyDefinitions()` - find class properties
- [x] Implement `findMethodDefinitions()` - find class methods
- [x] Implement `determineBehaviorKind()` - classify behavior type
- [x] Implement `extractModelData()` - extract fields, behaviors, traits from model
- [x] Implement `detectFileType()` - determine if file is model/mixin/fragment
- [x] Implement `parseFile()` - main parsing function
- [x] Implement `parseFiles()` - batch parsing function

### Phase 2: Update Input Class ✅ Complete

**File:** `packages/codemods/src/schema-migration/codemod.ts`

- [x] Add `parsedModels: Map<Filename, ParsedFile>` to `Input` class
- [x] Add `parsedMixins: Map<Filename, ParsedFile>` to `Input` class
- [x] Add `parseAllFiles()` method to `Codemod` class

### Phase 3: Update Migration Task ✅ Complete

**File:** `packages/codemods/src/schema-migration/tasks/migrate.ts`

- [x] Call `codemod.parseAllFiles()` after file discovery
- [x] Update `finalOptions` population to use parsed data:
  ```typescript
  finalOptions.allModelFiles = Array.from(codemod.input.parsedModels.keys());
  finalOptions.allMixinFiles = Array.from(codemod.input.parsedMixins.keys());
  ```
- [ ] Update `preAnalyzeConnectedMixinExtensions()` call to use parsed mixins

### Phase 4: Update Pre-Analysis Function (Future)

**File:** `packages/codemods/src/schema-migration/processors/model.ts`

- [ ] Update `preAnalyzeConnectedMixinExtensions()` signature to use `ParsedFile`:
  ```typescript
  export function preAnalyzeConnectedMixinExtensions(
    parsedMixins: Map<Filename, ParsedFile>,
    options: TransformOptions
  ): void
  ```
- [ ] Use `parsed.hasExtension` and `parsed.behaviors` instead of re-parsing

### Phase 5: Future Refactoring (Out of Scope)

These changes are optional follow-ups after the initial implementation:

- [ ] Update `ArtifactTransformer` type to accept `ParsedFile`
- [ ] Refactor `modelToArtifacts()` to use pre-parsed data
- [ ] Refactor `mixinToArtifacts()` to use pre-parsed data
- [ ] Add mixin-specific extraction in `parseFile()`

## File Changes Summary

| File | Action | Estimated Lines |
|------|--------|-----------------|
| `utils/file-parser.ts` | Create | ~500 lines |
| `codemod.ts` | Modify | ~30 lines |
| `tasks/migrate.ts` | Modify | ~20 lines |
| `processors/model.ts` | Modify | ~30 lines |

## Testing Strategy

1. Run existing fixture tests to ensure no regression
2. Run existing unit tests
3. Manual verification that parsed data matches expected structure

```bash
# Run all codemod tests
pnpm -F codemods-tests test

# Run only fixture tests
pnpm -F codemods-tests test:fixtures

# Run only unit tests
pnpm -F codemods-tests test:unit
```

## Benefits

1. **Performance**: Files are parsed once instead of multiple times
2. **Maintainability**: Single source of truth for file structure
3. **Cross-file lookups**: Easy to reference other files' exports via path-based Maps
4. **Type safety**: Strong typing for all extracted data
5. **Debugging**: Parsed structure can be inspected/logged for troubleshooting

## Notes

- The `ParsedFile` structure reuses existing utility functions from `ast-helpers.ts`, `type-utils.ts`, etc.
- Raw file code is preserved alongside parsed data for cases where it's still needed
- Import classification enables smart handling of different import types
- Behavior kind classification (`method`, `computed`, `getter`, `setter`, `property`) enables proper code generation
