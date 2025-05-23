/**
 * CodeExtractor extracts clean source code from LLM-generated text responses.
 * It handles markdown code blocks, language tags, and LLM-specific annotations.
 */
export class CodeExtractor {
  /**
   * Detects if the generated text contains an actual solution
   * @param generatedText The text generated by the LLM
   * @returns true if the text likely contains code, false otherwise
   */
  static hasCode(generatedText: string): boolean {
    // Check for common code syntax indicators
    return /function\s+\w+\s*\(/i.test(generatedText) || 
           /\(\s*\)\s*=>/i.test(generatedText) ||
           /class\s+\w+/i.test(generatedText) ||
           /```(?:javascript|js|typescript|ts)?[\s\S]*?```/i.test(generatedText);
  }
  /**
   * Extract clean code from LLM-generated text, handling various formats.
   * @param generatedText The raw text generated by the LLM
   * @returns The extracted, cleaned code
   */
  static extractSolution(generatedText: string): string {
    // Remove thinking sections that some LLMs include
    let code = generatedText.replace(/<think>[\s\S]*?<\/think>/g, '');
    
    // First try to extract code from markdown code blocks with language tags
    const markdownMatch = code.match(/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/i);
    
    if (markdownMatch) {
      // Found a proper markdown code block
      code = markdownMatch[1];
    } else {
      // Try a more permissive approach for poorly formatted responses
      // Remove markdown code markers if present but not properly formatted
      code = code.replace(/```(?:javascript|js|typescript|ts)?/gi, '')
               .replace(/```/g, '');
      
      // If we still have XML-like tags, try to extract just the code content
      const xmlMatch = code.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
      if (xmlMatch) {
        code = xmlMatch[1];
      }
    }

    return code.trim();
  }
}
