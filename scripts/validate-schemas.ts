import { validateCoreSchemaContracts } from './validate-schemas/core-contracts.ts';
import { validateBrokerAndTeamContracts } from './validate-schemas/broker-team-contracts.ts';
import { validateFixtureAndProtectedSurfaceContracts } from './validate-schemas/fixtures-and-protection.ts';

validateCoreSchemaContracts();
validateBrokerAndTeamContracts();
validateFixtureAndProtectedSurfaceContracts();
