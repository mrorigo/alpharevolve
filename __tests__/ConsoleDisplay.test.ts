// Mock chalk and cli-progress to avoid ESM import issues in Jest
jest.mock('chalk', () => {
  const colorFn = (x: string) => x;
  function bold(x: string) { return x; }
  // Attach blueBright to bold as a function property
  (bold as any).blueBright = colorFn;
  const chalkMock = {
    bold,
    blueBright: colorFn,
    greenBright: colorFn,
    yellow: colorFn,
    cyanBright: colorFn,
    magentaBright: colorFn,
    redBright: colorFn,
  };
  return {
    ...chalkMock,
    default: chalkMock
  };
});
jest.mock('cli-progress', () => ({
  SingleBar: class {
    start() {}
    update() {}
    stop() {}
  },
  Presets: { shades_classic: {} }
}));

import { ConsoleDisplay } from '../src/ConsoleDisplay';

describe('ConsoleDisplay', () => {
  it('should instantiate and call display methods', () => {
    const display = new ConsoleDisplay();
    display.displaySection('Test Section');
    display.displaySuccess('Success!');
    display.displayError('Error!');
    display.displayFitnessMetrics({ qualityScore: 1, efficiencyScore: 1, finalScore: 1 });
    display.displayComparison({ qualityScore: 1, efficiencyScore: 1, finalScore: 1 }, { qualityScore: 2, efficiencyScore: 2, finalScore: 2 });
    display.displayPerformanceMetrics({ executionTime: 1, memoryUsage: { delta: { heapUsed: 1024*1024 } }, gcStats: { count: 1, totalTime: 1 } });
    display.displaySummary({ solution: 'foo', fitness: { qualityScore: 1, efficiencyScore: 1, finalScore: 1 } }, 123);
  });
});