import { Worker } from 'worker_threads';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Performance metrics collected during code execution
 */
export interface PerformanceMetrics {
  /** Total execution time in milliseconds */
  executionTime: number;
  /** Memory usage statistics */
  memoryUsage: {
    /** Memory usage before execution */
    before: NodeJS.MemoryUsage;
    /** Memory usage after execution */
    after: NodeJS.MemoryUsage;
    /** Delta between before and after */
    delta: NodeJS.MemoryUsage;
  };
  /** CPU usage statistics */
  cpuUsage: {
    /** User CPU time in microseconds */
    user: number;
    /** System CPU time in microseconds */
    system: number;
  };
  /** Garbage collection statistics */
  gcStats?: {
    /** Number of GC cycles during execution */
    count: number;
    /** Total time spent in GC in milliseconds */
    totalTime: number;
  };
  /** Additional statistics */
  stats?: {
    /** Number of function calls */
    functionCalls?: number;
    /** Iterations if the code contains loops */
    iterations?: number;
    /** Memory limit exceeded */
    memoryLimitExceeded?: boolean;
  };
}

/**
 * Configuration options for safe evaluation
 */
export interface SafeEvalOptions {
  /** Maximum execution time in milliseconds */
  timeoutMs?: number;
  /** Name of the function to call */
  functionName?: string;
  /** Maximum memory allowed (in MB) */
  maxMemoryMB?: number;
  /** Whether to track detailed performance statistics */
  trackDetailedStats?: boolean;
  /** Whether to clean up temporary files after execution */
  cleanupFiles?: boolean;
}

/**
 * Safe evaluation result
 */
export interface SafeEvalResult {
  /** Function execution result */
  result: any;
  /** Total execution time in milliseconds */
  executionTime: number;
  /** Detailed performance metrics */
  performanceMetrics?: PerformanceMetrics;
}

/**
 * Safely evaluates code in an isolated worker process with resource limits and metrics collection.
 * 
 * @param code The code to evaluate containing the target function
 * @param input Input value to pass to the function
 * @param options Configuration options
 * @returns Object with result, execution time and performance metrics
 */
