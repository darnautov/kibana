/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/* eslint-disable max-classes-per-file */

import type {
  ElasticsearchClient,
  KibanaRequest,
  Logger,
  SavedObjectsClientContract,
} from '@kbn/core/server';

import { DEFAULT_SPACE_ID } from '@kbn/spaces-plugin/common';

import type { TypeOf } from '@kbn/config-schema';

import { HTTPAuthorizationHeader } from '../../../common/http_authorization_header';

import type { PackageList } from '../../../common';

import type {
  ArchivePackage,
  BundledPackage,
  CategoryId,
  EsAssetReference,
  GetInstalledPackagesRequestSchema,
  InstallablePackage,
  Installation,
  RegistryPackage,
} from '../../types';

import type { FleetAuthzRouteConfig } from '../security/types';
import { checkSuperuser, doesNotHaveRequiredFleetAuthz, getAuthzFromRequest } from '../security';
import { FleetError, FleetUnauthorizedError, PackageNotFoundError } from '../../errors';
import { INSTALL_PACKAGES_AUTHZ, READ_PACKAGE_INFO_AUTHZ } from '../../routes/epm';

import type { InstallResult } from '../../../common';

import { appContextService } from '..';

import type { GetInstalledPackagesResponse } from '../../../common/types';

import {
  type CustomPackageDatasetConfiguration,
  type EnsurePackageResult,
} from './packages/install';

import type { FetchFindLatestPackageOptions } from './registry';
import { getPackageFieldsMetadata } from './registry';
import * as Registry from './registry';
import { fetchFindLatestPackageOrThrow, getPackage } from './registry';

import { installTransforms, isTransform } from './elasticsearch/transform/install';
import {
  ensureInstalledPackage,
  getInstallation,
  getPackages,
  installPackage,
  getTemplateInputs,
  getPackageInfo,
  getInstalledPackages,
} from './packages';
import { generatePackageInfoFromArchiveBuffer } from './archive';
import { getEsPackage } from './archive/storage';
import { createArchiveIteratorFromMap } from './archive/archive_iterator';

export type InstalledAssetType = EsAssetReference;

export interface PackageService {
  asScoped(request: KibanaRequest): PackageClient;
  asInternalUser: PackageClient;
}

export interface PackageClient {
  getInstallation(
    pkgName: string,
    savedObjectsClient?: SavedObjectsClientContract
  ): Promise<Installation | undefined>;

  ensureInstalledPackage(options: {
    pkgName: string;
    pkgVersion?: string;
    spaceId?: string;
    force?: boolean;
  }): Promise<EnsurePackageResult>;

  installPackage(options: {
    pkgName: string;
    pkgVersion?: string;
    spaceId?: string;
    force?: boolean;
    keepFailedInstallation?: boolean;
    useStreaming?: boolean;
    automaticInstall?: boolean;
  }): Promise<InstallResult>;

  installCustomIntegration(options: {
    pkgName: string;
    kibanaVersion?: string;
    force?: boolean;
    spaceId?: string;
    datasets: CustomPackageDatasetConfiguration[];
  }): Promise<InstallResult>;

  fetchFindLatestPackage(
    packageName: string,
    options?: FetchFindLatestPackageOptions
  ): Promise<RegistryPackage | BundledPackage>;

  readBundledPackage(
    bundledPackage: BundledPackage
  ): Promise<{ packageInfo: ArchivePackage; paths: string[] }>;

  getPackage(
    packageName: string,
    packageVersion: string,
    options?: Parameters<typeof getPackage>['2']
  ): ReturnType<typeof getPackage>;

  getPackageFieldsMetadata(
    params: Parameters<typeof getPackageFieldsMetadata>['0'],
    options?: Parameters<typeof getPackageFieldsMetadata>['1']
  ): ReturnType<typeof getPackageFieldsMetadata>;

  getLatestPackageInfo(
    packageName: string,
    prerelease?: boolean
  ): ReturnType<typeof getPackageInfo>;

  getPackages(params?: {
    excludeInstallStatus?: boolean;
    category?: CategoryId;
    prerelease?: boolean;
  }): Promise<PackageList>;

  getAgentPolicyConfigYAML(
    pkgName: string,
    pkgVersion?: string,
    prerelease?: boolean,
    ignoreUnverified?: boolean
  ): Promise<string>;

  reinstallEsAssets(
    packageInfo: InstallablePackage,
    assetPaths: string[]
  ): Promise<InstalledAssetType[]>;

  getInstalledPackages(
    params: TypeOf<typeof GetInstalledPackagesRequestSchema.query>
  ): Promise<GetInstalledPackagesResponse>;
}

