import type { Context, Tool, ToolBase, ZodObjectAny } from "./types";
import { getToolsForFeatures as getFilteredToolNames, getToolDefinition } from "./toolDefinitions";

import { ApiClient } from "@/api/client";
import { MemoryCache } from "@/lib/utils/cache/MemoryCache";
import { SessionManager } from "@/lib/utils/SessionManager";
import { StateManager } from "@/lib/utils/StateManager";
import addInsightToDashboard from "./dashboards/addInsight";
import createDashboard from "./dashboards/create";
// Experiments
import createExperiment from "./experiments/create";
import createFeatureFlag from "./featureFlags/create";
import createInsight from "./insights/create";
// Surveys
import createSurvey from "./surveys/create";
import deleteDashboard from "./dashboards/delete";
import deleteExperiment from "./experiments/delete";
import deleteFeatureFlag from "./featureFlags/delete";
import deleteInsight from "./insights/delete";
import deleteSurvey from "./surveys/delete";
import errorDetails from "./errorTracking/errorDetails";
import eventDefinitions from "./projects/eventDefinitions";
import generateHogQLFromQuestion from "./query/generateHogQLFromQuestion";
// Dashboards
import getAllDashboards from "./dashboards/getAll";
import getAllExperiments from "./experiments/getAll";
import getAllFeatureFlags from "./featureFlags/getAll";
// Insights
import getAllInsights from "./insights/getAll";
import getAllSurveys from "./surveys/getAll";
import getDashboard from "./dashboards/get";
import getExperiment from "./experiments/get";
import getExperimentResults from "./experiments/getResults";
// Feature Flags
import getFeatureFlagDefinition from "./featureFlags/getDefinition";
import getInsight from "./insights/get";
// LLM Observability
import getLLMCosts from "./llmAnalytics/getLLMCosts";
import getOrganizationDetails from "./organizations/getDetails";
// Organizations
import getOrganizations from "./organizations/getOrganizations";
// Projects
import getProjects from "./projects/getProjects";
import getProperties from "./projects/propertyDefinitions";
import getSurvey from "./surveys/get";
import { hasScopes } from "@/lib/utils/api";
import { hash } from "@/lib/utils/helper-functions";
// Error Tracking
import listErrors from "./errorTracking/listErrors";
import queryInsight from "./insights/query";
// Query
import queryRun from "./query/run";
// Documentation
import searchDocs from "./documentation/searchDocs";
import sessionReplaysQuery from "./sessionReplays/query";
import setActiveOrganization from "./organizations/setActive";
import setActiveProject from "./projects/setActive";
import surveyStats from "./surveys/stats";
import surveysGlobalStats from "./surveys/global-stats";
import updateDashboard from "./dashboards/update";
import updateExperiment from "./experiments/update";
import updateFeatureFlag from "./featureFlags/update";
import updateInsight from "./insights/update";
import updateSurvey from "./surveys/update";

// Map of tool names to tool factory functions
const TOOL_MAP: Record<string, () => ToolBase<ZodObjectAny>> = {
	// Feature Flags
	"feature-flag-get-definition": getFeatureFlagDefinition,
	"feature-flag-get-all": getAllFeatureFlags,
	"create-feature-flag": createFeatureFlag,
	"update-feature-flag": updateFeatureFlag,
	"delete-feature-flag": deleteFeatureFlag,

	// Organizations
	"organizations-get": getOrganizations,
	"switch-organization": setActiveOrganization,
	"organization-details-get": getOrganizationDetails,

	// Projects
	"projects-get": getProjects,
	"switch-project": setActiveProject,
	"event-definitions-list": eventDefinitions,
	"properties-list": getProperties,

	// Documentation - handled separately due to env check
	// "docs-search": searchDocs,

	// Error Tracking
	"list-errors": listErrors,
	"error-details": errorDetails,

	// Experiments
	"experiment-get-all": getAllExperiments,
	"experiment-get": getExperiment,
	"experiment-results-get": getExperimentResults,
	"experiment-create": createExperiment,
	"experiment-delete": deleteExperiment,
	"experiment-update": updateExperiment,

	// Insights
	"insights-get-all": getAllInsights,
	"insight-get": getInsight,
	"insight-create-from-query": createInsight,
	"insight-update": updateInsight,
	"insight-delete": deleteInsight,
	"insight-query": queryInsight,

	// Queries
	"query-generate-hogql-from-question": generateHogQLFromQuestion,
	"query-run": queryRun,

	// Session Replays
	"session-replays-query": sessionReplaysQuery,

	// Dashboards
	"dashboards-get-all": getAllDashboards,
	"dashboard-get": getDashboard,
	"dashboard-create": createDashboard,
	"dashboard-update": updateDashboard,
	"dashboard-delete": deleteDashboard,
	"add-insight-to-dashboard": addInsightToDashboard,

	// LLM Observability
	"get-llm-total-costs-for-project": getLLMCosts,

	// Surveys
	"surveys-get-all": getAllSurveys,
	"survey-get": getSurvey,
	"survey-create": createSurvey,
	"survey-update": updateSurvey,
	"survey-delete": deleteSurvey,
	"surveys-global-stats": surveysGlobalStats,
	"survey-stats": surveyStats,
};

export const getToolsFromContext = async (
	context: Context,
	features?: string[],
): Promise<Tool<ZodObjectAny>[]> => {
	const allowedToolNames = getFilteredToolNames(features);
	const toolBases: ToolBase<ZodObjectAny>[] = [];

	for (const toolName of allowedToolNames) {
		// Special handling for docs-search which requires API key
		if (toolName === "docs-search" && context.env.INKEEP_API_KEY) {
			toolBases.push(searchDocs());
		} else if (TOOL_MAP[toolName]) {
			toolBases.push(TOOL_MAP[toolName]());
		}
	}

	const tools: Tool<ZodObjectAny>[] = toolBases.map((toolBase) => {
		const definition = getToolDefinition(toolBase.name);
		return {
			...toolBase,
			title: definition.title,
			description: definition.description,
			scopes: definition.required_scopes ?? [],
			annotations: definition.annotations,
		};
	});

	const { scopes } = await context.stateManager.getApiKey();

	const filteredTools = tools.filter((tool) => {
		return hasScopes(scopes, tool.scopes);
	});

	return filteredTools;
};

export type PostHogToolsOptions = {
	posthogApiToken: string;
	posthogApiBaseUrl: string;
	inkeepApiKey?: string;
};
export class PostHogAgentToolkit {
	public options: PostHogToolsOptions;

	constructor(options: PostHogToolsOptions) {
		this.options = options;
	}

	getContext(): Context {
		const api = new ApiClient({
			apiToken: this.options.posthogApiToken,
			baseUrl: this.options.posthogApiBaseUrl,
		});

		const scope = hash(this.options.posthogApiToken);
		const cache = new MemoryCache(scope);

		return {
			api,
			cache,
			env: {
				INKEEP_API_KEY: this.options.inkeepApiKey,
			},
			stateManager: new StateManager(cache, api),
			sessionManager: new SessionManager(cache),
		};
	}
	async getTools(): Promise<Tool<ZodObjectAny>[]> {
		const context = this.getContext();
		return await getToolsFromContext(context);
	}
}

export type { Context, State, Tool } from "./types";
