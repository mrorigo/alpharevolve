/**
 * CodeExtractor extracts LLM-generated source code.
 * It extracts the code block and removes extraneous markdown and tags.
 */
export class CodeExtractor {
  /**
   * Apply modifications to a parent code snippet using generated text.
   * @param generatedText The generated text from the LLM.
   * @returns The extracted code if valid; otherwise, the original parentCode.
   */
  static extractSolution(generatedText: string): string {
    let code = generatedText.replace(/<think>[\s\S]*?<\/think>/g, '');
    const match = code.match(/```(?:javascript)?\s*([\s\S]*?)```/i);
    if (match) {
      code = match[1];
    } else {
      code = code.replace(/```(?:javascript)?/gi, '').replace(/```/g, '');
    }

    return code.trim();
  }
}
