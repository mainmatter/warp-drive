# Ember Data Model to WarpDrive Schema Migration Guide

This document describes the transformations performed by the schema migration codemod, which converts legacy Ember Data `Model` classes and `Mixin` definitions into the new WarpDrive schema-based architecture.

## Table of Contents

- [Overview](#overview)
- [Generated Artifacts](#generated-artifacts)
- [Model Transformations](#model-transformations)
  - [Basic Model Structure](#basic-model-structure)
  - [Attributes](#attributes)
  - [Relationships](#relationships)
  - [Extensions](#extensions-computed-properties--methods)
  - [TypeScript Type Generation](#typescript-type-generation)
- [Mixin Transformations](#mixin-transformations)
  - [Basic Mixin Structure](#basic-mixin-structure)
  - [What Goes Where: Traits vs Extensions](#what-goes-where-traits-vs-extensions)
  - [Mixin Inheritance](#mixin-inheritance)
- [Model with Mixins](#model-with-mixins)
- [Fragment Support](#fragment-support)
- [Type Mapping Reference](#type-mapping-reference)
- [File Structure](#file-structure)
- [Edge Cases](#edge-cases)

---

## Overview

The migration transforms the traditional class-based Ember Data model definitions into a declarative schema approach. This separation provides:

- **Schemas**: Pure data structure definitions (fields, relationships, identity)
- **Resource Types**: TypeScript interfaces for type safety
- **Extensions**: Behavioral code (computed properties, methods, services)
- **Traits**: Reusable field definitions extracted from mixins

The key principle is **separation of concerns**: data structure definitions are separated from behavioral code.

---

## Generated Artifacts

### For Models

| Artifact          | File Pattern             | When Generated                                           |
| ----------------- | ------------------------ | -------------------------------------------------------- |
| **Schema**        | `{name}.schema.{js\|ts}` | Always                                                   |
| **Resource Type** | `{name}.schema.types.ts` | Always                                                   |
| **Extension**     | `{name}.{js\|ts}`        | When model has computed properties, methods, or services |

### For Mixins

| Artifact       | File Pattern             | When Generated                                |
| -------------- | ------------------------ | --------------------------------------------- |
| **Trait**      | `{name}.schema.{js\|ts}` | Always                                        |
| **Trait Type** | `{name}.schema.types.ts` | Always                                        |
| **Extension**  | `{name}.{js\|ts}`        | When mixin has computed properties or methods |

---

## Model Transformations

### Basic Model Structure

A model class is split into a schema definition object and a TypeScript interface.

**Before:**

```typescript
import Model, { attr, belongsTo, hasMany } from "@ember-data/model";

export default class User extends Model {
  @attr("string") name;
  @attr("string") email;
  @belongsTo("company", { async: false }) company;
  @hasMany("project", { async: true, inverse: "owner" }) projects;
}
```

**After - Schema (`user.schema.ts`):**

```javascript
export const UserSchema = {
  type: "user",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  fields: [
    {
      kind: "attribute",
      name: "name",
      type: "string",
    },
    {
      kind: "attribute",
      name: "email",
      type: "string",
    },
    {
      kind: "belongsTo",
      name: "company",
      type: "company",
      options: {
        async: false,
      },
    },
    {
      kind: "hasMany",
      name: "projects",
      type: "project",
      options: {
        async: true,
        inverse: "owner",
      },
    },
  ],
};
```

**After - Resource Type (`user.schema.types.ts`):**

```typescript
import type { Type } from "@ember-data/core-types/symbols";
import type { Company } from "test-app/data/resources/company.schema.types";
import type { Project } from "test-app/data/resources/project.schema.types";
import type { AsyncHasMany } from "@ember-data/model";

export interface User {
  readonly [Type]: "user";
  readonly name: string | null;
  readonly email: string | null;
  readonly company: Company | null;
  readonly projects: AsyncHasMany<Project>;
}
```

### Schema Object Properties

| Property   | Description                                                            |
| ---------- | ---------------------------------------------------------------------- |
| `type`     | The resource type name (kebab-case, derived from file name)            |
| `legacy`   | Set to `true` for migrated models                                      |
| `identity` | Identity field configuration (typically `{ kind: '@id', name: 'id' }`) |
| `fields`   | Array of field definitions                                             |
| `traits`   | Array of trait names (when model extends mixins)                       |

---

### Attributes

Attribute decorators are converted to field definitions with `kind: 'attribute'`.

**Before:**

```typescript
@attr('string') name;
@attr('boolean', { defaultValue: false }) isActive;
@attr('date', { allowNull: true }) birthDate;
```

**After:**

```javascript
{
  'kind': 'attribute',
  'name': 'name',
  'type': 'string'
},
{
  'kind': 'attribute',
  'name': 'isActive',
  'type': 'boolean',
  'options': {
    'defaultValue': false
  }
},
{
  'kind': 'attribute',
  'name': 'birthDate',
  'type': 'date',
  'options': {
    'allowNull': true
  }
}
```

### Attribute Options

All options passed to `@attr()` are preserved in the `options` object:

| Option         | Description                     |
| -------------- | ------------------------------- |
| `defaultValue` | Default value for the attribute |
| `allowNull`    | Whether null values are allowed |

---

### Relationships

#### belongsTo

**Before:**

```typescript
@belongsTo('company', { async: false, inverse: null }) company;
@belongsTo('user', { async: true, inverse: 'profile', polymorphic: true }) owner;
```

**After:**

```javascript
{
  'kind': 'belongsTo',
  'name': 'company',
  'type': 'company',
  'options': {
    'async': false,
    'inverse': null
  }
},
{
  'kind': 'belongsTo',
  'name': 'owner',
  'type': 'user',
  'options': {
    'async': true,
    'inverse': 'profile',
    'polymorphic': true
  }
}
```

#### hasMany

**Before:**

```typescript
@hasMany('project', { async: true, inverse: 'owner' }) projects;
@hasMany('file', { async: false, inverse: null, as: 'fileable' }) attachments;
```

**After:**

```javascript
{
  'kind': 'hasMany',
  'name': 'projects',
  'type': 'project',
  'options': {
    'async': true,
    'inverse': 'owner'
  }
},
{
  'kind': 'hasMany',
  'name': 'attachments',
  'type': 'file',
  'options': {
    'async': false,
    'inverse': null,
    'as': 'fileable'
  }
}
```

### Relationship Options

| Option        | Description                               |
| ------------- | ----------------------------------------- |
| `async`       | Whether the relationship is async         |
| `inverse`     | The inverse relationship name (or `null`) |
| `polymorphic` | Whether the relationship is polymorphic   |
| `as`          | Polymorphic type identifier               |

---

### Extensions (Computed Properties & Methods)

When a model contains computed properties, methods, or service injections, an **extension** file is generated. The schema only contains data field definitions.

**Before:**

```typescript
import Model, { attr } from "@ember-data/model";
import { service } from "@ember/service";

export default class User extends Model {
  @service declare router: RouterService;
  @attr("string") name;
  @attr("string") email;

  get displayName() {
    return this.name || this.email;
  }

  async save() {
    return super.save();
  }
}
```

**After - Schema (`user.schema.ts`):**

```javascript
export const UserSchema = {
  type: "user",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  fields: [
    { kind: "attribute", name: "name", type: "string" },
    { kind: "attribute", name: "email", type: "string" },
  ],
};
```

**After - Extension (`user.ts`) for TypeScript source:**

```typescript
import Model, { attr } from "@ember-data/model";
import { service } from "@ember/service";

import type { User } from "test-app/data/resources/user.schema.types";

export interface UserExtension extends User {}

export class UserExtension {
  @service declare router: RouterService;

  get displayName() {
    return this.name || this.email;
  }

  async save() {
    return super.save();
  }
}

export type UserExtensionSignature = typeof UserExtension;
```

**After - Extension (`user.js`) for JavaScript source:**

```javascript
import Model, { attr } from "@ember-data/model";

// The following is a workaround for the fact that we can't properly do
// declaration merging in .js files. If this is converted to a .ts file,
// we can remove this and just use the declaration merging.
/** @import { User } from 'test-app/data/resources/user.schema.types' */
/** @type {{ new(): User }} */
const Base = class {};
export class UserExtension extends Base {
  get displayName() {
    return this.name || this.email;
  }

  async save() {
    return super.save();
  }
}

/** @typedef {typeof UserExtension} UserExtensionSignature */
```

### What Triggers Extension Generation

An extension is generated when the model contains any of:

- Getter/setter properties (`get displayName()`)
- Methods (`save()`, `customMethod()`)
- Service injections (`@service`)
- Other non-EmberData decorators
- `memberAction` calls

---

### TypeScript Type Generation

Resource type interfaces are always generated with the `[Type]` brand symbol.

**Generated Interface:**

```typescript
import type { Type } from "@ember-data/core-types/symbols";

export interface User {
  readonly [Type]: "user";
  readonly name: string | null;
  readonly email: string | null;
}
```

Key characteristics:

- All fields are `readonly`
- All attribute types are nullable (`| null`)
- The `[Type]` symbol brands the interface with the resource type

---

## Mixin Transformations

### Basic Mixin Structure

Mixins are transformed into **traits** (field definitions) and optionally **extensions** (behavioral code).

**Before:**

```javascript
import Mixin from "@ember/object/mixin";
import { attr, hasMany } from "@ember-data/model";

export default Mixin.create({
  files: hasMany("file", { as: "fileable", async: false }),
  name: attr("string"),
  isActive: attr("boolean", { defaultValue: false }),
});
```

**After - Trait (`fileable.schema.js`):**

```javascript
export const fileableTrait = {
  name: "fileable",
  mode: "legacy",
  fields: [
    {
      name: "files",
      kind: "hasMany",
      type: "file",
      options: {
        as: "fileable",
        async: false,
      },
    },
    {
      name: "name",
      kind: "attribute",
      type: "string",
    },
    {
      name: "isActive",
      kind: "attribute",
      type: "boolean",
      options: {
        defaultValue: false,
      },
    },
  ],
};
```

**After - Trait Type (`fileable.schema.types.ts`):**

```typescript
import type { HasMany } from "@ember-data/model";
import type { File } from "test-app/data/resources/file.schema.types";

export interface FileableTrait {
  files: HasMany<File>;
  name: string | null;
  isActive: boolean | null;
}
```

---

### What Goes Where: Traits vs Extensions

**This is a critical distinction:** Mixins are split based on their content.

| Content Type                   | Destination              | Reason                |
| ------------------------------ | ------------------------ | --------------------- |
| `@attr()` / `attr()`           | **Trait** (fields array) | Data field definition |
| `@belongsTo()` / `belongsTo()` | **Trait** (fields array) | Data field definition |
| `@hasMany()` / `hasMany()`     | **Trait** (fields array) | Data field definition |
| `computed()`                   | **Extension**            | Behavioral code       |
| Regular methods                | **Extension**            | Behavioral code       |
| `@service` / `service()`       | **Extension**            | Runtime dependency    |
| Other non-EmberData calls      | **Extension**            | Behavioral code       |

### Mixin with Mixed Content

**Before:**

```javascript
import Mixin from "@ember/object/mixin";
import { attr, hasMany } from "@ember-data/model";
import { computed } from "@ember/object";
import { readOnly } from "@ember/object/computed";

export default Mixin.create({
  // TRAIT FIELDS (go to trait)
  files: hasMany("file", { as: "fileable", async: false, inverse: "fileable" }),
  showFilesRequiringReviewError: attr("boolean", { defaultValue: false }),

  // EXTENSION PROPERTIES (go to extension)
  sortedFiles: sortBy("files", "createdAt:desc"),
  hasFiles: arrayHasLength("files"),
  numFiles: readOnly("files.length"),

  filesRequiringReview: computed("files.@each.status", function () {
    return this.files.filter((file) => !file.isReviewed);
  }),

  hasDuplicateFileName(file) {
    return Boolean(this.files.find((f) => f.name === file.name));
  },
});
```

**After - Trait (`fileable.schema.js`):**

```javascript
export const fileableTrait = {
  name: "fileable",
  mode: "legacy",
  fields: [
    {
      name: "files",
      kind: "hasMany",
      type: "file",
      options: {
        as: "fileable",
        async: false,
        inverse: "fileable",
      },
    },
    {
      name: "showFilesRequiringReviewError",
      kind: "attribute",
      type: "boolean",
      options: {
        defaultValue: false,
      },
    },
  ],
};
```

**After - Extension (`fileable.js`):**

```javascript
import { computed } from "@ember/object";
import { readOnly } from "@ember/object/computed";
import { arrayHasLength } from "@auditboard/client-core/core/computed-extensions";
import { sortBy } from "soxhub-client/utils/sort-by";

export const fileableExtension = {
  sortedFiles: sortBy("files", "createdAt:desc"),
  hasFiles: arrayHasLength("files"),
  numFiles: readOnly("files.length"),
  filesRequiringReview: computed("files.@each.status", function () {
    return this.files.filter((file) => !file.isReviewed);
  }),
  hasDuplicateFileName(file) {
    return Boolean(this.files.find((fileRecord) => fileRecord.name === file.name));
  },
};
```

### Mixin Artifact Generation Summary

| Mixin Contains                                  | Generated Artifacts                           |
| ----------------------------------------------- | --------------------------------------------- |
| Only fields (`@attr`, `@belongsTo`, `@hasMany`) | Trait + Trait Type                            |
| Fields + computed properties/methods            | Trait + Trait Type + Extension                |
| Only computed properties/methods (no fields)    | Trait (empty fields) + Trait Type + Extension |

---

### Mixin Inheritance

When mixins extend other mixins using `Mixin.createWithMixins()`, the parent traits are referenced.

**Before:**

```javascript
import Mixin from "@ember/object/mixin";
import { attr, hasMany } from "@ember-data/model";
import BaseModelMixin from "./base-model";
import TimestampMixin from "./timestamp";

export default Mixin.createWithMixins(BaseModelMixin, TimestampMixin, {
  description: attr("string"),
  files: hasMany("file", { async: false }),
});
```

**After - Trait:**

```javascript
export const fileableTrait = {
  name: "fileable",
  mode: "legacy",
  fields: [
    { name: "description", kind: "attribute", type: "string" },
    { name: "files", kind: "hasMany", type: "file", options: { async: false } },
  ],
  traits: ["base-model", "timestamp"],
};
```

**After - Trait Type:**

```typescript
import type { HasMany } from "@ember-data/model";
import type { File } from "test-app/data/resources/file.schema.types";
import type { BaseModelTrait } from "test-app/data/traits/base-model.schema.types";
import type { TimestampTrait } from "test-app/data/traits/timestamp.schema.types";

export interface FileableTrait extends BaseModelTrait, TimestampTrait {
  description: string | null;
  files: HasMany<File>;
}
```

---

## Model with Mixins

When a model extends mixins, they are converted to trait references.

**Before:**

```typescript
import Model, { attr } from "@ember-data/model";
import FileableMixin from "../mixins/fileable";
import TimestampableMixin from "../mixins/timestampable";

export default class Document extends Model.extend(FileableMixin, TimestampableMixin) {
  @attr("string") title;
}
```

**After - Schema:**

```javascript
export const DocumentSchema = {
  type: "document",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  fields: [{ kind: "attribute", name: "title", type: "string" }],
  traits: ["fileable", "timestampable"],
};
```

**After - Resource Type:**

```typescript
import type { Type } from "@ember-data/core-types/symbols";
import type { FileableTrait } from "test-app/data/traits/fileable.schema.types";
import type { TimestampableTrait } from "test-app/data/traits/timestampable.schema.types";

export interface Document extends FileableTrait, TimestampableTrait {
  readonly [Type]: "document";
  readonly title: string | null;
}
```

---

## Fragment Support

The codemod handles `ember-data-model-fragments` decorators.

### Fragment Decorator Mapping

| Decorator                   | Schema Kind     | Type Pattern        |
| --------------------------- | --------------- | ------------------- |
| `@fragment('address')`      | `schema-object` | `fragment:address`  |
| `@fragmentArray('address')` | `schema-array`  | `fragment:address`  |
| `@array()`                  | `array`         | `array:{fieldName}` |

### Fragment Field Example

**Before:**

```typescript
import Model, { attr } from "@ember-data/model";
import { fragment, fragmentArray } from "ember-data-model-fragments/attributes";

export default class Order extends Model {
  @attr("string") name;
  @fragment("address") shippingAddress;
  @fragmentArray("line-item") lineItems;
}
```

**After - Schema:**

```javascript
export const OrderSchema = {
  type: "order",
  legacy: true,
  identity: { kind: "@id", name: "id" },
  fields: [
    { kind: "attribute", name: "name", type: "string" },
    {
      kind: "schema-object",
      name: "shippingAddress",
      type: "fragment:address",
      objectExtensions: ["ember-object", "fragment"],
    },
    {
      kind: "schema-array",
      name: "lineItems",
      type: "fragment:line-item",
      arrayExtensions: ["ember-object", "ember-array-like", "fragment-array"],
      defaultValue: true,
    },
  ],
};
```

### Fragment Classes

Classes extending `Fragment` are converted to fragment schemas.

**Before:**

```javascript
import Fragment from "ember-data-model-fragments/fragment";
import { attr } from "ember-data-model-fragments/fragment";

export default class Address extends Fragment {
  @attr("string") street;
  @attr("string") city;
  @attr("string") state;
  @attr("string") zip;
}
```

**After - Schema:**

```javascript
export const AddressSchema = {
  type: "fragment:address",
  identity: null,
  fields: [
    { kind: "attribute", name: "street", type: "string" },
    { kind: "attribute", name: "city", type: "string" },
    { kind: "attribute", name: "state", type: "string" },
    { kind: "attribute", name: "zip", type: "string" },
  ],
  objectExtensions: ["ember-object", "fragment"],
};
```

Key differences for Fragment schemas:

- `type` is prefixed with `fragment:`
- `identity` is `null`
- `objectExtensions` array is included

---

## Type Mapping Reference

### Attribute Types

| Ember Data Type  | TypeScript Type   |
| ---------------- | ----------------- |
| `string`         | `string \| null`  |
| `number`         | `number \| null`  |
| `boolean`        | `boolean \| null` |
| `date`           | `Date \| null`    |
| Custom transform | `unknown \| null` |

Custom transforms can be mapped using the `typeMapping` codemod option.

### Relationship Types

| Relationship | Async Option   | TypeScript Type             |
| ------------ | -------------- | --------------------------- |
| `@belongsTo` | `async: false` | `RelatedType \| null`       |
| `@belongsTo` | `async: true`  | `Promise<RelatedType>`      |
| `@hasMany`   | `async: false` | `HasMany<RelatedType>`      |
| `@hasMany`   | `async: true`  | `AsyncHasMany<RelatedType>` |

---

## File Structure

### Output Directory Layout

```
app/
├── models/                    # Original models (source, unchanged)
├── mixins/                    # Original mixins (source, unchanged)
└── data/
    ├── resources/             # Schemas & types for models
    │   ├── user.schema.ts
    │   ├── user.schema.types.ts
    │   ├── company.schema.ts
    │   ├── company.schema.types.ts
    │   └── admin/             # Nested models preserve directory structure
    │       ├── admin-user.schema.ts
    │       └── admin-user.schema.types.ts
    ├── traits/                # Schemas & types for mixins
    │   ├── fileable.schema.ts
    │   ├── fileable.schema.types.ts
    │   └── admin/             # Nested mixins preserve directory structure
    │       ├── auditable.schema.ts
    │       └── auditable.schema.types.ts
    └── extensions/            # Extensions for models and mixins
        ├── user.ts
        ├── company.ts
        └── fileable.ts
```

### Naming Conventions

| Source File   | Schema File          | Type File                  | Extension File |
| ------------- | -------------------- | -------------------------- | -------------- |
| `user.ts`     | `user.schema.ts`     | `user.schema.types.ts`     | `user.ts`      |
| `user.js`     | `user.schema.js`     | `user.schema.types.ts`     | `user.js`      |
| `my-model.ts` | `my-model.schema.ts` | `my-model.schema.types.ts` | `my-model.ts`  |

**Note:** Type files are always `.ts` regardless of source file extension.

---

## Edge Cases

### Aliased Imports

The codemod correctly handles aliased imports.

**Before:**

```typescript
import Model, { attr as attribute, hasMany as manyRelation } from "@ember-data/model";

export default class AliasedModel extends Model {
  @attribute("string") name;
  @manyRelation("item") items;
}
```

The aliases are recognized and the fields are correctly extracted.

### Non-EmberData Decorators

Decorators from sources other than `@ember-data/model` are moved to the extension.

**Before:**

```typescript
import Model, { attr } from "@ember-data/model";
import { customDecorator } from "@unsupported/source";

export default class MixedModel extends Model {
  @attr("string") name;
  @customDecorator items; // Moved to extension
}
```

### Utility Functions

Utility functions defined in the model file are preserved in the extension, not the schema.

**Before:**

```typescript
import Model, { attr } from "@ember-data/model";

function buildFullName(first, last) {
  return `${first} ${last}`;
}

export default class User extends Model {
  @attr("string") firstName;
  @attr("string") lastName;

  get fullName() {
    return buildFullName(this.firstName, this.lastName);
  }
}
```

The `buildFullName` function is preserved in the extension file alongside the `fullName` getter.

### memberAction Handling

`memberAction` calls are preserved entirely in the extension, including any `after` callbacks.

**Before:**

```typescript
import Model, { attr } from "@ember-data/model";
import { memberAction } from "test-app/decorators/api-actions";

export default class TestModel extends Model {
  @attr("string") name;

  startProcess = memberAction({
    path: "start_process",
    type: "POST",
    after(response) {
      return response;
    },
  });
}
```

The entire `memberAction` assignment is moved to the extension.

### Exported Types in Extensions

Exported TypeScript interfaces and type aliases defined in the model file are preserved in the extension.

**Before:**

```typescript
import Model, { attr } from "@ember-data/model";

export interface DisplayableChange {
  field: string;
  oldValue: string;
  newValue: string;
}

export type ChangeStatus = "pending" | "applied";

export default class Amendment extends Model {
  @attr("string") status;

  get changes(): DisplayableChange[] {
    return [];
  }
}
```

The `DisplayableChange` interface and `ChangeStatus` type are preserved in the extension file.

### TypeScript Declare Fields

Fields declared with `declare` keyword are correctly parsed.

**Before:**

```typescript
import Model, { attr, belongsTo } from "@ember-data/model";

export default class TypedModel extends Model {
  @attr("string") declare name: string | null;
  @belongsTo("user", { async: false, inverse: null })
  declare owner: unknown;
}
```

Both fields are correctly extracted to the schema.

---

## Summary

The migration codemod transforms Ember Data models and mixins into a declarative schema architecture:

1. **Models** become **Schemas** (field definitions) + **Resource Types** (TypeScript interfaces) + optional **Extensions** (behavioral code)

2. **Mixins** become **Traits** (reusable field definitions) + **Trait Types** (TypeScript interfaces) + optional **Extensions** (computed properties and methods)

3. **Field definitions** (`@attr`, `@belongsTo`, `@hasMany`) go to schemas/traits

4. **Behavioral code** (getters, methods, services, computed properties) goes to extensions

5. **Type safety** is preserved through generated TypeScript interfaces that reflect the schema structure
