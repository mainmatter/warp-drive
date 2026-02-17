/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { describe, expect, it } from 'vitest';

import { parseFile } from '../../../../../packages/codemods/src/schema-migration/utils/file-parser.js';
import {
  buildEntityRegistry,
  linkEntities,
  SchemaEntity,
} from '../../../../../packages/codemods/src/schema-migration/utils/schema-entity.js';
import { DEFAULT_TEST_OPTIONS } from '../test-helpers.js';

function makeParsedModel(path: string, source: string) {
  return parseFile(path, source, DEFAULT_TEST_OPTIONS);
}

function makeParsedMixin(path: string, source: string) {
  return parseFile(path, source, DEFAULT_TEST_OPTIONS);
}

describe('SchemaEntity', () => {
  describe('fromParsedFile', () => {
    it('creates entity with model kind by default for model files', () => {
      const parsed = makeParsedModel(
        'app/models/user-profile.js',
        `import Model, { attr } from '@ember-data/model';
export default class UserProfile extends Model {
  @attr('string') name;
}`
      );
      const entity = SchemaEntity.fromParsedFile(parsed);

      expect(entity.kind).toBe('model');
      expect(entity.parsedFile).toBe(parsed);
    });

    it('creates entity with mixin kind for mixin files', () => {
      const parsed = makeParsedMixin(
        'app/mixins/timestampable.js',
        `import Mixin from '@ember/object/mixin';
import { attr } from '@ember-data/model';
export default Mixin.create({ createdAt: attr('date') });`
      );
      const entity = SchemaEntity.fromParsedFile(parsed);

      expect(entity.kind).toBe('mixin');
    });

    it('allows overriding kind', () => {
      const parsed = makeParsedModel(
        'app/models/base-model.js',
        `import Model, { attr } from '@ember-data/model';
export default class BaseModel extends Model {
  @attr('string') name;
}`
      );
      const entity = SchemaEntity.fromParsedFile(parsed, 'intermediate-model');

      expect(entity.kind).toBe('intermediate-model');
    });
  });

  describe('name getters', () => {
    it('derives all names from PascalCase base', () => {
      const parsed = makeParsedModel(
        'app/models/user-profile.js',
        `import Model, { attr } from '@ember-data/model';
export default class UserProfile extends Model {
  @attr('string') name;
}`
      );
      const entity = SchemaEntity.fromParsedFile(parsed);

      expect(entity.pascalName).toBe('UserProfile');
      expect(entity.baseName).toBe('user-profile');
      expect(entity.schemaName).toBe('UserProfileSchema');
      expect(entity.extensionName).toBe('UserProfileExtension');
      expect(entity.interfaceName).toBe('UserProfile');
      expect(entity.traitInterfaceName).toBe('UserProfileTrait');
    });
  });

  describe('extensionNameIfNeeded', () => {
    it('returns extensionName when hasExtension is true', () => {
      const parsed = makeParsedModel(
        'app/models/user.js',
        `import Model, { attr } from '@ember-data/model';
export default class User extends Model {
  @attr('string') name;
  get displayName() { return this.name; }
}`
      );
      const entity = SchemaEntity.fromParsedFile(parsed);

      expect(entity.hasExtension).toBe(true);
      expect(entity.extensionNameIfNeeded).toBe('UserExtension');
    });

    it('returns undefined when hasExtension is false', () => {
      const parsed = makeParsedModel(
        'app/models/simple.js',
        `import Model, { attr } from '@ember-data/model';
export default class Simple extends Model {
  @attr('string') name;
}`
      );
      const entity = SchemaEntity.fromParsedFile(parsed);

      expect(entity.hasExtension).toBe(false);
      expect(entity.extensionNameIfNeeded).toBeUndefined();
    });
  });

  describe('linking', () => {
    it('addTrait and traits work correctly', () => {
      const modelParsed = makeParsedModel(
        'app/models/document.js',
        `import Model, { attr } from '@ember-data/model';
export default class Document extends Model {
  @attr('string') title;
}`
      );
      const mixinParsed = makeParsedMixin(
        'app/mixins/fileable.js',
        `import Mixin from '@ember/object/mixin';
import { attr } from '@ember-data/model';
export default Mixin.create({ fileName: attr('string') });`
      );

      const modelEntity = SchemaEntity.fromParsedFile(modelParsed);
      const mixinEntity = SchemaEntity.fromParsedFile(mixinParsed);

      modelEntity.addTrait(mixinEntity);

      expect(modelEntity.traits).toHaveLength(1);
      expect(modelEntity.traits[0]).toBe(mixinEntity);
    });

    it('traitBaseNames returns kebab names', () => {
      const modelParsed = makeParsedModel(
        'app/models/doc.js',
        `import Model, { attr } from '@ember-data/model';
export default class Doc extends Model { @attr('string') title; }`
      );
      const mixin1 = makeParsedMixin(
        'app/mixins/fileable.js',
        `import Mixin from '@ember/object/mixin';
import { attr } from '@ember-data/model';
export default Mixin.create({ f: attr('string') });`
      );
      const mixin2 = makeParsedMixin(
        'app/mixins/timestampable.js',
        `import Mixin from '@ember/object/mixin';
import { attr } from '@ember-data/model';
export default Mixin.create({ t: attr('date') });`
      );

      const modelEntity = SchemaEntity.fromParsedFile(modelParsed);
      modelEntity.addTrait(SchemaEntity.fromParsedFile(mixin1));
      modelEntity.addTrait(SchemaEntity.fromParsedFile(mixin2));

      expect(modelEntity.traitBaseNames).toEqual(['fileable', 'timestampable']);
    });

    it('traitExtensionNames returns PascalCase extension names for traits with extensions', () => {
      const modelParsed = makeParsedModel(
        'app/models/doc.js',
        `import Model, { attr } from '@ember-data/model';
export default class Doc extends Model { @attr('string') title; }`
      );
      // Mixin with extension (has behaviors)
      const mixinWithExt = makeParsedMixin(
        'app/mixins/fileable.js',
        `import Mixin from '@ember/object/mixin';
import { attr } from '@ember-data/model';
export default Mixin.create({
  fileName: attr('string'),
  getFullPath() { return this.fileName; }
});`
      );
      // Mixin without extension (no behaviors)
      const mixinWithoutExt = makeParsedMixin(
        'app/mixins/taggable.js',
        `import Mixin from '@ember/object/mixin';
import { attr } from '@ember-data/model';
export default Mixin.create({ tag: attr('string') });`
      );

      const modelEntity = SchemaEntity.fromParsedFile(modelParsed);
      modelEntity.addTrait(SchemaEntity.fromParsedFile(mixinWithExt));
      modelEntity.addTrait(SchemaEntity.fromParsedFile(mixinWithoutExt));

      expect(modelEntity.traitExtensionNames).toEqual(['FileableExtension']);
    });
  });

  describe('buildEntityRegistry', () => {
    it('creates entities for all models and mixins', () => {
      const model1 = makeParsedModel(
        'app/models/user.js',
        `import Model, { attr } from '@ember-data/model';
export default class User extends Model { @attr('string') name; }`
      );
      const mixin1 = makeParsedMixin(
        'app/mixins/fileable.js',
        `import Mixin from '@ember/object/mixin';
import { attr } from '@ember-data/model';
export default Mixin.create({ f: attr('string') });`
      );

      const parsedModels = new Map([['app/models/user.js', model1]]);
      const parsedMixins = new Map([['app/mixins/fileable.js', mixin1]]);

      const registry = buildEntityRegistry(parsedModels, parsedMixins);

      expect(registry.size).toBe(2);
      expect(registry.get('app/models/user.js')?.kind).toBe('model');
      expect(registry.get('app/mixins/fileable.js')?.kind).toBe('mixin');
    });
  });

  describe('linkEntities', () => {
    it('connects models to their mixin entities via modelToMixinsMap', () => {
      const model1 = makeParsedModel(
        'app/models/doc.js',
        `import Model, { attr } from '@ember-data/model';
export default class Doc extends Model { @attr('string') title; }`
      );
      const mixin1 = makeParsedMixin(
        'app/mixins/fileable.js',
        `import Mixin from '@ember/object/mixin';
import { attr } from '@ember-data/model';
export default Mixin.create({ f: attr('string') });`
      );

      const parsedModels = new Map([['app/models/doc.js', model1]]);
      const parsedMixins = new Map([['app/mixins/fileable.js', mixin1]]);

      const registry = buildEntityRegistry(parsedModels, parsedMixins);
      const modelToMixinsMap = new Map([['app/models/doc.js', new Set(['app/mixins/fileable.js'])]]);

      linkEntities(registry, modelToMixinsMap);

      const docEntity = registry.get('app/models/doc.js')!;
      expect(docEntity.traits).toHaveLength(1);
      expect(docEntity.traits[0]?.baseName).toBe('fileable');
    });
  });
});
