import { CandidateSolution } from './types';
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
 * Options for filtering candidate solutions
 */
interface FilterOptions {
  minQualityScore?: number;
  minEfficiencyScore?: number;
  minFinalScore?: number;
  iterationRange?: [number, number];
  hasParent?: boolean;
  hasFeedback?: boolean;
}

/**
 * CandidateDatabase stores, manages, and persists candidate solution evaluations.
 * It supports efficient querying, filtering, and tracking of solution lineage.
 */
export class ProgramDatabase {
  private programs: Map<string, CandidateSolution> = new Map();
  private metadata: Record<string, any> = {};
  private bestProgramId: string | null = null;
  private readonly dbVersion: string = '1.1';

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
    feedbackPrompt?: string
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
      fitness: fitnessCopy,
      iteration,
      parent: parentId,
      timestamp,
      feedback,
      generationPrompt,
      feedbackPrompt
    };

    this.programs.set(id, candidate);

    // Update best program tracking if needed
    if (
      this.bestProgramId === null ||
      !this.getProgram(this.bestProgramId) ||
      (fitnessCopy.finalScore > (this.getProgram(this.bestProgramId)?.fitness.finalScore || 0))
    ) {
      this.bestProgramId = id;
    }

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
      return this.programs.get(this.bestProgramId) || null;
    }

    // Fallback: Find best program by sorting
    return this.getAllPrograms()
      .sort((a, b) => b.fitness.finalScore - a.fitness.finalScore)[0] || null;
  }

  /**
   * Samples a program randomly from the top N candidates
   * @param topN Number of top candidates to sample from (default: 3)
   * @returns A randomly selected candidate from the top performers, or null if empty
   */
  sampleProgram(topN: number = 3): CandidateSolution | null {
    if (this.programs.size === 0) return null;

    // Get all programs sorted by fitness
    const sorted = this.getAllPrograms()
      .filter(x => x.fitness.finalScore > 0)
      .sort((a, b) => b.fitness.finalScore - a.fitness.finalScore);

    // Take the top N (or fewer if there aren't enough)
    const topCandidates = sorted.slice(0, Math.min(topN, sorted.length));

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
   * @param options Filter options
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
    this.metadata[key] = value;
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
 
       // Write the file
       await fs.promises.writeFile(absolutePath, json, 'utf8');
       
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
}
