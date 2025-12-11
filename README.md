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
npm run build
```

---

### Usage

AlphaRevolve can now be used directly via the CLI to optimize any TypeScript/JavaScript file in your project, using your existing test suites for feedback.

#### 1. Set Your API Credentials

```bash
export OPENAI_API_KEY=your-api-key
export OPENAI_BASE_URL=https://api.openai.com/v1 # Optional, defaults to OpenAI
```

#### 2. Run the Optimizer

To optimize a file `src/my-algorithm.ts` using `src/my-algorithm.test.ts` for verification:

```bash
npm run cli -- optimize src/my-algorithm.ts --test src/my-algorithm.test.ts --iterations 10 --model gpt-4
```

or if you have linked the package:

```bash
alpharevolve optimize src/my-algorithm.ts --test src/my-algorithm.test.ts
```

### Running Examples

**1. Sorting Benchmark (CLI Mode)**
Runs the CLI optimizer on a bubble sort implementation.

```bash
# Ensure OPENAI_API_KEY is set (and OPENAI_BASE_URL if using Ollama/vLLM)
export OPENAI_API_KEY=your-key

# Run via npm
npm run example1

# OR via Makefile
make example1

# OR manual command (for custom models/Ollama)
npx ts-node src/cli/index.ts optimize examples/sort_target.ts \
  --test examples/sort_benchmark.test.ts \
  --iterations 5 \
  --model gemma3:4b \
  --base-url http://localhost:11434/v1 \
  --api-key ollama
```

**2. Programmatic API Demo**
Demonstrates how to use AlphaRevolve as a library in your own scripts.
```bash
npm run example2
```

---

## 🧩 What Can You Evolve?

- **Classic Algorithm Optimization:** Evolve a faster prime sieve, a smarter sort, or a more efficient search.
- **Idiomatic Refactoring:** Modernize legacy codebases—reward idiomatic APIs.
- **Test-Driven Optimization:** Use your existing Jest/Vitest suites as the "Fitness Function". If the tests pass, AlphaRevolve tries to make the code faster or cleaner.

---

## 🛠️ Project Structure

```
alpharevolve/
├── LICENSE
├── README.md
├── runs/            # Saved run histories (JSON)
├── src
│  ├── cli/          # CLI implementation
│  └── core/         # Core evolution logic (AlphaRevolve, BenchmarkRunner, etc.)
├── examples/        # Example targets and test suites
├── index.html       # Run Explorer (visualization)
├── package.json
└── tsconfig.json
```

---


AlphaRevolve collects detailed metrics during evolution:

- **Execution Performance:** Execution time and memory allocation (Heap, RSS).
- **Garbage Collection:** Count and duration of GC events (via `perf_hooks`).
- **Quality Metrics:** Correctness and efficiency scores based on your test suite.
- **Evolution History:** Complete generation tracking with parent-child relationships.

*Note: Advanced metrics like CPU usage and loop iteration counts are available when using the programmatic `safeEval` API, but the CLI focus is on integration with standard Jest environments.*

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
