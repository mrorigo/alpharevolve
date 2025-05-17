# AlphaRevolve: Evolutionary Optimization Meets LLM Superpowers

Welcome to **AlphaRevolve**—your new secret weapon for code and algorithm optimization. Inspired by DeepMind’s AlphaEvolve, AlphaRevolve lets you combine the relentless search of evolutionary algorithms with the creative spark of large language models (LLMs). The result? Smarter, faster, and more idiomatic solutions—discovered automatically.

---

## 🚀 What Is AlphaRevolve?

AlphaRevolve is a TypeScript framework that orchestrates a feedback-driven loop between your code, your tests, and an LLM (OpenAI, Gemini, Ollama, etc.). It doesn’t just mutate code at random—it *learns* from each iteration, using robust fitness functions and LLM-generated feedback to guide evolution toward your goals.

- **AI-Driven Evolution:** LLMs propose targeted improvements, not just random mutations.
- **Automated, Safe Evaluation:** Every candidate is tested in isolation—no rogue code in your main process.
- **Flexible Fitness:** Optimize for speed, correctness, idiomatic style, security, or anything you can measure.
- **Full History & Visualization:** Every step is logged. Explore the evolutionary journey in your browser.

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
  // ...
  llmModel: 'gemma3:12b-it-q8_0', // or 'gpt-3.5-turbo', 'gemini-1.5-flash', etc.
  feedbackLlmModel: 'phi4-reasoning:latest', // optional
  // ...
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
│   ├── AlphaEvolve.ts        # Main evolutionary engine
│   ├── FeedbackService.ts    # LLM-powered feedback
│   ├── LlmService.ts         # LLM API interface
│   ├── ProgramDatabase.ts    # Candidate/fitness tracking
│   ├── PromptBuilder.ts      # Prompt construction
│   ├── safeEval.ts           # Safe, isolated code execution
│   ├── types.ts              # Core types
│   ├── index.ts              # Example: sorting optimization
│   ├── example1.ts           # Example: sorting optimization
│   ├── example2.ts           # Example: prime sieve optimization
│   └── ...                   # Utilities, modifiers, etc.
├── index.html       # Run Explorer (visualization)
├── package.json
└── tsconfig.json
```

---

## 📚 Examples

- **Prime Sieve Optimization:**
  See `src/example2.ts` for evolving a prime sieve algorithm.

- **Sorting Algorithm Refinement:**
  See `src/example1.ts` or `src/index.ts` for bubble sort optimization.

- **Bring Your Own Problem:**
  Swap in your own code, fitness function, and prompt. AlphaRevolve does the rest.

---

## 🙏 Acknowledgements

AlphaRevolve is deeply inspired by DeepMind’s [AlphaEvolve](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/).
Thanks to the open-source LLM and agent communities for making this possible.

---

## 🪪 License

[MIT License](LICENSE)

---

**Ready to let evolution and AI do the heavy lifting? Fork, star, and get evolving!**
