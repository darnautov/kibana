/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import type {
  CoreSetup,
  PluginInitializer,
  SavedObject,
  SavedObjectsNamespaceType,
  SavedObjectUnsanitizedDoc,
} from '@kbn/core/server';
import type { SavedObjectModelTransformationDoc } from '@kbn/core-saved-objects-server';
import type {
  EncryptedSavedObjectsPluginSetup,
  EncryptedSavedObjectsPluginStart,
} from '@kbn/encrypted-saved-objects-plugin/server';
import type { SpacesPluginSetup } from '@kbn/spaces-plugin/server';
import { deepFreeze } from '@kbn/std';

import { registerHiddenSORoutes } from './hidden_saved_object_routes';

const SAVED_OBJECT_WITH_SECRET_TYPE = 'saved-object-with-secret';
const HIDDEN_SAVED_OBJECT_WITH_SECRET_TYPE = 'hidden-saved-object-with-secret';
const SAVED_OBJECT_WITH_SECRET_AND_MULTIPLE_SPACES_TYPE =
  'saved-object-with-secret-and-multiple-spaces';
const SAVED_OBJECT_WITHOUT_SECRET_TYPE = 'saved-object-without-secret';

const SAVED_OBJECT_WITH_MIGRATION_TYPE = 'saved-object-with-migration';

const SAVED_OBJECT_MV_TYPE = 'saved-object-mv';

const TYPE_WITH_PREDICTABLE_ID = 'type-with-predictable-ids';

interface MigratedTypePre790 {
  nonEncryptedAttribute: string;
  encryptedAttribute: string;
}
interface MigratedType {
  nonEncryptedAttribute: string;
  encryptedAttribute: string;
  additionalEncryptedAttribute: string;
}

export interface PluginsSetup {
  encryptedSavedObjects: EncryptedSavedObjectsPluginSetup;
  spaces: SpacesPluginSetup;
}

export interface PluginsStart {
  encryptedSavedObjects: EncryptedSavedObjectsPluginStart;
  spaces: never;
}

export const plugin: PluginInitializer<void, void, PluginsSetup, PluginsStart> = async () => ({
  setup(core: CoreSetup<PluginsStart>, deps: PluginsSetup) {
    for (const [name, namespaceType, hidden] of [
      [SAVED_OBJECT_WITH_SECRET_TYPE, 'single', false],
      [HIDDEN_SAVED_OBJECT_WITH_SECRET_TYPE, 'single', true],
      [SAVED_OBJECT_WITH_SECRET_AND_MULTIPLE_SPACES_TYPE, 'multiple', false],
    ] as Array<[string, SavedObjectsNamespaceType, boolean]>) {
      core.savedObjects.registerType({
        name,
        hidden,
        namespaceType,
        mappings: deepFreeze({
          properties: {
            publicProperty: { type: 'keyword' },
            publicPropertyExcludedFromAAD: { type: 'keyword' },
            publicPropertyStoredEncrypted: { type: 'binary' },
            privateProperty: { type: 'binary' },
          },
        }),
      });

      deps.encryptedSavedObjects.registerType({
        type: name,
        attributesToEncrypt: new Set([
          'privateProperty',
          { key: 'publicPropertyStoredEncrypted', dangerouslyExposeValue: true },
        ]),
        attributesToIncludeInAAD: new Set(['publicProperty']),
      });
    }

    core.savedObjects.registerType({
      name: TYPE_WITH_PREDICTABLE_ID,
      hidden: false,
      namespaceType: 'single',
      mappings: deepFreeze({
        properties: {
          publicProperty: { type: 'keyword' },
          publicPropertyExcludedFromAAD: { type: 'keyword' },
          publicPropertyStoredEncrypted: { type: 'binary' },
          privateProperty: { type: 'binary' },
        },
      }),
    });

    deps.encryptedSavedObjects.registerType({
      type: TYPE_WITH_PREDICTABLE_ID,
      attributesToEncrypt: new Set([
        'privateProperty',
        { key: 'publicPropertyStoredEncrypted', dangerouslyExposeValue: true },
      ]),
      attributesToIncludeInAAD: new Set(['publicProperty']),
      enforceRandomId: false,
    });

    core.savedObjects.registerType({
      name: SAVED_OBJECT_WITHOUT_SECRET_TYPE,
      hidden: false,
      namespaceType: 'single',
      mappings: deepFreeze({ properties: { publicProperty: { type: 'keyword' } } }),
    });

    defineTypeWithMigration(core, deps);

    defineModelVersionWithMigration(core, deps);

    const router = core.http.createRouter();
    router.get(
      {
        path: '/api/saved_objects/get-decrypted-as-internal-user/{type}/{id}',
        security: {
          authz: {
            enabled: false,
            reason: 'This route is opted out from authorization',
          },
        },
        validate: { params: (value) => ({ value }) },
      },
      async (context, request, response) => {
        const [, { encryptedSavedObjects }] = await core.getStartServices();
        const spaceId = deps.spaces.spacesService.getSpaceId(request);
        const namespace = deps.spaces.spacesService.spaceIdToNamespace(spaceId);

        try {
          return response.ok({
            body: await encryptedSavedObjects
              .getClient()
              .getDecryptedAsInternalUser(request.params.type, request.params.id, { namespace }),
          });
        } catch (err) {
          if (encryptedSavedObjects.isEncryptionError(err)) {
            return response.badRequest({ body: 'Failed to decrypt attributes' });
          }

          return response.customError({ body: err, statusCode: 500 });
        }
      }
    );

    router.get(
      {
        path: '/api/saved_objects/create-point-in-time-finder-decrypted-as-internal-user',
        security: {
          authz: {
            enabled: false,
            reason: 'This route is opted out from authorization',
          },
        },
        validate: { query: schema.object({ type: schema.string() }) },
      },
      async (context, request, response) => {
        const [, { encryptedSavedObjects }] = await core.getStartServices();
        const spaceId = deps.spaces.spacesService.getSpaceId(request);
        const namespace = deps.spaces.spacesService.spaceIdToNamespace(spaceId);

        const { type } = request.query;

        let savedObjects: SavedObject[] = [];
        const finder = await encryptedSavedObjects
          .getClient()
          .createPointInTimeFinderDecryptedAsInternalUser({
            type,
            ...(namespace ? { namespaces: [namespace] } : undefined),
          });

        for await (const result of finder.find()) {
          savedObjects = [...savedObjects, ...result.saved_objects];
        }

        try {
          return response.ok({
            body: { saved_objects: savedObjects },
          });
        } catch (err) {
          return response.customError({ body: err, statusCode: 500 });
        }
      }
    );

    registerHiddenSORoutes(router, core, deps, [HIDDEN_SAVED_OBJECT_WITH_SECRET_TYPE]);
  },
  start() {},
  stop() {},
});

