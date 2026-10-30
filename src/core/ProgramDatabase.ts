import { CandidateEvaluation, CandidateSolution, FilterOptions } from './types';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Structure for serialized database when saving/loading from disk
 */
interface SerializedDatabase {
  version: string;
  timestamp: string;
  programs: CandidateSolution[];
  metadata?: Record<string, any>;
}



/**
 * CandidateDatabase stores, manages, and persists candidate solution evaluations.
 * It supports efficient querying, filtering, and tracking of solution lineage.
 */
export class ProgramDatabase {
  private programs: Map<string, CandidateSolution> = new Map();
  private metadata: Record<string, any> = {};
  private bestProgramId: string | null = null;
  private readonly dbVersion: string = '1.3';
  private eventJournalPath?: string;
  private higherIsBetter = true;
  private minImprovement = 0;
  private noiseToleranceMultiplier = 1;

  /** Configure score ordering and the measured-noise acceptance band. */
  configureSelection(options: {
    higherIsBetter: boolean;
    minImprovement: number;
    noiseToleranceMultiplier: number;
  }): void {
    this.higherIsBetter = options.higherIsBetter;
    this.minImprovement = options.minImprovement;
    this.noiseToleranceMultiplier = options.noiseToleranceMultiplier;
    this.bestProgramId = null;
    for (const candidate of this.programs.values()) this.considerBest(candidate);
    this.appendEvent({ type: 'selection_configured', options, bestProgramId: this.bestProgramId });
  }

  /** Start an append-only journal. Existing journals are never silently reused. */
  configureEventJournal(filePath: string, resumeExisting = false): void {
    const absolutePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    const hasExistingJournal = fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0;
    if (hasExistingJournal && !resumeExisting) {
      throw new Error(`Event journal already exists: ${absolutePath}`);
    }
    this.eventJournalPath = absolutePath;
    if (hasExistingJournal && resumeExisting) {
      const journal = fs.readFileSync(absolutePath, 'utf8');
      if (!journal.endsWith('\n')) {
        const lastCompleteLine = journal.lastIndexOf('\n');
        const trailingLine = journal.slice(lastCompleteLine + 1);
        let trailingEventIsComplete = false;
        try {
          JSON.parse(trailingLine);
          trailingEventIsComplete = true;
        } catch {
          // A torn final event is discarded below; complete earlier lines remain intact.
        }
        if (trailingEventIsComplete) {
          fs.appendFileSync(absolutePath, '\n', 'utf8');
        } else if (lastCompleteLine < 0) {
          fs.truncateSync(absolutePath, 0);
          this.eventJournalPath = undefined;
          this.configureEventJournal(absolutePath);
          return;
        } else {
          fs.truncateSync(absolutePath, Buffer.byteLength(journal.slice(0, lastCompleteLine + 1), 'utf8'));
        }
      }
      this.appendEvent({ type: 'journal_resumed', version: this.dbVersion });
      this.appendEvent({
        type: 'selection_configured',
        options: {
          higherIsBetter: this.higherIsBetter,
          minImprovement: this.minImprovement,
          noiseToleranceMultiplier: this.noiseToleranceMultiplier,
        },
        bestProgramId: this.bestProgramId,
      });
      return;
    }
    this.appendEvent({ type: 'journal_started', version: this.dbVersion });
    this.appendEvent({
      type: 'selection_configured',
      options: {
        higherIsBetter: this.higherIsBetter,
        minImprovement: this.minImprovement,
        noiseToleranceMultiplier: this.noiseToleranceMultiplier,
      },
      bestProgramId: this.bestProgramId,
    });
    for (const [key, value] of Object.entries(this.metadata)) this.appendEvent({ type: 'metadata_set', key, value });
    for (const candidate of this.programs.values()) {
      this.appendEvent({ type: 'candidate_added', candidate, bestProgramId: this.bestProgramId });
    }
  }

