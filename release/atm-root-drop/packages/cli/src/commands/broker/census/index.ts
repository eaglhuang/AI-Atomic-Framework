import {
  buildSharedWriteGateCoverage,
  type CurrentSourceDiscriminationProbe,
  type SharedWriteCensusEntry,
  type SharedWriteGateCoverage
} from '../../../../../core/src/broker/census/index.ts';

export interface BrokerCensusInput {
  readonly generatedAt?: string;
  readonly entries: readonly Omit<SharedWriteCensusEntry, 'digest'>[];
  readonly currentSourceDiscrimination?: readonly CurrentSourceDiscriminationProbe[];
  readonly projectionOnlyItemCount?: number;
}

export function buildBrokerCensus(input: BrokerCensusInput): SharedWriteGateCoverage {
  return buildSharedWriteGateCoverage(input);
}
