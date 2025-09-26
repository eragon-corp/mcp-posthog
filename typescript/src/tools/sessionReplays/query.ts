import type { Context, ToolBase } from "@/tools/types";

import { SessionReplaysQueryInputSchema } from "@/schema/tool-inputs";
import type { z } from "zod";

const schema = SessionReplaysQueryInputSchema;
type Params = z.infer<typeof schema>;

function escapeSingleQuotes(input: string): string {
    return input.replace(/'/g, "''");
}

export const sessionReplaysQueryHandler = async (context: Context, params: Params) => {
    const {
        pageUrlContains,
        eventName = "$pageview",
        minActiveMilliseconds,
        limit = 100,
        date_from,
        date_to,
        filterTestAccounts,
    } = params;

    const projectId = await context.stateManager.getProjectId();

    // Build WHERE clauses safely
    const where: string[] = [];

    if (typeof minActiveMilliseconds === "number") {
        where.push(`r.active_milliseconds >= ${Math.max(0, Math.floor(minActiveMilliseconds))}`);
    }

    if (pageUrlContains && pageUrlContains.trim() !== "") {
        const needle = escapeSingleQuotes(pageUrlContains.trim());
        const ev = escapeSingleQuotes(eventName);
        // Match by event and URL using case-insensitive LIKE
        where.push(`e.event = '${ev}'`);
        where.push(`lower(e.properties["$current_url"]) LIKE lower('%${needle}%')`);
    }

    // Date range via HogQL filters object
    const filters: Record<string, any> = { dateRange: {} as Record<string, any> };
    if (date_from != null) filters.dateRange.date_from = date_from;
    if (date_to != null) filters.dateRange.date_to = date_to;
    if (filterTestAccounts != null) filters.filterTestAccounts = !!filterTestAccounts;

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
SELECT
  r.session_id,
  r.active_milliseconds,
  any(r.click_count) AS click_count,
  any(r.keypress_count) AS keypress_count,
  any(r.start_time) AS start_time,
  any(r.end_time) AS end_time,
  any(s.$session_duration) AS session_duration,
  min(e.timestamp) AS first_event_time,
  max(e.timestamp) AS last_event_time
FROM raw_session_replay_events r
LEFT JOIN sessions s ON s.session_id = r.session_id
LEFT JOIN events e ON e.properties["$session_id"] = r.session_id
${whereSql}
GROUP BY r.session_id, r.active_milliseconds
ORDER BY r.active_milliseconds DESC
LIMIT ${Math.min(Math.max(1, limit), 1000)}
`; 

    const query = {
        kind: "DataVisualizationNode" as const,
        source: {
            kind: "HogQLQuery" as const,
            query: sql,
            filters,
        },
    };

    const result = await context.api.insights({ projectId }).query({ query });

    if (!result.success) {
        throw new Error(`Failed to query session replays: ${result.error.message}`);
    }

    return { content: [{ type: "text", text: JSON.stringify(result.data.results) }] };
};

const tool = (): ToolBase<typeof schema> => ({
    name: "session-replays-query",
    schema,
    handler: sessionReplaysQueryHandler,
});

export default tool;