export class PackageServiceImpl implements PackageService {
  constructor(
    private readonly internalEsClient: ElasticsearchClient,
    private readonly internalSoClient: SavedObjectsClientContract,
    private readonly logger: Logger
  ) {}

  public asScoped(request: KibanaRequest) {
    const preflightCheck = async (requiredAuthz?: FleetAuthzRouteConfig['fleetAuthz']) => {
      if (requiredAuthz) {
        const requestedAuthz = await getAuthzFromRequest(request);

        const noRequiredAuthz = doesNotHaveRequiredFleetAuthz(requestedAuthz, requiredAuthz);
        if (noRequiredAuthz) {
          throw new FleetUnauthorizedError(
            `User does not have adequate permissions to access Fleet packages.`
          );
        }
      } else if (!checkSuperuser(request)) {
        throw new FleetUnauthorizedError(
          `User does not have adequate permissions to access Fleet packages.`
        );
      }
    };

    return new PackageClientImpl(
      this.internalEsClient,
      this.internalSoClient,
      this.logger,
      preflightCheck,
      request
    );
  }

  public get asInternalUser() {
    return new PackageClientImpl(this.internalEsClient, this.internalSoClient, this.logger);
  }
}

class PackageClientImpl implements PackageClient {
  private authorizationHeader?: HTTPAuthorizationHeader | null = undefined;

  constructor(
    private readonly internalEsClient: ElasticsearchClient,
    private readonly internalSoClient: SavedObjectsClientContract,
    private readonly logger: Logger,
    private readonly preflightCheck?: (
      requiredAuthz?: FleetAuthzRouteConfig['fleetAuthz']
    ) => void | Promise<void>,
    private readonly request?: KibanaRequest
  ) {}

  private getAuthorizationHeader() {
    if (this.request) {
      this.authorizationHeader = HTTPAuthorizationHeader.parseFromRequest(this.request);
      return this.authorizationHeader;
    }
  }

