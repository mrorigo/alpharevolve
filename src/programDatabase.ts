import { CandidateSolution } from './types';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface SerializedDatabase {
  version: string;
  timestamp: string;
  programs: CandidateSolution[];
  metadata?: Record<string, any>;
}

/**
 * EvaluationDatabase stores, manages, and persists candidate solution evaluations.
 * (Note: Although the class name remains ProgramDatabase for historical reasons,
 * it now operates on CandidateSolution objects.)
 */
export class ProgramDatabase {
  private programs: CandidateSolution[] = [];
  private metadata: Record<string, any> = {};

  /**
   * Adds a candidate solution to the database.
   * @param solution The candidate solution (e.g. code, function, parameter set).
   * @param fitness Evaluation fitness metrics.
   * Expected keys: qualityScore, efficiencyScore, finalScore (and any additional metrics).
   * @param iteration Iteration number.
   * @param parentId Optional parent candidate ID.
   * @param feedback Optional feedback string.
   * @returns The added CandidateSolution.
   */
   addProgram(
     solution: string,
     fitness: { qualityScore: number; efficiencyScore: number; finalScore: number; [key: string]: number },
     iteration: number,
     parentId?: string,
     feedback?: string
   ): CandidateSolution {
     const id = crypto.randomBytes(8).toString('hex');
     const candidate: CandidateSolution = {
       id,
       solution,
       fitness,
       iteration,
       parent: parentId,
       timestamp: new Date(),
       feedback
     };
     this.programs.push(candidate);
     return candidate;
   }

  /**
   * Retrieves the best program by finalScore from the top three candidates.
   * @returns A randomly selected Program among the top performers, or null if empty.
   */
   getBestProgram(): CandidateSolution | null {
     if (this.programs.length === 0) return null;
     const sorted = [...this.programs].sort((a, b) => b.fitness.finalScore - a.fitness.finalScore);
     return sorted[0];
   }

  /**
   * Samples a program from the database. Simply pick randomly from top 3.
   * @returns A Program or null.
   */
   sampleProgram(): CandidateSolution | null {
     if (this.programs.length === 0) return null;
     const sorted = [...this.programs].sort((a, b) => b.fitness.finalScore - a.fitness.finalScore);
     const topCandidates = sorted.slice(0, Math.min(3, sorted.length));
     const randomIndex = Math.floor(Math.random() * topCandidates.length);
     return topCandidates[randomIndex];
   }

  /**
   * Retrieves all stored programs.
   * @returns Array of Program.
   */
   getAllPrograms(): CandidateSolution[] {
     return [...this.programs];
   }

  /**
   * Sets metadata key-value pair.
   * @param key Metadata key.
   * @param value Metadata value.
   */
  setMetadata(key: string, value: any): void {
    this.metadata[key] = value;
  }

  /**
   * Retrieves metadata by key.
   * @param key Metadata key.
   * @returns The value, or undefined.
   */
  getMetadata(key: string): any {
    return this.metadata[key];
  }

  /**
   * Serializes the database.
   * @returns SerializedDatabase object.
   */
  toJSON(): SerializedDatabase {
    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      programs: this.programs,
      metadata: this.metadata
    };
  }

  /**
   * Saves the database to the specified file.
   * @param filePath Destination file path.
   */
  async saveToFile(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(this.toJSON(), null, 2);
    await fs.promises.writeFile(filePath, json, 'utf8');
  }

  /**
   * Loads a ProgramDatabase from a JSON file.
   * @param filePath Source file path.
   * @returns A new ProgramDatabase instance.
   */
  static async loadFromFile(filePath: string): Promise<ProgramDatabase> {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data) as SerializedDatabase;
    const db = new ProgramDatabase();
    db.programs = parsed.programs;
    db.metadata = parsed.metadata || {};
    return db;
  }
}
