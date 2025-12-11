import { ProgramDatabase } from '../src/core/ProgramDatabase';

describe('ProgramDatabase', () => {
  it('should add and retrieve a candidate solution', () => {
    const db = new ProgramDatabase();
    const candidate = db.addProgram(
      'function foo() { return 42; }',
      { qualityScore: 1, efficiencyScore: 1, finalScore: 1 },
      0
    );
    expect(candidate.solution).toContain('foo');
    expect(db.getProgram(candidate.id)).toEqual(candidate);
    expect(db.getBestProgram()).toEqual(candidate);
    expect(db.count).toBe(1);
  });

  it('should track best program by finalScore', () => {
    const db = new ProgramDatabase();
    const c1 = db.addProgram('a', { qualityScore: 0.5, efficiencyScore: 0.5, finalScore: 0.5 }, 0);
    const c2 = db.addProgram('b', { qualityScore: 0.9, efficiencyScore: 0.9, finalScore: 0.9 }, 1);
    expect(db.getBestProgram()).toEqual(c2);
  });

  it('should filter programs by score', () => {
    const db = new ProgramDatabase();
    db.addProgram('a', { qualityScore: 0.5, efficiencyScore: 0.5, finalScore: 0.5 }, 0);
    db.addProgram('b', { qualityScore: 0.9, efficiencyScore: 0.9, finalScore: 0.9 }, 1);
    const filtered = db.filterPrograms({ minFinalScore: 0.8 });
    expect(filtered.length).toBe(1);
    expect(filtered[0].solution).toBe('b');
  });

  it('should save and load database from file', async () => {
    const db = new ProgramDatabase();
    const candidate = db.addProgram('foo', { qualityScore: 1, efficiencyScore: 1, finalScore: 1 }, 0);
    const filePath = './__tests__/tmpdb.json';
    await db.saveToFile(filePath);
    const loaded = await ProgramDatabase.loadFromFile(filePath);
    const loadedCandidate = loaded.getProgram(candidate.id);
    // Normalize timestamp and ignore undefined fields
    expect(loadedCandidate?.solution).toEqual(candidate.solution);
    expect(loadedCandidate?.fitness).toEqual(candidate.fitness);
    expect(loadedCandidate?.iteration).toEqual(candidate.iteration);
    expect(loadedCandidate?.timestamp).toBeDefined();
    expect(new Date(loadedCandidate!.timestamp).toISOString()).toEqual(candidate.timestamp.toISOString());
  });
});