  public async getInstallation(
    pkgName: string,
    savedObjectsClient: SavedObjectsClientContract = this.internalSoClient
  ) {
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);
    return getInstallation({
      pkgName,
      savedObjectsClient,
    });
  }

  public async ensureInstalledPackage(options: {
    pkgName: string;
    pkgVersion?: string;
    spaceId?: string;
    force?: boolean;
  }): Promise<EnsurePackageResult> {
    await this.#runPreflight(INSTALL_PACKAGES_AUTHZ);

    return ensureInstalledPackage({
      ...options,
      esClient: this.internalEsClient,
      savedObjectsClient: this.internalSoClient,
    });
  }

  public async installPackage(options: {
    pkgName: string;
    pkgVersion?: string;
    spaceId?: string;
    force?: boolean;
    keepFailedInstallation?: boolean;
    useStreaming?: boolean;
    automaticInstall?: boolean;
  }): Promise<InstallResult> {
    await this.#runPreflight(INSTALL_PACKAGES_AUTHZ);

    const {
      pkgName,
      pkgVersion,
      spaceId = DEFAULT_SPACE_ID,
      force = false,
      keepFailedInstallation,
      useStreaming,
      automaticInstall,
    } = options;

    // If pkgVersion isn't specified, find the latest package version
    const pkgKeyProps = pkgVersion
      ? { name: pkgName, version: pkgVersion }
      : await Registry.fetchFindLatestPackageOrThrow(pkgName, { prerelease: true });
    const pkgkey = Registry.pkgToPkgKey(pkgKeyProps);

    return await installPackage({
      force,
      pkgkey,
      spaceId,
      installSource: 'registry',
      esClient: this.internalEsClient,
      savedObjectsClient: this.internalSoClient,
      neverIgnoreVerificationError: !force,
      keepFailedInstallation,
      useStreaming,
      automaticInstall,
    });
  }

  public async installCustomIntegration(options: {
    pkgName: string;
    kibanaVersion?: string;
    force?: boolean | undefined;
    spaceId?: string | undefined;
    datasets: CustomPackageDatasetConfiguration[];
  }): Promise<InstallResult> {
    await this.#runPreflight(INSTALL_PACKAGES_AUTHZ);

    const {
      pkgName,
      kibanaVersion = appContextService.getKibanaVersion(),
      datasets,
      spaceId = DEFAULT_SPACE_ID,
      force = false,
    } = options;

    return await installPackage({
      force,
      pkgName,
      kibanaVersion,
      datasets,
      spaceId,
      installSource: 'custom',
      esClient: this.internalEsClient,
      savedObjectsClient: this.internalSoClient,
      neverIgnoreVerificationError: !force,
      authorizationHeader: this.getAuthorizationHeader(),
    });
  }

  public async fetchFindLatestPackage(
    packageName: string,
    options?: FetchFindLatestPackageOptions
  ): Promise<RegistryPackage | BundledPackage> {
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);
    return fetchFindLatestPackageOrThrow(packageName, options);
  }

  public async readBundledPackage(bundledPackage: BundledPackage) {
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);
    const archiveBuffer = await bundledPackage.getBuffer();

    return generatePackageInfoFromArchiveBuffer(archiveBuffer, 'application/zip');
  }

  public async getAgentPolicyConfigYAML(
    pkgName: string,
    pkgVersion?: string,
    prerelease?: boolean,
    ignoreUnverified?: boolean
  ) {
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);

    // If pkgVersion isn't specified, find the latest package version
    if (!pkgVersion) {
      const pkg = await Registry.fetchFindLatestPackageOrThrow(pkgName, { prerelease });
      pkgVersion = pkg.version;
    }

    return getTemplateInputs(
      this.internalSoClient,
      pkgName,
      pkgVersion,
      'yml',
      prerelease,
      ignoreUnverified
    );
  }

  public async getPackage(
    packageName: string,
    packageVersion: string,
    options?: Parameters<typeof getPackage>['2']
  ) {
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);
    return getPackage(packageName, packageVersion, options);
  }

  public async getPackageFieldsMetadata(
    params: Parameters<typeof getPackageFieldsMetadata>['0'],
    options?: Parameters<typeof getPackageFieldsMetadata>['1']
  ) {
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);
    return getPackageFieldsMetadata(params, options);
  }

  public async getLatestPackageInfo(packageName: string, prerelease?: boolean) {
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);
    return getPackageInfo({
      savedObjectsClient: this.internalSoClient,
      pkgName: packageName,
      pkgVersion: '',
      prerelease,
    });
  }

  public async getPackages(params?: {
    excludeInstallStatus?: boolean;
    category?: CategoryId;
    prerelease?: boolean;
  }) {
    const { excludeInstallStatus, category, prerelease } = params || {};
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);
    return getPackages({
      savedObjectsClient: this.internalSoClient,
      excludeInstallStatus,
      category,
      prerelease,
    });
  }

  public async getInstalledPackages(
    params: TypeOf<typeof GetInstalledPackagesRequestSchema.query>
  ): Promise<GetInstalledPackagesResponse> {
    await this.#runPreflight(READ_PACKAGE_INFO_AUTHZ);

    return getInstalledPackages({
      savedObjectsClient: this.internalSoClient,
      esClient: this.internalEsClient,
      ...params,
    });
  }

  public async reinstallEsAssets(
    packageInfo: InstallablePackage,
    assetPaths: string[]
  ): Promise<InstalledAssetType[]> {
    await this.#runPreflight(INSTALL_PACKAGES_AUTHZ);
    let installedAssets: InstalledAssetType[] = [];

    const transformPaths = assetPaths.filter(isTransform);

    if (transformPaths.length !== assetPaths.length) {
      throw new FleetError('reinstallEsAssets is currently only implemented for transform assets');
    }

    if (transformPaths.length) {
      const installedTransformAssets = await this.#reinstallTransforms(packageInfo, transformPaths);
      installedAssets = [...installedAssets, ...installedTransformAssets];
    }

    return installedAssets;
  }

  async #reinstallTransforms(packageInfo: InstallablePackage, paths: string[]) {
    const authorizationHeader = this.getAuthorizationHeader();

    const installation = await this.getInstallation(packageInfo.name);

    if (!installation) {
      throw new PackageNotFoundError(`Installation not found for package: ${packageInfo.name}`);
    }

    const esPackage = await getEsPackage(
      packageInfo.name,
      packageInfo.version,
      installation.package_assets ?? [],
      this.internalSoClient
    );

    if (!esPackage) {
      throw new PackageNotFoundError(`ES package not found for package: ${packageInfo.name}`);
    }

    const { assetsMap } = esPackage;
    const archiveIterator = createArchiveIteratorFromMap(assetsMap);

    const { installedTransforms } = await installTransforms({
      packageInstallContext: {
        packageInfo,
        paths,
        archiveIterator,
      },
      esClient: this.internalEsClient,
      savedObjectsClient: this.internalSoClient,
      logger: this.logger,
      force: true,
      esReferences: undefined,
      authorizationHeader,
    });
    return installedTransforms;
  }

  async #runPreflight(requiredAuthz?: FleetAuthzRouteConfig['fleetAuthz']) {
    if (this.preflightCheck) {
      return await this.preflightCheck(requiredAuthz);
    }
  }
}
