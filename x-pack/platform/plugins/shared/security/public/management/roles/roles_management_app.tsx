/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import { useParams } from 'react-router-dom';

import type { BuildFlavor } from '@kbn/config';
import type { FatalErrorsSetup, StartServicesAccessor } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import { KibanaContextProvider } from '@kbn/kibana-react-plugin/public';
import type { RegisterManagementAppArgs } from '@kbn/management-plugin/public';
import { Route, Router } from '@kbn/shared-ux-router';

import type { SecurityLicense } from '../../../common';
import {
  Breadcrumb,
  BreadcrumbsProvider,
  createBreadcrumbsChangeHandler,
} from '../../components/breadcrumb';
import type { PluginStartDependencies } from '../../plugin';
import { ReadonlyBadge } from '../badges/readonly_badge';
import { tryDecodeURIComponent } from '../url_utils';

interface CreateParams {
  fatalErrors: FatalErrorsSetup;
  license: SecurityLicense;
  getStartServices: StartServicesAccessor<PluginStartDependencies>;
  buildFlavor: BuildFlavor;
}

export const rolesManagementApp = Object.freeze({
  id: 'roles',
  create({ license, getStartServices, buildFlavor }: CreateParams) {
    const title =
      buildFlavor === 'serverless'
        ? i18n.translate('xpack.security.management.rolesTitleServerless', {
            defaultMessage: 'Custom Roles',
          })
        : i18n.translate('xpack.security.management.rolesTitle', {
            defaultMessage: 'Roles',
          });
    return {
      id: this.id,
      order: 20,
      title,
      async mount({ element, setBreadcrumbs, history }) {
        const [
          [startServices, { dataViews, features, spaces, cloud }],
          { RolesGridPage },
          { EditRolePage },
          { RolesAPIClient },
          { IndicesAPIClient },
          { PrivilegesAPIClient },
          { UserAPIClient },
        ] = await Promise.all([
          getStartServices(),
          import('./roles_grid'),
          import('./edit_role'),
          import('./roles_api_client'),
          import('./indices_api_client'),
          import('./privileges_api_client'),
          import('../users'),
        ]);

        const { application, http, chrome } = startServices;

        chrome.docTitle.change(title);

        const rolesAPIClient = new RolesAPIClient(http);

        const EditRolePageWithBreadcrumbs = ({ action }: { action: 'edit' | 'clone' }) => {
          const { roleName } = useParams<{ roleName?: string }>();

          // Additional decoding is a workaround for a bug in react-router's version of the `history` module.
          // See https://github.com/elastic/kibana/issues/82440
          const decodedRoleName = roleName ? tryDecodeURIComponent(roleName) : undefined;

          const breadcrumbObj =
            action === 'edit' && roleName && decodedRoleName
              ? { text: decodedRoleName, href: `/edit/${encodeURIComponent(roleName)}` }
              : {
                  text: i18n.translate('xpack.security.roles.createBreadcrumb', {
                    defaultMessage: 'Create',
                  }),
                };

          const spacesApiUi = spaces?.ui;

          return (
            <Breadcrumb text={breadcrumbObj.text} href={breadcrumbObj.href}>
              <EditRolePage
                action={action}
                roleName={decodedRoleName}
                rolesAPIClient={rolesAPIClient}
                userAPIClient={new UserAPIClient(http)}
                indicesAPIClient={new IndicesAPIClient(http)}
                privilegesAPIClient={new PrivilegesAPIClient(http)}
                getFeatures={features.getFeatures}
                license={license}
                uiCapabilities={application.capabilities}
                dataViews={dataViews}
                history={history}
                spacesApiUi={spacesApiUi}
                buildFlavor={buildFlavor}
                cloudOrgUrl={cloud?.organizationUrl}
                {...startServices}
              />
            </Breadcrumb>
          );
        };

        render(
          startServices.rendering.addContext(
            <KibanaContextProvider services={startServices}>
              <Router history={history}>
                <ReadonlyBadge
                  featureId="roles"
                  tooltip={i18n.translate('xpack.security.management.roles.readonlyTooltip', {
                    defaultMessage: 'Unable to create or edit roles',
                  })}
                />
                <BreadcrumbsProvider
                  onChange={createBreadcrumbsChangeHandler(chrome, setBreadcrumbs)}
                >
                  <Breadcrumb text={title} href="/">
                    <Route path={['/', '']} exact={true}>
                      <RolesGridPage
                        rolesAPIClient={rolesAPIClient}
                        history={history}
                        readOnly={!startServices.application.capabilities.roles.save}
                        buildFlavor={buildFlavor}
                        cloudOrgUrl={cloud?.organizationUrl}
                        {...startServices}
                      />
                    </Route>
                    <Route path="/edit/:roleName?">
                      <EditRolePageWithBreadcrumbs action="edit" />
                    </Route>
                    <Route path="/clone/:roleName">
                      <EditRolePageWithBreadcrumbs action="clone" />
                    </Route>
                  </Breadcrumb>
                </BreadcrumbsProvider>
              </Router>
            </KibanaContextProvider>
          ),
          element
        );

        return () => {
          unmountComponentAtNode(element);
        };
      },
    } as RegisterManagementAppArgs;
  },
});
