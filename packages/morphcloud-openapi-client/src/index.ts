import {
  createClient as createGeneratedClient,
  type Client,
  type ClientOptions,
  type Config,
} from './client/client/index.js';

export * from './client/index.js';

export const DEFAULT_MORPHCLOUD_BASE_URL = 'https://cloud.morph.so/api';

export type MorphCloudClient = Client;
export type MorphCloudClientConfig = Config<ClientOptions>;

export const createMorphCloudClient = (
  config: MorphCloudClientConfig = {}
): MorphCloudClient =>
  createGeneratedClient({
    ...config,
    baseUrl: config.baseUrl ?? DEFAULT_MORPHCLOUD_BASE_URL,
  });
