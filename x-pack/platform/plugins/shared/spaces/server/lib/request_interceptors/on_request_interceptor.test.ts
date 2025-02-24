/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import type {
  CoreSetup,
  IBasePath,
  IRouter,
  KibanaRequest,
  KibanaResponseFactory,
  RequestHandlerContext,
} from '@kbn/core/server';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { type createRoot, request } from '@kbn/core-test-helpers-kbn-server';

import { initSpacesOnRequestInterceptor } from './on_request_interceptor';

// FAILING: https://github.com/elastic/kibana/issues/58942
describe.skip('onRequestInterceptor', () => {
  let root: ReturnType<typeof createRoot>;

  /**
   *
   * commented out due to hooks being called regardless of skip
   * https://github.com/facebook/jest/issues/8379

   beforeEach(async () => {
    root = createRoot();
  }, 30000);

   afterEach(async () => await root.shutdown());

   */

  function initKbnServer(router: IRouter, basePath: IBasePath) {
    router.get(
      {
        path: '/np_foo',
        security: {
          authz: {
            enabled: false,
            reason: 'This route is opted out from authorization',
          },
        },
        validate: false,
      },
      (context: unknown, req: KibanaRequest, h: KibanaResponseFactory) => {
        return h.ok({ body: { path: req.url.pathname, basePath: basePath.get(req) } });
      }
    );

    router.get(
      {
        path: '/some/path/s/np_foo/bar',
        security: {
          authz: {
            enabled: false,
            reason: 'This route is opted out from authorization',
          },
        },
        validate: false,
      },
      (context: unknown, req: KibanaRequest, h: KibanaResponseFactory) => {
        return h.ok({ body: { path: req.url.pathname, basePath: basePath.get(req) } });
      }
    );

    router.get(
      {
        path: '/i/love/np_spaces',
        security: {
          authz: {
            enabled: false,
            reason: 'This route is opted out from authorization',
          },
        },
        validate: {
          query: schema.object({
            queryParam: schema.string({
              defaultValue: 'oh noes, this was not set on the request correctly',
            }),
          }),
        },
      },
      (context: unknown, req: KibanaRequest, h: KibanaResponseFactory) => {
        return h.ok({
          body: {
            path: req.url.pathname,
            basePath: basePath.get(req),
            query: req.query,
          },
        });
      }
    );
  }

  interface SetupOpts {
    basePath: string;
    routes: 'legacy' | 'new-platform';
  }

  async function setup(opts: SetupOpts = { basePath: '/', routes: 'legacy' }) {
    await root.preboot();
    const { http, elasticsearch } = await root.setup();
    // Mock esNodesCompatibility$ to prevent `root.start()` from blocking on ES version check
    elasticsearch.esNodesCompatibility$ =
      elasticsearchServiceMock.createInternalSetup().esNodesCompatibility$;

    initSpacesOnRequestInterceptor({
      http: http as unknown as CoreSetup['http'],
    });

    const router = http.createRouter<RequestHandlerContext>('/');

    initKbnServer(router, http.basePath);

    await root.start();

    return {
      http,
    };
  }

  describe('requests handled completely in the new platform', () => {
    it('handles paths without a space identifier', async () => {
      await setup({ basePath: '/', routes: 'new-platform' });

      const path = '/np_foo';

      await request.get(root, path).expect(200, {
        path,
        basePath: '', // no base path set for route within the default space
      });
    }, 30000);

    it('strips the Space URL Context from the request', async () => {
      await setup({ basePath: '/', routes: 'new-platform' });

      const path = '/s/foo-space/np_foo';

      await request.get(root, path).expect(200, {
        path: '/np_foo',
        basePath: '/s/foo-space',
      });
    }, 30000);

    it('ignores space identifiers in the middle of the path', async () => {
      await setup({ basePath: '/', routes: 'new-platform' });

      const path = '/some/path/s/np_foo/bar';

      await request.get(root, path).expect(200, {
        path: '/some/path/s/np_foo/bar',
        basePath: '', // no base path set for route within the default space
      });
    }, 30000);

    it('strips the Space URL Context from the request, maintaining the rest of the path', async () => {
      await setup({ basePath: '/', routes: 'new-platform' });

      const path = '/s/foo/i/love/np_spaces?queryParam=queryValue';

      await request.get(root, path).expect(200, {
        path: '/i/love/np_spaces',
        basePath: '/s/foo',
        query: {
          queryParam: 'queryValue',
        },
      });
    }, 30000);
  });
});