  private appendEvent(event: Record<string, any>): void {
    if (!this.eventJournalPath) return;
    const fd = fs.openSync(this.eventJournalPath, 'a', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, undefined, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  private isValid(candidate: CandidateSolution): boolean {
    return candidate.evaluation?.status !== 'invalid';
  }

  private considerBest(candidate: CandidateSolution): void {
    if (!this.isValid(candidate)) return;
    const incumbent = this.bestProgramId ? this.programs.get(this.bestProgramId) : undefined;
    if (!incumbent || !this.isValid(incumbent)) {
      this.bestProgramId = candidate.id;
      return;
    }

    const improvement = this.higherIsBetter
      ? candidate.fitness.finalScore - incumbent.fitness.finalScore
      : incumbent.fitness.finalScore - candidate.fitness.finalScore;
    const noiseBand = this.noiseToleranceMultiplier * Math.max(
      candidate.evaluation?.finalScoreMad ?? 0,
      incumbent.evaluation?.finalScoreMad ?? 0
    );
    if (improvement > Math.max(this.minImprovement, noiseBand)) {
      this.bestProgramId = candidate.id;
    }
  }

  /**
   * Adds a candidate solution to the database.
   * @param solution The candidate solution code or configuration
   * @param fitness Evaluation fitness metrics
   * @param iteration Evolutionary iteration number
   * @param parentId Optional parent candidate ID
   * @param feedback Optional feedback from analysis
   * @returns The added CandidateSolution
   */
  addProgram(
    solution: string,
    fitness: { qualityScore: number; efficiencyScore: number; finalScore: number; [key: string]: any },
    iteration: number,
    parentId?: string,
    feedback?: string,
    generationPrompt?: string,
    feedbackPrompt?: string,
    evaluation?: CandidateEvaluation,
    files?: Record<string, string>,
    primaryFile?: string
  ): CandidateSolution {
    // Generate a unique ID using both random bytes and timestamp
    const timestamp = new Date();
    const randomPart = crypto.randomBytes(6).toString('hex');
    const id = `${timestamp.getTime().toString(36)}-${randomPart}`;

    // Create a deep copy of fitness metrics to prevent mutation
    const fitnessCopy = {
      ...fitness,
      // Ensure performanceMetrics is properly handled if it exists
      ...(fitness.performanceMetrics && {
        performanceMetrics: JSON.parse(JSON.stringify(fitness.performanceMetrics))
      })
    };

    const candidate: CandidateSolution = {
      id,
      solution,
      files: files ? { ...files } : undefined,
      primaryFile,
      fitness: fitnessCopy,
      iteration,
      parent: parentId,
      timestamp,
      evaluation: evaluation ? JSON.parse(JSON.stringify(evaluation)) : undefined,
      feedback,
      generationPrompt,
      feedbackPrompt
    };

    this.programs.set(id, candidate);

    this.considerBest(candidate);
    this.appendEvent({ type: 'candidate_added', candidate, bestProgramId: this.bestProgramId });

    return candidate;
  }

  /**
   * Gets a program by its ID
   * @param id Program ID
   * @returns The program or undefined if not found
   */
  getProgram(id: string): CandidateSolution | undefined {
    return this.programs.get(id);
  }

  /**
   * Retrieves the best program by finalScore
   * @returns The highest scoring candidate, or null if empty
   */
  getBestProgram(): CandidateSolution | null {
    if (this.programs.size === 0) return null;

    // Use tracked best program ID if available
    if (this.bestProgramId && this.programs.has(this.bestProgramId)) {
      const best = this.programs.get(this.bestProgramId)!;
      if (this.isValid(best)) return best;
    }

    // Fallback: Find best program by sorting
    return this.getAllPrograms()
      .filter(candidate => this.isValid(candidate))
      .sort((a, b) => this.higherIsBetter
        ? b.fitness.finalScore - a.fitness.finalScore
        : a.fitness.finalScore - b.fitness.finalScore)[0] || null;
  }

  /**
   * Samples a program randomly from the top N candidates, optionally using filter options.
   * @param topN Number of top candidates to sample from (default: 3)
   * @param filterOptions Optional FilterOptions to restrict candidates
   * @returns A randomly selected candidate from the top performers, or null if empty
   */
  sampleProgram(topN: number = 3, filterOptions?: FilterOptions): CandidateSolution | null {
    if (this.programs.size === 0) return null;

    // Use filterPrograms for flexible filtering
    const filtered = this.filterPrograms(filterOptions || {}).filter(candidate => this.isValid(candidate));

    // Sort by fitness
    const sorted = filtered.sort((a, b) => this.higherIsBetter
      ? b.fitness.finalScore - a.fitness.finalScore
      : a.fitness.finalScore - b.fitness.finalScore);

    // Take the top N (or fewer if there aren't enough)
    const topCandidates = sorted.slice(0, Math.min(topN, sorted.length));
    if (topCandidates.length === 0) return null;

    // Select randomly from the top candidates
    const randomIndex = Math.floor(Math.random() * topCandidates.length);
    return topCandidates[randomIndex];
  }

  /**
   * Get a complete family tree for a candidate, including all ancestors
   * @param candidateId ID of the candidate to trace ancestry for
   * @returns Array of candidates representing the lineage (oldest first)
   */
  getLineage(candidateId: string): CandidateSolution[] {
    const lineage: CandidateSolution[] = [];
    let currentId: string | undefined = candidateId;

    // Follow parent links until reaching the root
    while (currentId) {
      const candidate = this.programs.get(currentId);
      if (!candidate) break;

      lineage.unshift(candidate); // Add to beginning so oldest is first
      currentId = candidate.parent;
    }

    return lineage;
  }

  /**
   * Filter programs based on criteria
   * @param options Filter options (see FilterOptions in types.ts)
   * @returns Array of matching candidate solutions
   */
  filterPrograms(options: FilterOptions = {}): CandidateSolution[] {
    return this.getAllPrograms().filter(candidate => {
      // Apply quality score filter
      if (options.minQualityScore !== undefined &&
          candidate.fitness.qualityScore < options.minQualityScore) {
        return false;
      }

      // Apply efficiency score filter
      if (options.minEfficiencyScore !== undefined &&
          candidate.fitness.efficiencyScore < options.minEfficiencyScore) {
        return false;
      }

      // Apply final score filter
      if (options.minFinalScore !== undefined &&
          candidate.fitness.finalScore < options.minFinalScore) {
        return false;
      }

      // Apply iteration range filter
      if (options.iterationRange) {
        const [min, max] = options.iterationRange;
        if (candidate.iteration < min || candidate.iteration > max) {
          return false;
        }
      }

      // Apply parent existence filter
      if (options.hasParent !== undefined) {
        const hasParent = Boolean(candidate.parent);
        if (hasParent !== options.hasParent) {
          return false;
        }
      }

      // Apply feedback existence filter
      if (options.hasFeedback !== undefined) {
        const hasFeedback = Boolean(candidate.feedback && candidate.feedback.length > 0);
        if (hasFeedback !== options.hasFeedback) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Retrieves all stored programs
   * @returns Array of all candidate solutions
   */
  getAllPrograms(): CandidateSolution[] {
    return Array.from(this.programs.values());
  }

  /**
   * Gets the count of programs in the database
   */
  get count(): number {
    return this.programs.size;
  }

  /**
   * Gets the current database version
   */
  get version(): string {
    return this.dbVersion;
  }

  /**
   * Sets metadata key-value pair
   * @param key Metadata key
   * @param value Metadata value
   */
  setMetadata(key: string, value: any): void {
    this.appendEvent({ type: 'metadata_set', key, value });
    this.metadata[key] = value;
  }

  deleteMetadata(key: string): void {
    this.appendEvent({ type: 'metadata_deleted', key });
    delete this.metadata[key];
  }

  /**
   * Retrieves metadata by key
   * @param key Metadata key
   * @returns The value, or undefined
   */
  getMetadata(key: string): any {
    return this.metadata[key];
  }

  /**
   * Serializes the database
   * @returns SerializedDatabase object
   */
  toJSON(): SerializedDatabase {
    return {
      version: this.dbVersion,
      timestamp: new Date().toISOString(),
      programs: this.getAllPrograms(),
      metadata: { ...this.metadata, bestProgramId: this.bestProgramId }
    };
  }

  /**
   * Saves the database to the specified file
   * @param filePath Destination file path
   * @throws Error if file operations fail
   */
   async saveToFile(filePath: string): Promise<void> {
     try {
       // Ensure we're using an absolute path
       const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
       const dir = path.dirname(absolutePath);
       
       console.log(`Saving database to: ${absolutePath}`);
       console.log(`Directory: ${dir}`);
       
       // Check directory existence and create it if needed
       if (!fs.existsSync(dir)) {
         console.log(`Creating directory: ${dir}`);
         fs.mkdirSync(dir, { recursive: true });
       }
 
       // Check if directory was successfully created
       if (!fs.existsSync(dir)) {
         throw new Error(`Failed to create directory: ${dir}`);
       }
 
       // Prepare data to save
       const data = this.toJSON();
       const json = JSON.stringify(data, null, 2);
       console.log(`Database prepared for saving: ${data.programs.length} programs, ${json.length} bytes`);
 
       // Replace the snapshot atomically so a crash cannot leave truncated JSON.
       const temporaryPath = `${absolutePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
       try {
         const handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
         try { await handle.writeFile(json, 'utf8'); await handle.sync(); } finally { await handle.close(); }
         await fs.promises.rename(temporaryPath, absolutePath);
       } finally {
         await fs.promises.rm(temporaryPath, { force: true });
       }
       
       // Verify file was saved
       if (fs.existsSync(absolutePath)) {
         const stats = fs.statSync(absolutePath);
         console.log(`Database successfully written: ${stats.size} bytes`);
       } else {
         throw new Error(`File doesn't exist after write: ${absolutePath}`);
       }
     } catch (error) {
       console.error(`Failed to save database to ${filePath}:`, error);
       if (error instanceof Error && error.stack) {
         console.error(`Stack trace: ${error.stack}`);
       }
       throw new Error(`Database save failed: ${error instanceof Error ? error.message : String(error)}`);
     }
   }

  /**
   * Loads a ProgramDatabase from a JSON file
   * @param filePath Source file path
   * @returns A new ProgramDatabase instance
   * @throws Error if file operations fail or format is invalid
   */
  static async loadFromFile(filePath: string): Promise<ProgramDatabase> {
    try {
      const data = await fs.promises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data) as SerializedDatabase;

      const db = new ProgramDatabase();

      // Migrate old database formats if needed
      if (!parsed.version || parsed.version < db.dbVersion) {
        console.log(`Migrating database from version ${parsed.version || 'unknown'} to ${db.dbVersion}`);
      }

      // Load programs into the map
      if (Array.isArray(parsed.programs)) {
        for (const program of parsed.programs) {
          db.programs.set(program.id, program);
        }
      }

      // Load metadata
      db.metadata = parsed.metadata || {};

      // Restore best program tracking
      db.bestProgramId = db.metadata.bestProgramId || null;
      if (!db.bestProgramId) {
        // Find best program if not tracked
        const bestProgram = db.getBestProgram();
        if (bestProgram) {
          db.bestProgramId = bestProgram.id;
        }
      }

      return db;
    } catch (error) {
      console.error(`Failed to load database from ${filePath}:`, error);
      throw new Error(`Database load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Rebuild a database from its event journal, tolerating only a torn final line. */
  static async loadFromJournal(filePath: string): Promise<ProgramDatabase> {
    const text = await fs.promises.readFile(filePath, 'utf8');
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const db = new ProgramDatabase();
    for (let index = 0; index < lines.length; index++) {
      let event: any;
      try { event = JSON.parse(lines[index]); }
      catch (error) {
        if (index === lines.length - 1) break;
        throw new Error(`Invalid event journal line ${index + 1}: ${String(error)}`);
      }
      if (event.type === 'selection_configured') {
        db.higherIsBetter = event.options.higherIsBetter;
        db.minImprovement = event.options.minImprovement;
        db.noiseToleranceMultiplier = event.options.noiseToleranceMultiplier;
        db.bestProgramId = event.bestProgramId ?? null;
      } else if (event.type === 'metadata_set') {
        db.metadata[event.key] = event.value;
      } else if (event.type === 'metadata_deleted') {
        delete db.metadata[event.key];
      } else if (event.type === 'candidate_added') {
        const candidate = event.candidate as CandidateSolution;
        candidate.timestamp = new Date(candidate.timestamp);
        db.programs.set(candidate.id, candidate);
        db.bestProgramId = event.bestProgramId ?? null;
      } else if (event.type !== 'journal_started' && event.type !== 'journal_resumed') {
        throw new Error(`Unknown event journal type on line ${index + 1}: ${String(event.type)}`);
      }
    }
    return db;
  }
}