function defineTypeWithMigration(core: CoreSetup<PluginsStart>, deps: PluginsSetup) {
  const typePriorTo790 = {
    type: SAVED_OBJECT_WITH_MIGRATION_TYPE,
    attributesToEncrypt: new Set(['encryptedAttribute']),
    attributesToIncludeInAAD: new Set(['nonEncryptedAttribute']), // No attributes were excluded previously, so we have to add this
  };

  // current type is registered
  deps.encryptedSavedObjects.registerType({
    type: SAVED_OBJECT_WITH_MIGRATION_TYPE,
    attributesToEncrypt: new Set(['encryptedAttribute', 'additionalEncryptedAttribute']),
    attributesToIncludeInAAD: new Set(['nonEncryptedAttribute']), // No attributes were excluded previously, so we have to add this
  });

  core.savedObjects.registerType({
    name: SAVED_OBJECT_WITH_MIGRATION_TYPE,
    hidden: false,
    namespaceType: 'multiple-isolated', // in data.json, we simulate that existing objects were created with `namespaceType: 'single'`
    convertToMultiNamespaceTypeVersion: '8.0.0', // in this version we convert from a single-namespace type to a "share-capable" multi-namespace isolated type
    mappings: {
      properties: {
        nonEncryptedAttribute: {
          type: 'keyword',
        },
        encryptedAttribute: {
          type: 'binary',
        },
        additionalEncryptedAttribute: {
          type: 'keyword',
        },
      },
    },
    migrations: {
      // in this version we migrated a non encrypted field and type didnt change
      '7.8.0': deps.encryptedSavedObjects.createMigration<MigratedTypePre790, MigratedTypePre790>({
        isMigrationNeededPredicate: function shouldBeMigrated(
          doc
        ): doc is SavedObjectUnsanitizedDoc<MigratedTypePre790> {
          return true;
        },
        migration: (
          doc: SavedObjectUnsanitizedDoc<MigratedTypePre790>
        ): SavedObjectUnsanitizedDoc<MigratedTypePre790> => {
          const {
            attributes: { nonEncryptedAttribute },
          } = doc;
          return {
            ...doc,
            attributes: {
              ...doc.attributes,
              nonEncryptedAttribute: `${nonEncryptedAttribute}-migrated`,
            },
          };
        },
        // type hasn't changed as the field we're updating is not an encrypted one
        inputType: typePriorTo790,
        migratedType: typePriorTo790,
      }),
      // in this version we encrypted an existing non encrypted field
      '7.9.0': deps.encryptedSavedObjects.createMigration<MigratedTypePre790, MigratedType>({
        isMigrationNeededPredicate: function shouldBeMigrated(
          doc
        ): doc is SavedObjectUnsanitizedDoc<MigratedTypePre790> {
          return true;
        },
        migration: (
          doc: SavedObjectUnsanitizedDoc<MigratedTypePre790>
        ): SavedObjectUnsanitizedDoc<MigratedType> => {
          const {
            attributes: { nonEncryptedAttribute },
          } = doc;
          return {
            ...doc,
            attributes: {
              ...doc.attributes,
              nonEncryptedAttribute,
              // clone and modify the non encrypted field
              additionalEncryptedAttribute: `${nonEncryptedAttribute}-encrypted`,
            },
          };
        },
        inputType: typePriorTo790,
      }),

      // NOTE FOR MAINTAINERS: do not add any more migrations before 8.0.0 unless you regenerate the test data for two of the objects in
      // data.json: '362828f0-eef2-11eb-9073-11359682300a' and '36448a90-eef2-11eb-9073-11359682300a. These are used in the test cases 'for
      // a saved object that does not need to be migrated before it is converted'.

      // This empty migration is necessary to ensure that the saved object is decrypted with its old descriptor/ and re-encrypted with its
      // new descriptor, if necessary. This is included because the saved object is being converted to `namespaceType: 'multiple-isolated'`
      // in 8.0.0 (see the `convertToMultiNamespaceTypeVersion` field in the saved object type registration process).
      '8.0.0': deps.encryptedSavedObjects.createMigration<MigratedType, MigratedType>({
        isMigrationNeededPredicate: (doc): doc is SavedObjectUnsanitizedDoc<MigratedType> => true,
        migration: (doc) => doc, // no-op
      }),
    },
  });
}

