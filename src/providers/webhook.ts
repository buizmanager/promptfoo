import logger from '../logger';
import { fetchWithCache } from '../cache';

import { REQUEST_TIMEOUT_MS } from './shared';

import type { ApiProvider, ProviderOptions, ProviderResponse } from '../types.js';

export class WebhookProvider implements ApiProvider {
  webhookUrl: string;
  options: ProviderOptions;
  config?: object;

  constructor(webhookUrl: string, options: ProviderOptions = {}) {
    this.webhookUrl = webhookUrl;
    this.options = options;
    this.config = options.config;
  }

  get model(): string {
    return `webhook:${this.webhookUrl}`;
  }

  get label(): string {
    return this.options.label || this.model;
  }

  toString(): string {
    return `[Webhook Provider ${this.webhookUrl}]`;
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const params: { prompt: string; config?: object } = {
      prompt,
    };
    if (this.config) {
      params.config = this.config;
    }

    logger.debug(`Calling Webhook: ${this.webhookUrl} with params: ${JSON.stringify(params)}`);
    let response;
    try {
      response = await fetchWithCache(
        this.webhookUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
        },
        REQUEST_TIMEOUT_MS,
        'json',
      );
    } catch (err) {
      return {
        error: `Webhook call error: ${String(err)}`,
      };
    }
    logger.debug(`\tWebhook response: ${JSON.stringify(response.data)}`);

    if (response.data && typeof response.data.output === 'string') {
      return {
        output: response.data.output,
      };
    } else {
      return {
        error: `Webhook response error: Unexpected response format: ${JSON.stringify(
          response.data,
        )}`,
      };
    }
  }
}
