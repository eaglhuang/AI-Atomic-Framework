import { buildTeamRecommendation } from '../../team.ts';
import { inspectIntegrationBootstrap } from '../../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../../runtime-adapter-readiness.ts';
import { message } from '../../shared.ts';
export declare function embedTeamRecommendation<T extends {
    readonly playbook?: unknown;
}>(nextAction: T, input: Parameters<typeof buildTeamRecommendation>[0]): T & {
    teamRecommendation?: TeamRecommendation | null;
};
export declare function buildNextMessages(nextAction: NextActionLike, userNotice: AtmUserNotice | null, integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>, runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>, routeMessage: ReturnType<typeof message>): import("../../shared.ts").CommandMessage[];
