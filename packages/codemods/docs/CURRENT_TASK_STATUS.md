# Current Task Status: Schema Migration Codemod Fixes

## Completed Tasks

### 1. Fix Type Import Path (✓)
- **Problem**: Generated code imported `Type` symbol from `@warp-drive/core/types/symbols` instead of deriving the path from `emberDataImportSource`
- **Solution**: Added `getTypeSymbolImportPath()` function in `ast-utils.ts` to derive the correct path
- **Example**: For `emberDataImportSource: "@auditboard/warp-drive/v1/model"`, the Type import becomes `@auditboard/warp-drive/v1/core-types/symbols`

### 2. Fix Duplicate Trait Imports/Extends (✓)
- **Problem**: Same trait appeared multiple times in imports and extends clauses
- **Solution**: Added deduplication using `[...new Set(mixinTraits)]` in `model-to-schema.ts`

### 3. Fix .js Extension in Trait Names (✓)
- **Problem**: Intermediate model paths like `base-model.js` generated traits named `BaseModel.jsTrait` instead of `BaseModelTrait`
- **Solution**: Added `.replace(/\.[jt]s$/, '')` to strip file extensions before converting to trait names

### 4. Add Model Base Property `id` to Intermediate Model Traits (✓)
- **Problem**: Generated traits didn't include `id` property, causing type errors in extensions using `this.id`
- **Solution**: Modified `generateIntermediateModelTraitArtifacts()` to automatically add `id: string | null` to all intermediate model trait types

### 5. Add Store Type Configuration Option (✓)
- **Problem**: Extensions access `this.store` but the Store type is application-specific
- **Solution**: Added `storeType` configuration option to specify the Store type and import path
- **Config Example**:
  ```json
  {
    "storeType": {
      "name": "Store",
      "import": "soxhub-client/services/store"
    }
  }
  ```
- **Result**: When configured, generated intermediate model traits now include `store: Store` property with correct import

## In Progress / Remaining Issues

### Remaining Type Errors
Most errors fall into these categories:

1. **Missing `store` property** - ✓ Solved by adding `storeType` to config (see above)
2. **Module resolution errors** - Some external package models reference types not generated in target app (config issue, not codemod bug)
3. **Named vs default export mismatches** - ✓ Fixed: `generateStubResourceTypeInterface()` was using `export default interface` instead of `export interface`

## Configuration Used (AuditBoard)

```json
{
  "emberDataImportSource": "@auditboard/warp-drive/v1/model",
  "intermediateModelPaths": [
    "soxhub-client/core/base-model",
    "soxhub-client/core/data-field-model",
    "@auditboard/client-core/core/-auditboard-model"
  ],
  "storeType": {
    "name": "Store",
    "import": "soxhub-client/services/store"
  },
  ...
}
```

## Files Modified

### packages/codemods/src/schema-migration/utils/ast-utils.ts
- Added `getTypeSymbolImportPath()` function
- Modified `generateCommonWarpDriveImports()` to use derived Type path
- Added `storeType` property to `TransformOptions` interface

### packages/codemods/src/schema-migration/model-to-schema.ts
- Added file extension stripping in `extractIntermediateModelTraits()`
- Added trait deduplication in `extractModelFields()`
- Added automatic `id` property injection in `generateIntermediateModelTraitArtifacts()`
- Added `store` property injection when `storeType` is configured in `generateIntermediateModelTraitArtifacts()`
- Added Store type import generation when `storeType` is configured

### packages/codemods/src/schema-migration/mixin-to-schema.ts
- Fixed `generateStubResourceTypeInterface()` to use named export (`export interface`) instead of default export

### packages/codemods/src/schema-migration/config-schema.json
- Added `storeType` configuration option with `name` and `import` properties

## Next Steps

1. **Test with full codemod run** - Verify remaining errors are expected/acceptable
2. **Address module resolution issues** - Some may require config changes

## Test Commands

```bash
# Run codemod
cd /path/to/frontend/apps/client
npx tsx /path/to/codemods/bin/codemods.ts apply migrate-to-schema --config schema-migration.config.json ./app

# Run type check
pnpm lint:types

# Count errors
pnpm lint:types 2>&1 | grep -E "TS[0-9]+" | wc -l
```
