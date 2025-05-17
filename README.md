# AlphaRevolve: Evolutionary Optimization Meets LLM Superpowers

Welcome to **AlphaRevolve**—your new secret weapon for code and algorithm optimization. Inspired by DeepMind’s AlphaEvolve, AlphaRevolve lets you combine the relentless search of evolutionary algorithms with the creative spark of large language models (LLMs). The result? Smarter, faster, and more idiomatic solutions—discovered automatically.

---

## 🚀 What Is AlphaRevolve?

AlphaRevolve is a TypeScript framework that orchestrates a feedback-driven loop between your code, your tests, and an LLM (OpenAI, Gemini, Ollama, etc.). It doesn’t just mutate code at random—it *learns* from each iteration, using robust fitness functions and LLM-generated feedback to guide evolution toward your goals.

- **AI-Driven Evolution:** LLMs propose targeted improvements, not just random mutations.
- **Automated, Safe Evaluation:** Every candidate is tested in isolation—no rogue code in your main process.
- **Flexible Fitness:** Optimize for speed, correctness, idiomatic style, security, or anything you can measure.
- **Full History & Visualization:** Every step is logged. Explore the evolutionary journey in your browser.
- **Robust Error Handling:** Automatic retries, exponential backoff, and graceful failure recovery.
- **Memory & Performance Tracking:** Detailed metrics on memory usage, CPU time, and garbage collection.
- **Solution Lineage:** Track the ancestry of solutions as they evolve through generations.

---

## 🧠 Why AlphaRevolve?

- **Tired of manual optimization?** Let the machine do the grind.
- **Need to port from React to Vue?** Define a fitness function and let AlphaRevolve propose incremental rewrites.
- **Want to squash linter warnings, modernize APIs, or harden security?** If you can measure it, you can evolve it.
- **Curious about LLMs with million-token context windows?** AlphaRevolve can optimize across files, not just within them.

---

## ⚡️ Quickstart

### Prerequisites

- Node.js 16+
- npm or yarn
- An API key for your LLM of choice (OpenAI, Gemini, Ollama, etc.)

### Installation

```bash
git clone https://github.com/mrorigo/alpharevolve.git
cd alpharevolve
npm install
```

---

### Model Setup: How to Configure LLMs in the Examples
### Advanced Configuration Options

AlphaRevolve provides robust configuration options to tailor the evolution process:

```ts
// Example of evolution options
const options = {
  verbose: true,            // Enable detailed logging
  saveResults: true,        // Save results to disk
  runParallel: false,       // Run evaluations in parallel
  maxRetries: 3,            // Number of retries for failed iterations
  checkSyntaxBeforeEval: true, // Validate code syntax before execution
  runId: "custom-run-id"    // Custom identifier for this run
};

const evolver = new AlphaRevolve(config, baseUrl, apiKey, options);
```

These options can be adjusted to balance performance, reliability, and verbosity.

AlphaRevolve is model-agnostic, but **you must specify which LLM(s) to use in the config for each example**.
The examples (`src/example1.ts`, `src/example2.ts`, etc.) includes `llmModel` and `feedbackLlmModel` fields in their config object.
You also need to set the correct API credentials and base URL for your chosen model.

#### 1. Set Your API Credentials

- **OpenAI:**
  ```bash
  export OPENAI_API_KEY=your-openai-key
  export OPENAI_BASE_URL=https://api.openai.com/v1
  ```
- **Ollama (local):**
  ```bash
  export OPENAI_API_KEY=ollama
  export OPENAI_BASE_URL=http://localhost:11434/v1
  ```
- **Gemini:**
  ```bash
  export OPENAI_API_KEY=your-gemini-key
  export OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
  ```

#### 2. Choose Your Model in the Example Configs

Open `src/example1.ts`, `src/example2.ts`, or your own config file, and set the `llmModel` field:

- **OpenAI:**
  `'gpt-3.5-turbo'` or `'gpt-4'`
- **Ollama:**
  `'gemma3:12b-it-q8_0'` or any local model you've pulled
- **Gemini:**
  `'gemini-1.5-flash'`, `'gemini-1.5-pro'`, etc.

You can also set `feedbackLlmModel` if you want to use a different model for feedback generation.

**Example snippet from `src/example2.ts`:**
```ts
const config: EvolutionConfig = {
  // Core configuration
  initialSolution: initialCode,
  fitnessFunction: evaluateCandidate,
  problemDescription: 'Optimize prime number generation algorithm',
  iterations: 10,
  
  // LLM settings
  llmModel: 'gemma3:12b-it-q8_0', // or 'gpt-3.5-turbo', 'gemini-1.5-flash', etc.
  temperature: 0.8,              // Control creativity vs determinism
  maxTokens: 4096,               // Maximum response length
  
  // Feedback configuration
  feedbackEnabled: true,
  feedbackLlmModel: 'phi4-reasoning:latest', // Use different model for analysis
  feedbackTemperature: 0.5,      // More deterministic for feedback
  
  // Persistence options
  databaseOptions: {
    saveEnabled: true,
    saveFrequency: 'iteration'   // Save after each iteration
  }
};
```