export function safeEval(
  code: string,
  input: any,
  timeoutMs: number | SafeEvalOptions = 5000,
  functionNameOrOptions?: string | SafeEvalOptions
): Promise<SafeEvalResult> {
  // Process arguments to allow both old and new calling styles
  const options: SafeEvalOptions = typeof timeoutMs === 'object' 
    ? timeoutMs 
    : typeof functionNameOrOptions === 'object'
      ? { timeoutMs, ...functionNameOrOptions }
      : { 
          timeoutMs, 
          functionName: typeof functionNameOrOptions === 'string' ? functionNameOrOptions : undefined 
        };

  const {
    timeoutMs: timeout = 5000,
    functionName = 'sort',
    maxMemoryMB = 500,
    trackDetailedStats = true,
    cleanupFiles = true
  } = options;

  return new Promise((resolve, reject) => {
    try {
      // Create a unique temporary file for the worker
      const tempDir = tmpdir();
      const workerPath = join(tempDir, `alphaevolve-worker-${randomUUID()}.js`);
      
      // Define the worker code with security and instrumentation
      const workerCode = `
        const { parentPort, workerData } = require('worker_threads');
        const { performance, PerformanceObserver } = require('perf_hooks');
        
        // Security: Set memory limits
        try {
          const v8 = require('v8');
          v8.setFlagsFromString('--max_old_space_size=${maxMemoryMB}');
        } catch (e) {
          console.error('Failed to set memory limit:', e);
        }

        // Counter for function calls if tracking is enabled
        let functionCallCount = 0;
        let loopIterations = 0;

        // Track garbage collection events
        let gcCount = 0;
        let gcTotalTime = 0;
        
        try {
          // Set up performance observer for GC events
          const obs = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            entries.forEach(entry => {
              if (entry.name.startsWith('gc')) {
                gcCount++;
                gcTotalTime += entry.duration;
              }
            });
          });
          
          try {
            obs.observe({ entryTypes: ['gc'], buffered: true });
          } catch (e) {
            console.log('GC observation not available');
          }
        
          const { code, input, functionName, trackDetailedStats } = workerData;

          // Collect initial metrics
          const memoryBefore = process.memoryUsage();
          const cpuBefore = process.cpuUsage();
          
          // Instrument the code if detailed stats tracking is enabled
          let instrumentedCode = code;
          let fnToExecute;
          
          if (trackDetailedStats) {
            // Add loop and function call tracking
            instrumentedCode = code.replace(
              /\\bfor\\s*\\([^;]*;[^;]*;[^\\)]*\\)/g, 
              match => \`\${match} { loopIterations++; \`
            );
            
            // Wrap the target function to count calls
            try {
              // First compile the function normally
              const rawFn = new Function(\`\${instrumentedCode}\\nreturn \${functionName};\`)();
              
              // Then wrap it to count invocations
              fnToExecute = (...args) => {
                functionCallCount++;
                return rawFn(...args);
              };
            } catch (e) {
              // Fallback to direct execution if instrumentation fails
              fnToExecute = new Function(\`\${code}\\nreturn \${functionName};\`)();
            }
          } else {
            // No instrumentation needed
            fnToExecute = new Function(\`\${code}\\nreturn \${functionName};\`)();
          }

          // Execute the function with timing
          const startTime = performance.now();
          const result = fnToExecute(input);
          const endTime = performance.now();
          
          // Collect final metrics
          const memoryAfter = process.memoryUsage();
          const cpuAfter = process.cpuUsage(cpuBefore);
          const executionTime = endTime - startTime;
          
          // Calculate memory deltas
          const memoryDelta = {
            rss: memoryAfter.rss - memoryBefore.rss,
            heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
            heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
            external: memoryAfter.external - memoryBefore.external,
            arrayBuffers: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers
          };
          
          // Assemble performance metrics
          const performanceMetrics = {
            executionTime,
            memoryUsage: {
              before: memoryBefore,
              after: memoryAfter,
              delta: memoryDelta
            },
            cpuUsage: cpuAfter,
            gcStats: {
              count: gcCount,
              totalTime: gcTotalTime
            }
          };
          
          // Add detailed stats if tracking was enabled
          if (trackDetailedStats) {
            performanceMetrics.stats = {
              functionCalls: functionCallCount,
              iterations: loopIterations
            };
          }
          
          // Clean up observer
          try {
            obs.disconnect();
          } catch (e) {
            // Ignore disconnect errors
          }

          // Return results
          parentPort.postMessage({
            success: true,
            result,
            executionTime,
            performanceMetrics
          });
        } catch (error) {
          // Check if out of memory
          const isMemoryError = error.message && 
            (error.message.includes('allocation failed') || 
             error.message.includes('heap') || 
             error.message.includes('memory'));
          
          // Send error details
          parentPort.postMessage({
            success: false,
            error: error.toString(),
            stack: error.stack,
            executionTime: 0,
            memoryLimitExceeded: isMemoryError
          });
        }
      `;
      
      // Write the worker code to a temporary file
      writeFileSync(workerPath, workerCode);
      
      // Create and start the worker
      const worker = new Worker(workerPath, { 
        workerData: { 
          code, 
          input, 
          functionName, 
          trackDetailedStats 
        } 
      });
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Evaluation timed out after ${timeout}ms`));
        
        // Clean up the temporary file
        if (cleanupFiles) {
          try { unlinkSync(workerPath); } catch (e) { /* ignore cleanup errors */ }
        }
      }, timeout);
      
      // Handle worker response
      worker.on('message', (message) => {
        clearTimeout(timeoutId);
        
        // Clean up the temporary file
        if (cleanupFiles) {
          try { unlinkSync(workerPath); } catch (e) { /* ignore cleanup errors */ }
        }
        
        if (message.success) {
          resolve({ 
            result: message.result, 
            executionTime: message.executionTime,
            performanceMetrics: message.performanceMetrics
          });
        } else {
          // Include memory limit info in the error if applicable
          const errorMessage = message.memoryLimitExceeded
            ? `Memory limit exceeded (${maxMemoryMB}MB): ${message.error}`
            : message.error;
            
          reject(new Error(errorMessage));
        }
      });
      
      // Handle worker errors
      worker.on('error', (err) => {
        clearTimeout(timeoutId);
        
        // Clean up the temporary file
        if (cleanupFiles) {
          try { unlinkSync(workerPath); } catch (e) { /* ignore cleanup errors */ }
        }
        
        reject(err);
      });
      
      // Handle worker exit
      worker.on('exit', (code) => {
        clearTimeout(timeoutId);
        
        // Clean up the temporary file
        if (cleanupFiles) {
          try { unlinkSync(workerPath); } catch (e) { /* ignore cleanup errors */ }
        }
        
        if (code !== 0 && code !== null) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    } catch (error) {
      // Handle any errors in setting up the worker
      reject(new Error(`Failed to set up evaluation: ${error}`));
    }
  });
}
    