function defineModelVersionWithMigration(core: CoreSetup<PluginsStart>, deps: PluginsSetup) {
  const typePriorTo810 = {
    type: SAVED_OBJECT_MV_TYPE,
    attributesToEncrypt: new Set(['encryptedAttribute']),
    attributesToIncludeInAAD: new Set(['nonEncryptedAttribute']),
  };

  const latestType = {
    type: SAVED_OBJECT_MV_TYPE,
    attributesToEncrypt: new Set(['encryptedAttribute', 'additionalEncryptedAttribute']),
    attributesToIncludeInAAD: new Set(['nonEncryptedAttribute']),
  };
  deps.encryptedSavedObjects.registerType(latestType);

  core.savedObjects.registerType({
    name: SAVED_OBJECT_MV_TYPE,
    hidden: false,
    management: { importableAndExportable: true },
    namespaceType: 'multiple-isolated',
    mappings: {
      properties: {
        nonEncryptedAttribute: {
          type: 'keyword',
        },
        encryptedAttribute: {
          type: 'binary',
        },
        additionalEncryptedAttribute: {
          type: 'keyword',
        },
      },
    },
    modelVersions: {
      '1': deps.encryptedSavedObjects.createModelVersion({
        modelVersion: {
          changes: [
            {
              type: 'unsafe_transform',
              transformFn: (typeSafeGuard) =>
                typeSafeGuard(
                  // ideally, we should use generic types for the whole function, defining it on a separate const
                  (
                    document: SavedObjectModelTransformationDoc<{
                      additionalEncryptedAttribute: string;
                      nonEncryptedAttribute: string;
                    }>
                  ) => {
                    const {
                      attributes: { nonEncryptedAttribute },
                    } = document;
                    document.attributes.nonEncryptedAttribute = `${nonEncryptedAttribute}-migrated`;
                    return { document };
                  }
                ),
            },
          ],
        },
        inputType: typePriorTo810,
        outputType: typePriorTo810,
        shouldTransformIfDecryptionFails: true,
      }),
      '2': deps.encryptedSavedObjects.createModelVersion({
        modelVersion: {
          changes: [
            {
              type: 'unsafe_transform',
              transformFn: (typeSafeGuard) =>
                typeSafeGuard(
                  // ideally, we should use generic types for the whole function, defining it on a separate const
                  (
                    document: SavedObjectModelTransformationDoc<{
                      additionalEncryptedAttribute: string;
                      nonEncryptedAttribute: string;
                    }>
                  ) => {
                    // clone and modify the non encrypted field
                    document.attributes.additionalEncryptedAttribute = `${document.attributes.nonEncryptedAttribute}-encrypted`;
                    return { document };
                  }
                ),
            },
          ],
        },
        inputType: typePriorTo810,
        outputType: latestType,
        shouldTransformIfDecryptionFails: true,
      }),
    },
  });
}
