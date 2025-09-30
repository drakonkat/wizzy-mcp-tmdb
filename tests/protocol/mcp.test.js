import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Mock tmdbFetch
const mockTmdbFetch = jest.fn();

// Mock sendLoggingMessage
const mockSendLoggingMessage = jest.fn();

// Define mapSearchResult (copied)
function mapSearchResult(item) {
    const media_type = item.media_type || (item.title ? "movie" : item.name ? "tv" : "unknown");
    const title = item.title || item.name || "";
    const date = item.release_date || item.first_air_date || "";
    return {
        id: item.id,
        media_type,
        title,
        date,
        original_language: item.original_language,
        popularity: item.popularity,
        vote_average: item.vote_average,
        overview: item.overview,
    };
}

// Define tools (copied, only the three for testing)
const tools = [
    {
        name: "search_tmdb",
        description: "Search TMDB for movies, TV shows, and people.",
        inputSchema: {
            type: "object",
            properties: {
                query: {type: "string", description: "Search text query"},
                page: {type: "number", minimum: 1, description: "Page number (1-1000)"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"},
                include_adult: {type: "boolean", description: "Include adult results"},
                region: {type: "string", description: "ISO 3166-1 code (e.g., US)"},
            },
            required: ["query"],
            additionalProperties: false,
        },
        handler: async ({query, page, language, include_adult, region}) => {
            if (!query || typeof query !== "string") {
                throw new Error("query must be a non-empty string");
            }
            const data = await mockTmdbFetch("/search/multi", {query, page, language, include_adult, region});
            const results = Array.isArray(data.results) ? data.results.map(mapSearchResult) : [];
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            page: data.page,
                            total_pages: data.total_pages,
                            total_results: data.total_results,
                            results
                        }, null, 2),
                    },
                ],
            };
        },
    },
    {
        name: "get_tmdb_details",
        description: "Get details for a TMDB item by type and id.",
        inputSchema: {
            type: "object",
            properties: {
                type: {type: "string", enum: ["movie", "tv", "person"], description: "The TMDB media type"},
                id: {type: "number", description: "TMDB ID"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"},
                append: {type: "string", description: "Comma-separated append_to_response (e.g., credits,images)"},
            },
            required: ["type", "id"],
            additionalProperties: false,
        },
        handler: async ({type, id, language, append}) => {
            const data = await mockTmdbFetch(`/${type}/${id}`, {language, append_to_response: append});
            return {content: [{type: "text", text: JSON.stringify(data)}]};
        },
    },
    {
        name: "trending_all",
        description: "List trending content across all media types.",
        inputSchema: {
            type: "object",
            properties: {
                time_window: {type: "string", enum: ["day", "week"], description: "Time window"},
                page: {type: "number", minimum: 1},
                language: {type: "string"},
                region: {type: "string"},
                include_adult: {type: "boolean"}
            },
            required: ["time_window"],
            additionalProperties: false
        },
        handler: async ({time_window, page, language, region, include_adult}) => {
            const data = await mockTmdbFetch(`/trending/all/${time_window}`, {page, language, region, include_adult});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
];

// Mock sendLog
async function sendLog(level, data) {
    try {
        await mockSendLoggingMessage({
            level,
            data: typeof data === "string" ? data : JSON.stringify(data),
        });
    } catch {
        // Silently ignore
    }
}

// Define handlers
const listToolsHandler = async (_req) => ({
    tools: tools.map(({name, description, inputSchema}) => ({name, description, inputSchema})),
});

const callToolHandler = async (req) => {
    const {name, arguments: args} = req.params || {};
    const tool = tools.find(t => t.name === name);
    if (!tool) {
        await sendLog("error", `Unknown tool called: ${name || "<missing>"} with args: ${JSON.stringify(args || {})}`);
        throw new Error(`Unknown tool: ${name}`);
    }
    await sendLog("info", `Calling tool: ${name} with args: ${JSON.stringify(args || {})}`);
    try {
        const start = Date.now();
        const res = await tool.handler(args || {});
        const ms = Date.now() - start;
        await sendLog("info", `Tool success: ${name} in ${ms}ms`);
        return res;
    } catch (err) {
        await sendLog("error", `Tool error: ${name} -> ${err && err.message ? err.message : String(err)}`);
        throw err;
    }
};

describe('MCP Protocol Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTmdbFetch.mockResolvedValue({
            page: 1,
            total_pages: 1,
            total_results: 1,
            results: [{ id: 1, title: 'Test', media_type: 'movie' }]
        });
    });

    describe('ListToolsRequestSchema', () => {
        it('should return list of tools with correct schema', async () => {
            const result = await listToolsHandler({});

            expect(result).toEqual({
                tools: tools.map(({name, description, inputSchema}) => ({name, description, inputSchema}))
            });
        });
    });

    describe('CallToolRequestSchema', () => {
        it('should call search_tmdb tool successfully', async () => {
            const callHandler = callToolHandler;
            const result = await callHandler({
                params: {
                    name: "search_tmdb",
                    arguments: { query: "test query" }
                }
            });

            expect(mockSendLoggingMessage).toHaveBeenCalledWith({
                level: "info",
                data: "Calling tool: search_tmdb with args: {\"query\":\"test query\"}"
            });
            expect(mockSendLoggingMessage).toHaveBeenCalledWith({
                level: "info",
                data: expect.stringContaining("Tool success: search_tmdb in")
            });
            expect(result.content[0].type).toBe('text');
        });

        it('should handle unknown tool', async () => {
            const callHandler = callToolHandler;
            await expect(callHandler({
                params: {
                    name: "unknown_tool",
                    arguments: {}
                }
            })).rejects.toThrow('Unknown tool: unknown_tool');

            expect(mockSendLoggingMessage).toHaveBeenCalledWith({
                level: "error",
                data: "Unknown tool called: unknown_tool with args: {}"
            });
        });

        it('should handle tool error', async () => {
            mockTmdbFetch.mockRejectedValue(new Error('API Error'));
            const callHandler = callToolHandler;

            await expect(callHandler({
                params: {
                    name: "search_tmdb",
                    arguments: { query: "error query" }
                }
            })).rejects.toThrow('API Error');

            expect(mockSendLoggingMessage).toHaveBeenCalledWith({
                level: "error",
                data: "Tool error: search_tmdb -> API Error"
            });
        });

        it('should call get_tmdb_details tool', async () => {
            mockTmdbFetch.mockResolvedValue({ id: 123, title: 'Test Movie' });
            const callHandler = callToolHandler;

            const result = await callHandler({
                params: {
                    name: "get_tmdb_details",
                    arguments: { type: "movie", id: 123 }
                }
            });

            expect(result.content[0].text).toBe(JSON.stringify({ id: 123, title: 'Test Movie' }));
        });

        it('should call trending_all tool', async () => {
            const callHandler = callToolHandler;
            const result = await callHandler({
                params: {
                    name: "trending_all",
                    arguments: { time_window: "day" }
                }
            });

            expect(result.content[0].type).toBe('text');
        });
    });
});