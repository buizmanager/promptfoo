import logger from '../logger';
import type {
  ApiProvider,
  CallApiContextParams,
  CallApiOptionsParams,
  ProviderOptions,
  ProviderResponse,
} from '../types';
import invariant from '../util/invariant';
import { getNunjucksEngine } from '../util/templates';

interface SequenceProviderConfig {
  inputs: string[];
  separator?: string;
}

export class SequenceProvider implements ApiProvider {
  private readonly inputs: string[];
  private readonly separator: string;
  private readonly identifier: string;
  private readonly targetProvider?: ApiProvider; // Make optional to match ProviderOptions

  constructor({ id, config, provider }: ProviderOptions) {
    invariant(
      config && Array.isArray(config.inputs),
      'Expected sequence provider config to contain an array of inputs',
    );

    const typedConfig = config as SequenceProviderConfig;
    this.inputs = typedConfig.inputs;
    this.separator = typedConfig.separator || '\n---\n';
    this.identifier = id || 'sequence-provider';
    this.targetProvider = provider; // Store the provider passed in constructor
  }

  id() {
    return this.identifier;
  }

  async callApi(
    prompt: string,
    context?: CallApiContextParams,
    options?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    // Use the stored target provider instead of context.originalProvider
    const provider = this.targetProvider || context?.originalProvider;
    invariant(provider, 'No provider available for sequence provider');

    const nunjucks = getNunjucksEngine();
    const responses: string[] = [];
    const totalTokenUsage = {
      total: 0,
      prompt: 0,
      completion: 0,
      numRequests: 0,
      cached: 0,
    };

    // Send each input to the target provider
    for (const input of this.inputs) {
      const renderedInput = nunjucks.renderString(input, {
        ...context?.vars,
        prompt,
      });

      logger.debug(`Sequence provider sending input: ${renderedInput}`);

      const response = await provider.callApi(renderedInput, context, options);

      if (response.error) {
        return response;
      }

      responses.push(response.output);

      // Accumulate token usage if available
      if (response.tokenUsage) {
        totalTokenUsage.total += response.tokenUsage.total || 0;
        totalTokenUsage.prompt += response.tokenUsage.prompt || 0;
        totalTokenUsage.completion += response.tokenUsage.completion || 0;
        totalTokenUsage.numRequests += response.tokenUsage.numRequests || 1;
        totalTokenUsage.cached += response.tokenUsage.cached || 0;
      } else {
        totalTokenUsage.numRequests += 1;
      }
    }

    return {
      output: responses.join(this.separator),
      tokenUsage: totalTokenUsage,
    };
  }

  toString() {
    return `[Sequence Provider]`;
  }
}