---

### Run Evolution

```bash
npm run example1
# or
npm run example2
```

---

### Visualize Results

- Open `index.html` in your browser.
- Load a run from the `runs/` directory to explore every candidate, metric, and feedback in your evolutionary journey.

---

## 🧩 What Can You Evolve?

- **Classic Algorithm Optimization:**
  Evolve a faster prime sieve, a smarter sort, or a more efficient search.

- **Idiomatic Refactoring:**
  Modernize legacy codebases—reward idiomatic APIs, penalize deprecated patterns.

- **API & Framework Migration:**
  Port from React to Vue, or AngularJS to Svelte, one safe step at a time.

- **Warning & Lint Squashing:**
  Fitness = “number of warnings fixed, tests still pass.”

- **Security Hardening:**
  Plug in a static analyzer and evolve toward zero vulnerabilities.

- **Multi-Objective Evolution:**
  Optimize for speed, readability, and security—all at once.

If you can measure it, AlphaRevolve can evolve it.

---

## 🛠️ Project Structure

```
alpharevolve/
├── runs/            # Saved run histories (JSON)
├── src/             # Source code
│   ├── alphaRevolve.ts       # Main evolutionary engine
│   ├── codeExtractor.ts      # Extract code from LLM outputs
│   ├── feedbackService.ts    # LLM-powered solution analysis
│   ├── llmService.ts         # Resilient LLM API interface
│   ├── programDatabase.ts    # Solution tracking and lineage
│   ├── promptBuilder.ts      # Dynamic prompt engineering
│   ├── safeEval.ts           # Secure isolated code execution
│   ├── types.ts              # Core type definitions
│   ├── index.ts              # Default entry point
│   ├── example1.ts           # Example: sorting optimization
│   ├── example2.ts           # Example: prime sieve optimization
│   └── ...                   # Utilities and support modules
├── index.html       # Run Explorer (visualization)
├── package.json
└── tsconfig.json
```

---

## 📚 Examples
## 🔒 Security Features

AlphaRevolve includes multiple layers of security to safely execute and evaluate candidate solutions:

- **Isolated Execution:** All code runs in separate Node.js worker threads
- **Memory Limits:** Configurable memory caps prevent resource exhaustion
- **Timeout Controls:** Maximum execution time for any candidate solution
- **Clean File Handling:** Temporary files are automatically managed and cleaned up
- **Code Validation:** Syntax checking before execution (optional)
- **Error Isolation:** Failed executions can't affect the main evolution process

These security features make AlphaRevolve suitable for both interactive development and automated CI/CD pipelines.

- **Prime Sieve Optimization:**
  See `src/example2.ts` for evolving a prime sieve algorithm.

- **Sorting Algorithm Refinement:**
  See `src/example1.ts` or `src/index.ts` for bubble sort optimization.

- **Bring Your Own Problem:**
  Swap in your own code, fitness function, and prompt. AlphaRevolve does the rest.
  - **Memory-Safe Evolution:**
    The enhanced `safeEval` system enforces memory limits and tracks detailed performance metrics.
  
  - **Resilient Automation:**
    Built-in retry mechanisms and error recovery make AlphaRevolve robust enough for long-running optimizations.

---

## 📊 Performance Metrics & Analysis

AlphaRevolve collects detailed metrics during evolution:

- **Execution Performance:** Time, CPU usage, memory allocation
- **Garbage Collection:** Count and duration of GC events
- **Function Analysis:** Loop iterations and function call counts
- **Quality Metrics:** Correctness and efficiency scores
- **Evolution History:** Complete generation tracking with parent-child relationships

These metrics help you understand not just *what* improved in your code, but *why* it improved.

## 🔄 Robust Error Handling

The framework incorporates sophisticated error handling:

- **Automatic Retries:** Failed LLM calls automatically retry with exponential backoff
- **Fallback Strategies:** Multiple code extraction approaches for different LLM response formats
- **Graceful Degradation:** Evolution continues even if specific steps fail
- **Comprehensive Logging:** Detailed error information to help diagnose issues
## 🙏 Acknowledgements

AlphaRevolve is deeply inspired by DeepMind’s [AlphaEvolve](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/).
Thanks to the open-source LLM and agent communities for making this possible.

---

## 🪪 License

[MIT License](LICENSE)

---

**Ready to let evolution and AI do the heavy lifting? Fork, star, and get evolving!**
