import OpenAI from 'openai';

/**
 * LlmService provides a wrapper for interacting with the OpenAI API.
 */
export class LlmService {
  private openai: OpenAI;

  /**
   * Constructs a new LlmService instance.
   * @param baseURL OpenAI API base URL.
   * @param apiKey OpenAI API key.
   */
  constructor(baseURL: string, apiKey: string) {
    this.openai = new OpenAI({
      baseURL,
      apiKey,
    });
  }

  /**
   * Generates code using the OpenAI API.
   * @param prompt The prompt to send.
   * @param model The LLM model.
   * @param temperature Controls randomness.
   * @param maxTokens Maximum tokens for the response.
   * @returns The generated code as a string.
   */
  async generateCode(prompt: string, model: string, temperature = 0.7, maxTokens = 2048): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are an expert developer optimizing code.' },
          { role: 'user', content: prompt }
        ],
        temperature,
        max_tokens: maxTokens,
      } as any);
      const generated = response.choices[0]?.message?.content || '';
      console.log('LLM response:', generated);
      return generated;
    } catch (error) {
      console.error('Error generating code:', error);
      throw new Error(`LLM code generation failed: ${error}`);
    }
  }
}
