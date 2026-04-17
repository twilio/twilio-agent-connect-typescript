import { Logger, createLogger } from '../lib/logger';
import { TACConfig } from '../lib/config';
import packageJson from '../../../../package.json' with { type: 'json' };
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';

function buildUserAgent(): string {
  return `twilio-agent-connect-typescript/${packageJson.version}`;
}

/**
 * Base HTTP client for Twilio API services
 *
 * Features:
 * - Automatic Basic Auth using Twilio API credentials
 * - User-Agent header injection
 * - 30-second request timeout
 * - Automatic retry (up to 3 retries / 4 total attempts with exponential backoff)
 * - Error logging for failed requests
 * - Automatic JSON serialization/deserialization
 */
export abstract class BaseClient {
  protected readonly baseUrl: string;
  protected readonly logger: Logger;
  protected readonly axiosInstance: AxiosInstance;

  constructor(baseUrl: string, config: TACConfig, logger?: Logger) {
    this.baseUrl = baseUrl;
    this.logger = logger || createLogger({ name: this.constructor.name });

    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      auth: {
        username: config.twilioApiKey,
        password: config.twilioApiToken,
      },
      headers: {
        'User-Agent': buildUserAgent(),
      },
    });

    axiosRetry(this.axiosInstance, {
      retries: 3,
      retryDelay: retryCount => axiosRetry.exponentialDelay(retryCount),
      retryCondition: error => {
        // Retry network/no-response errors for any method, and retry 5xx/429 responses only for idempotent methods
        // (which helps prevent duplicate side effects on non-idempotent requests such as POST)
        return axiosRetry.isNetworkOrIdempotentRequestError(error);
      },
    });

    // Response interceptor for error logging
    this.axiosInstance.interceptors.response.use(
      response => response,
      error => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const logContext = {
            error: error.message,
            method: error.config?.method,
            url: error.config?.url,
            status,
          };
          // Log 4xx as warn (client errors, may be expected/handled)
          // Log 5xx/network as error (server/infrastructure failures)
          if (status !== undefined && status >= 400 && status < 500) {
            this.logger.warn(logContext, 'HTTP request client error');
          } else {
            this.logger.error(logContext, 'HTTP request error');
          }
        }
        throw error;
      }
    );
  }

  /**
   * Make an HTTP request with automatic header injection and error handling
   *
   * @param url - The URL path (relative to baseURL)
   * @param method - HTTP method (GET, POST, etc.)
   * @param data - Optional request body (will be automatically serialized to JSON)
   * @param params - Optional query string parameters
   * @returns Promise resolving to the response data (already parsed from JSON)
   * @throws Error on timeout, HTTP errors, or network failures
   */
  protected async makeRequest<TResponse = unknown>(
    url: string,
    method: string,
    data?: unknown,
    params?: Record<string, string>
  ): Promise<TResponse> {
    const response = await this.axiosInstance.request<TResponse>({
      url,
      method,
      data,
      params,
    });

    return response.data;
  }
}
