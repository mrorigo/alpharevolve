import OpenAI from 'openai';

/**
 * Interface for retry options when calling LLM APIs
 */
export interface RetryOptions {
  /** Maximum number of retries before giving up */
  maxRetries: number;
  /** Initial delay before first retry in ms */
  initialDelayMs: number;
  /** Factor to increase delay by on each retry */
  backoffFactor: number;
  /** List of error codes or messages that should trigger a retry */
  retryableErrors: string[];
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffFactor: 2,
  retryableErrors: [
    'rate_limit_exceeded', 
    '429',
    'timeout',
    'server_error',
    '5',
    'connection'
  ]
};

/**
 * LlmService provides a robust wrapper for interacting with LLM APIs.
 * It handles retries, error normalization, and provides consistent interfaces
 * regardless of the underlying LLM provider.
 */
export class LlmService {
  private readonly openai: OpenAI;
  private readonly retryOptions: RetryOptions;

  /**
   * Constructs a new LlmService instance.
   * @param baseURL API base URL for the LLM provider
   * @param apiKey Authentication key for the LLM provider
   * @param retryOptions Configuration for retry behavior on API failures
   */
  constructor(baseURL: string, apiKey: string, retryOptions?: Partial<RetryOptions>) {
    this.openai = new OpenAI({
      baseURL,
      apiKey,
      timeout: 60000, // 60 second timeout
    });
    
    // Merge default options with any provided options
    this.retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      ...retryOptions
    };
  }

  /**
   * Sleep for the specified duration
   * @param ms Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Determines if an error should trigger a retry
   * @param error The error to check
   * @returns True if the error is retryable
   */
  private isRetryableError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorCode = error?.status?.toString() || '';
    
    return this.retryOptions.retryableErrors.some(retryableError => 
      errorMessage.includes(retryableError.toLowerCase()) || 
      errorCode.startsWith(retryableError)
    );
  }

  /**
   * Generates code using the LLM API with robust error handling and retries.
   * @param prompt The prompt to send
   * @param model LLM model identifier
   * @param temperature Controls randomness (0.0-1.0)
   * @param maxTokens Maximum tokens for the response
   * @returns The generated code as a string
   * @throws Error if all retries fail
   */
  async generateCode(
    prompt: string, 
    model: string, 
    temperature = 0.7, 
    maxTokens = 2048
  ): Promise<string> {
    let retries = 0;
    let delay = this.retryOptions.initialDelayMs;
    
    while (true) {
      try {
        const systemPrompt = 'You are an expert developer optimizing code. Respond with well-structured, efficient solutions that prioritize correctness, performance, and readability.';
        
        const response = await this.openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens,
        } as any);
        
        const generated = response.choices[0]?.message?.content || '';
        
        if (!generated || generated.trim().length < 10) {
          throw new Error('LLM returned empty or very short response');
        }
        
        // Log a preview of the response (not the full text to avoid console spam)
        const previewText = generated.length > 100 
          ? `${generated.substring(0, 100)}... (${generated.length} chars total)`
          : generated;
        console.log(`LLM response: ${previewText}`);
        
        return generated;
      } catch (error: any) {
        const isRetryable = this.isRetryableError(error);
        
        // If we've exhausted retries or it's not a retryable error, rethrow
        if (retries >= this.retryOptions.maxRetries || !isRetryable) {
          console.error(`LLM request failed after ${retries} retries:`, error);
          throw new Error(`LLM code generation failed: ${error.message || error}`);
        }
        
        // Prepare for retry
        retries++;
        console.warn(`LLM request failed, retrying (${retries}/${this.retryOptions.maxRetries}): ${error.message}`);
        
        // Exponential backoff
        await this.delay(delay);
        delay *= this.retryOptions.backoffFactor;
      }
    }
  }
}
