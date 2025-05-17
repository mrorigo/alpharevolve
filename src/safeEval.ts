import { Worker } from 'worker_threads';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Safely evaluates a code snippet using a worker with a timeout.
 * @param code The code containing a sort function.
 * @param input Input array to sort.
 * @param timeoutMs Maximum time allowed in milliseconds.
 * @returns An object with the result and execution time.
 */
 /**
  * Performance metrics collected during code execution
  */
 export interface PerformanceMetrics {
   executionTime: number;
   memoryUsage: {
     before: NodeJS.MemoryUsage;
     after: NodeJS.MemoryUsage;
     delta: NodeJS.MemoryUsage;
   };
   cpuUsage: {
     user: number;
     system: number;
   };
   gcStats?: {
     count: number;
     totalTime: number;
   };
 }
 
 /**
  * Safely evaluates a code snippet using a worker with a timeout.
  * Collects detailed performance metrics during execution.
  * 
  * @param code The code containing the function to evaluate
  * @param input Input value to pass to the function
  * @param timeoutMs Maximum time allowed in milliseconds
  * @param functionName Name of the function to call (defaults to "sort")
  * @returns Object with the result and detailed performance metrics
  */
  export function safeEval(
       code: string,
       input: any,
       timeoutMs: number = 5000,
       functionName?: string
     ): Promise<{ result: any; executionTime: number; performanceMetrics?: PerformanceMetrics }> {
     return new Promise((resolve, reject) => {
       const tempDir = tmpdir();
       const workerPath = join(tempDir, `worker-${randomUUID()}.js`);
       
       // Define worker code
       const workerCode = `
            const { parentPort, workerData } = require('worker_threads');
            const { performance, PerformanceObserver } = require('perf_hooks');
            const v8 = require('v8');
            
            // Track garbage collection events if available
            let gcCount = 0;
            let gcTotalTime = 0;
            
            try {
              // Set up performance observer to track GC events
              const obs = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                  if (entry.name.startsWith('gc')) {
                    gcCount++;
                    gcTotalTime += entry.duration;
                  }
                });
              });
              
              // Subscribe to GC events
              try {
                obs.observe({ entryTypes: ['gc'], buffered: true });
              } catch (e) {
                // GC observation might not be available in all environments
                console.log('GC observation not available');
              }
            
              const { code, input, functionName } = workerData;
  
              // Collect initial performance metrics
              const memoryBefore = process.memoryUsage();
              const cpuBefore = process.cpuUsage();
              
              // Prepare the function in advance using the provided function name (defaults to "sort" if not provided)
              const fn = new Function(\`\${code}\nreturn \${functionName || "sort"};\`)();
  
              // Measure only the execution time of the function with the given input
              const startTime = performance.now();
              const result = fn(input);
              const endTime = performance.now();
              
              // Collect final performance metrics
              const memoryAfter = process.memoryUsage();
              const cpuAfter = process.cpuUsage(cpuBefore);
              const executionTime = endTime - startTime;
              
              // Calculate memory usage deltas
              const memoryDelta = {
                rss: memoryAfter.rss - memoryBefore.rss,
                heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
                heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
                external: memoryAfter.external - memoryBefore.external,
                arrayBuffers: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers
              };
              
              // Package all performance metrics
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
              
              // Disconnect performance observer
              try {
                obs.disconnect();
              } catch (e) {
                // Ignore errors during disconnect
              }
  
              // Send back both the result and the performance metrics
              parentPort.postMessage({
                success: true,
                result,
                executionTime,
                performanceMetrics
              });
            } catch (error) {
              // Send any errors back
              parentPort.postMessage({
                success: false,
                error: error.toString(),
                executionTime: 0
              });
            }`;
       
       writeFileSync(workerPath, workerCode);
       const worker = new Worker(workerPath, { workerData: { code, input, functionName } });
       const timeoutId = setTimeout(() => {
         worker.terminate();
         reject(new Error(`Evaluation timed out after ${timeoutMs}ms`));
       }, timeoutMs);
       worker.on('message', (message) => {
         clearTimeout(timeoutId);
         if (message.success) {
           resolve({ 
             result: message.result, 
             executionTime: message.executionTime,
             performanceMetrics: message.performanceMetrics
           });
         } else {
           reject(new Error(message.error));
         }
       });
       worker.on('error', (err) => {
         clearTimeout(timeoutId);
         reject(err);
       });
       worker.on('exit', (code) => {
         clearTimeout(timeoutId);
         if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
       });
     });
   }
    
