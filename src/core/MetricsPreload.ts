/** Node preload that writes per-process CPU, heap, and GC measurements at exit. */
export const NODE_METRICS_PRELOAD = String.raw`
const fs = require('fs');
const path = require('path');
const { PerformanceObserver } = require('perf_hooks');
const directory = process.env.ALPHA_METRICS_DIRECTORY;
if (directory) {
  const startedAt = process.hrtime.bigint();
  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  let gcCount = 0;
  let gcTotalTime = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'gc') {
        gcCount++;
        gcTotalTime += entry.duration;
      }
    }
  });
  observer.observe({ entryTypes: ['gc'], buffered: true });
  process.once('exit', () => {
    for (const entry of observer.takeRecords()) {
      if (entry.entryType === 'gc') {
        gcCount++;
        gcTotalTime += entry.duration;
      }
    }
    const memoryAfter = process.memoryUsage();
    const memoryDelta = {};
    for (const key of Object.keys(memoryAfter)) memoryDelta[key] = memoryAfter[key] - memoryBefore[key];
    const cpu = process.cpuUsage(cpuBefore);
    const metrics = {
      executionTime: Number(process.hrtime.bigint() - startedAt) / 1e6,
      memoryUsage: { before: memoryBefore, after: memoryAfter, delta: memoryDelta },
      cpuUsage: { user: cpu.user, system: cpu.system },
      gcStats: { count: gcCount, totalTime: gcTotalTime }
    };
    try {
      fs.writeFileSync(path.join(directory, String(process.pid) + '.json'), JSON.stringify(metrics));
    } catch (_) {}
    observer.disconnect();
  });
}
`;
