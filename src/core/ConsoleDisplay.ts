import chalk from 'chalk';
import cliProgress from 'cli-progress';

/**
 * ConsoleDisplay provides a TUI-like interface for AlphaRevolve's console output.
 * It includes progress bars, tables, and formatted sections for better readability.
 */
export class ConsoleDisplay {
  private progressBar: cliProgress.SingleBar | null = null;

  /**
   * Creates a comparison string between current and parent solution metrics.
   * @param parentMetrics Parent solution metrics.
   * @param childMetrics Child solution metrics.
   * @returns A formatted comparison string.
   */
  createParentComparison(parentMetrics: any, childMetrics: any): string {
    const finalScoreDiff = childMetrics.finalScore - parentMetrics.finalScore;
    const percentChange = (finalScoreDiff / (Math.abs(parentMetrics.finalScore) || 0.0001)) * 100;

    return `
${chalk.yellow('Quality Score:')} ${parentMetrics.qualityScore.toFixed(4)} → ${childMetrics.qualityScore.toFixed(4)}
${chalk.yellow('Efficiency Score:')} ${parentMetrics.efficiencyScore.toFixed(4)} → ${childMetrics.efficiencyScore.toFixed(4)}
${chalk.yellow('Final Score:')} ${parentMetrics.finalScore.toFixed(4)} → ${childMetrics.finalScore.toFixed(4)} (${percentChange.toFixed(2)}%)
    `.trim();
  }

  /**
   * Creates a plain-text comparison string between current and parent solution metrics.
   * @param parentMetrics Parent solution metrics.
   * @param childMetrics Child solution metrics.
   * @returns A plain-text comparison string.
   */
  createParentComparisonPlain(parentMetrics: any, childMetrics: any): string {
    const finalScoreDiff = childMetrics.finalScore - parentMetrics.finalScore;
    const percentChange = (finalScoreDiff / (Math.abs(parentMetrics.finalScore) || 0.0001)) * 100;

    return `
Quality Score: ${parentMetrics.qualityScore.toFixed(4)} → ${childMetrics.qualityScore.toFixed(4)}
Efficiency Score: ${parentMetrics.efficiencyScore.toFixed(4)} → ${childMetrics.efficiencyScore.toFixed(4)}
Final Score: ${parentMetrics.finalScore.toFixed(4)} → ${childMetrics.finalScore.toFixed(4)} (${percentChange.toFixed(2)}%)
    `.trim();
  }

  /**
   * Formats performance metrics into a human-readable string.
   * @param metrics Performance metrics to format.
   * @returns A formatted string with performance details.
   */
  formatPerformanceMetrics(metrics: any): string {
    const heapUsedMB = (metrics.memoryUsage?.delta?.heapUsed / (1024 * 1024)).toFixed(2) || 'N/A';
    const executionTimeMs = metrics.executionTime?.toFixed(2) || 'N/A';
    const gcCount = metrics.gcStats?.count || 'N/A';
    const gcTime = metrics.gcStats?.totalTime?.toFixed(2) || 'N/A';

    return `
${chalk.yellow('Execution Time:')} ${executionTimeMs} ms
${chalk.yellow('Heap Used:')} ${heapUsedMB} MB
${chalk.yellow('GC Count:')} ${gcCount}
${chalk.yellow('GC Time:')} ${gcTime} ms
    `.trim();
  }

  /**
   * Formats performance metrics into a plain-text string.
   * @param metrics Performance metrics to format.
   * @returns A plain-text string with performance details.
   */
  formatPerformanceMetricsPlain(metrics: any): string {
    const heapUsedMB = (metrics.memoryUsage?.delta?.heapUsed / (1024 * 1024)).toFixed(2) || 'N/A';
    const executionTimeMs = metrics.executionTime?.toFixed(2) || 'N/A';
    const gcCount = metrics.gcStats?.count || 'N/A';
    const gcTime = metrics.gcStats?.totalTime?.toFixed(2) || 'N/A';

    return `
Execution Time: ${executionTimeMs} ms
Heap Used: ${heapUsedMB} MB
GC Count: ${gcCount}
GC Time: ${gcTime} ms
    `.trim();
  }

  /**
   * Initializes the progress bar for iterations.
   * @param totalIterations Total number of iterations.
   */
  initProgressBar(totalIterations: number): void {
    this.progressBar = new cliProgress.SingleBar(
      {
        format: `${chalk.blueBright('Progress')} |${chalk.green('{bar}')}| {percentage}% | Iteration {value}/{total}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    );
    this.progressBar.start(totalIterations, 0);
  }

  /**
   * Updates the progress bar to the current iteration.
   * @param currentIteration Current iteration number.
   */
  updateProgressBar(currentIteration: number): void {
    if (this.progressBar) {
      this.progressBar.update(currentIteration);
    }
  }

  /**
   * Stops the progress bar.
   */
  stopProgressBar(): void {
    if (this.progressBar) {
      this.progressBar.stop();
    }
  }

  /**
   * Displays a section header with a title.
   * @param title The title of the section.
   */
  displaySection(title: string): void {
    console.log(chalk.bold.blueBright(`\n=== ${title.toUpperCase()} ===\n`));
  }

  /**
   * Displays a table of fitness metrics.
   * @param metrics Fitness metrics to display.
   */
  displayFitnessMetrics(metrics: { qualityScore: number; efficiencyScore: number; finalScore: number }): void {
    console.log(chalk.greenBright('Fitness Metrics:'));
    console.log(
      `${chalk.yellow('Quality Score:')} ${metrics.qualityScore.toFixed(4)}\n` +
      `${chalk.yellow('Efficiency Score:')} ${metrics.efficiencyScore.toFixed(4)}\n` +
      `${chalk.yellow('Final Score:')} ${metrics.finalScore.toFixed(4)}\n`
    );
  }

  /**
   * Displays a comparison between parent and child solutions.
   * @param parentMetrics Parent solution metrics.
   * @param childMetrics Child solution metrics.
   */
  displayComparison(parentMetrics: any, childMetrics: any): void {
    console.log(chalk.cyanBright('Comparison with Parent Solution:'));
    console.log(this.createParentComparison(parentMetrics, childMetrics));
  }

  /**
   * Displays detailed performance metrics.
   * @param metrics Performance metrics to display.
   */
  displayPerformanceMetrics(metrics: any): void {
    console.log(chalk.magentaBright('Performance Metrics:'));
    console.log(this.formatPerformanceMetrics(metrics));
  }

  /**
   * Displays an error message.
   * @param error The error message to display.
   */
  displayError(error: string): void {
    console.log(chalk.redBright(`❌ Error: ${error}`));
  }

  /**
   * Displays a success message.
   * @param message The success message to display.
   */
  displaySuccess(message: string): void {
    console.log(chalk.greenBright(`✅ ${message}`));
  }

  /**
   * Displays a summary of the evolution process.
   * @param bestCandidate The best candidate solution.
   * @param runtime Total runtime in milliseconds.
   */
  displaySummary(bestCandidate: any, runtime: number): void {
    this.displaySection('Evolution Summary');
    console.log(chalk.greenBright('Best Candidate Solution:'));
    console.log(bestCandidate.solution);
    this.displayFitnessMetrics(bestCandidate.fitness);
    console.log(chalk.yellow(`Total Runtime: ${runtime} ms`));
  }
}
