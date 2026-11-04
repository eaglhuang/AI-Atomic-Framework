import type { WaveExitObserverExitPolicy } from './wave-exit-observer-receipt.js';
/** Project compiler-derived metadata and receipt envelopes out of compiler-owned inputs. */
export declare function digestWaveExitObserverInput(exitItemId: string, exitPolicy: WaveExitObserverExitPolicy, inputPath: string, source: string): string | null;
/** Compute policy-owned historical input digests without consulting live bytes. */
export declare function digestWaveExitObserverInputsAtCommit(repoRoot: string, exitItemId: string, exitPolicy: WaveExitObserverExitPolicy, commit: string): Record<string, string>;
