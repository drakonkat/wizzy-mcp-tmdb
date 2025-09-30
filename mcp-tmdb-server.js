// MCP TMDB Server (JavaScript)
// Implements a simple Model Context Protocol server exposing tools to search TMDB and get details.
// Requirements: Node.js 18+ (for global fetch) or install node-fetch if older. Uses @modelcontextprotocol/sdk.

import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {CallToolRequestSchema, ListToolsRequestSchema} from "@modelcontextprotocol/sdk/types.js";

// Use proxy base and TMDB Authorization token from environment variable for TMDB calls via proxy
const TMDB_AUTH_TOKEN = process.env.TMDB_AUTH_TOKEN;

if (!TMDB_AUTH_TOKEN) {
    throw new Error("TMDB_AUTH_TOKEN environment variable is not set. Please set it to your TNL proxy bearer token.");
}

const TMDB_BASE = "https://production-api.tnl.one/service/tmdb/3";

async function tmdbFetch(path, params = {}) {
    if (!TMDB_AUTH_TOKEN) {
        throw new Error("TMDB authorization token is not configured");
    }
    const url = new URL(TMDB_BASE + path);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    });

    const res = await fetch(url, {
        headers: {
            Accept: "application/json",
            Authorization: TMDB_AUTH_TOKEN,
        },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`TMDB request failed ${res.status}: ${text}`);
    }
    return res.json();
}

// Normalize TMDB results to a compact list for AI consumption
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

// Create MCP server
const server = new Server({
    name: "mcp-tmdb-js",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});

// Helper: send logs to the LLM provider (best-effort, non-bloccante)
async function sendLog(level, data) {
    try {
        await server.sendLoggingMessage({
            level,
            data: typeof data === "string" ? data : JSON.stringify(data),
        });
    } catch {
        // Silently ignore if transport not ready or logging not supported
    }
}

// Define tools registry (MCP v1 tools/list & tools/call)
const tools = [
    // Tool: person_details
    // Purpose: Retrieve detailed information about a person (actor, director, etc.) from TMDB.
    // Input: person_id (required), language (optional), append (optional comma-separated fields like images,combined_credits).
    // Output: JSON object containing person details, biography, birth/death dates, etc.
    // Use case: AI agents can fetch biographical data and related media for a specific individual.
    {
        name: "person_details",
        description: "Retrieves detailed information about a person (actor, director, etc.) from TMDB. Input: person_id (required TMDB ID), language (optional ISO 639-1 code), append (optional comma-separated fields like images,combined_credits,external_ids). Output: JSON with biography, birth/death info, and appended data. Purpose: Get comprehensive person profiles for AI-driven content analysis or recommendations.",
        inputSchema: {
            type: "object",
            properties: {
                person_id: {type: "number", description: "TMDB Person ID"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"},
                append: {
                    type: "string",
                    description: "Comma-separated append_to_response (e.g., images,combined_credits,external_ids)"
                }
            },
            required: ["person_id"],
            additionalProperties: false
        },
        handler: async ({person_id, language, append}) => {
            const data = await tmdbFetch(`/person/${person_id}`, {language, append_to_response: append});
            return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: movie_lists
    // Purpose: Retrieve lists (collections) that include a specific movie.
    // Input: movie_id (required), language (optional), page (optional).
    // Output: JSON with paginated list of collections containing the movie.
    // Use case: AI agents can discover curated lists or collections featuring a particular film.
    {
        name: "movie_lists",
        description: "Retrieves lists and collections that include a specific movie. Input: movie_id (required TMDB ID), language (optional ISO 639-1 code), page (optional page number). Output: JSON with paginated results of lists containing the movie. Purpose: Discover curated collections and lists featuring a movie for content curation by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                movie_id: {type: "number", description: "TMDB Movie ID"},
                language: {type: "string", description: "ISO 639-1 language (e.g., en-US)"},
                page: {type: "number", minimum: 1, description: "Page number"}
            },
            required: ["movie_id"],
            additionalProperties: false
        },
        handler: async ({movie_id, language, page}) => {
            const data = await tmdbFetch(`/movie/${movie_id}/lists`, {language, page});
            return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: movie_images
    // Purpose: Fetch various images (posters, backdrops, logos) for a movie.
    // Input: movie_id (required), language (optional), include_image_language (optional filter).
    // Output: JSON with arrays of backdrops, posters, logos.
    // Use case: AI agents can access visual assets for movie representation or analysis.
    {
        name: "movie_images",
        description: "Fetches images (posters, backdrops, logos) for a movie. Input: movie_id (required TMDB ID), language (optional ISO 639-1 code), include_image_language (optional comma-separated languages). Output: JSON with image arrays. Purpose: Obtain visual media assets for a movie to support AI-driven image processing or content enrichment.",
        inputSchema: {
            type: "object",
            properties: {
                movie_id: {type: "number", description: "TMDB Movie ID"},
                language: {type: "string", description: "ISO 639-1 language (e.g., en-US)"},
                include_image_language: {
                    type: "string",
                    description: "Filter image languages (comma-separated ISO 639-1 codes or 'null')"
                }
            },
            required: ["movie_id"],
            additionalProperties: false
        },
        handler: async ({movie_id, language, include_image_language}) => {
            const data = await tmdbFetch(`/movie/${movie_id}/images`, {language, include_image_language});
            return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: movie_reviews
    // Purpose: Get user reviews and ratings for a movie.
    // Input: movie_id (required), language (optional), page (optional), region (optional).
    // Output: JSON with paginated list of reviews.
    // Use case: AI agents can analyze public sentiment and feedback on movies.
    {
        name: "movie_reviews",
        description: "Retrieves user reviews and ratings for a movie. Input: movie_id (required TMDB ID), language (optional ISO 639-1 code), page (optional), region (optional ISO 3166-1 code). Output: JSON with paginated review results. Purpose: Access public opinions and critiques for sentiment analysis by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                movie_id: {type: "number", description: "TMDB Movie ID"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"},
                page: {type: "number", minimum: 1, description: "Page number"},
                region: {type: "string", description: "ISO 3166-1 region code (e.g., US)"}
            },
            required: ["movie_id"],
            additionalProperties: false
        },
        handler: async ({movie_id, language, page, region}) => {
            const data = await tmdbFetch(`/movie/${movie_id}/reviews`, {language, page, region});
            return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: movie_credits
    // Purpose: Get cast and crew information for a movie.
    // Input: movie_id (required), language (optional).
    // Output: JSON with cast and crew arrays.
    // Use case: AI agents can identify actors, directors, and production staff for a film.
    {
        name: "movie_credits",
        description: "Fetches cast and crew credits for a movie. Input: movie_id (required TMDB ID), language (optional ISO 639-1 code). Output: JSON with cast and crew details. Purpose: Retrieve detailed personnel information for movie analysis and recommendations by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                movie_id: {type: "number", description: "TMDB Movie ID"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"}
            },
            required: ["movie_id"],
            additionalProperties: false
        },
        handler: async ({movie_id, language}) => {
            const data = await tmdbFetch(`/movie/${movie_id}/credits`, {language});
            return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: search_keywords
    // Purpose: Search for TMDB keywords (tags) by text query.
    // Input: query (required), page (optional).
    // Output: JSON with paginated keyword results.
    // Use case: AI agents can find relevant keywords for content tagging or search enhancement.
    {
        name: "search_keywords",
        description: "Searches for TMDB keywords (tags) by text query. Input: query (required search string), page (optional page number). Output: JSON with paginated keyword results. Purpose: Discover keywords for content categorization and search optimization by AI agents.",
        inputSchema: {
            type: "object",
            properties: {query: {type: "string", description: "Search query for keywords"}, page: {type: "number", minimum: 1, description: "Page number"}},
            required: ["query"],
            additionalProperties: false
        },
        handler: async ({query, page}) => {
            const data = await tmdbFetch('/search/keyword', {query, page});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: search_tmdb
    // Purpose: Perform a multi-type search across movies, TV shows, and people.
    // Input: query (required), page (optional), language (optional), include_adult (optional), region (optional).
    // Output: JSON with paginated results, each item normalized to id, media_type, title, date, etc.
    // Use case: AI agents can perform broad searches to find relevant media content.
    {
        name: "search_tmdb",
        description: "Performs a multi-type search across TMDB for movies, TV shows, and people. Input: query (required search string), page (optional 1-1000), language (optional ISO 639-1), include_adult (optional boolean), region (optional ISO 3166-1). Output: JSON with paginated normalized results (id, media_type, title, date, etc.). Purpose: Enable comprehensive content discovery for AI-driven queries.",
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
            const data = await tmdbFetch("/search/multi", {query, page, language, include_adult, region});
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
    // Tool: get_tmdb_details
    // Purpose: Fetch detailed information for a specific movie, TV show, or person.
    // Input: type (required: movie|tv|person), id (required), language (optional), append (optional comma-separated fields).
    // Output: JSON with full details, including appended data.
    // Use case: AI agents can retrieve comprehensive metadata for specific media items.
    {
        name: "get_tmdb_details",
        description: "Fetches detailed information for a movie, TV show, or person by type and ID. Input: type (required: movie|tv|person), id (required TMDB ID), language (optional ISO 639-1), append (optional comma-separated fields like credits,images). Output: JSON with full item details. Purpose: Obtain in-depth metadata for targeted content analysis by AI agents.",
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
            const data = await tmdbFetch(`/${type}/${id}`, {language, append_to_response: append});
            return {content: [{type: "text", text: JSON.stringify(data)}]};
        },
    },
    // Tool: search_tmdb_movies
    // Purpose: Search specifically for movies in TMDB.
    // Input: query (required), year (optional filter), page (optional), language (optional), include_adult (optional), region (optional).
    // Output: JSON with paginated normalized movie results.
    // Use case: AI agents can find movies matching specific criteria.
    {
        name: "search_tmdb_movies",
        description: "Searches specifically for movies in TMDB. Input: query (required search string), year (optional release year filter), page (optional), language (optional ISO 639-1), include_adult (optional boolean), region (optional ISO 3166-1). Output: JSON with paginated normalized results. Purpose: Targeted movie discovery for AI-driven content queries.",
        inputSchema: {
            type: "object",
            properties: {
                query: {type: "string", description: "Search query for movies"},
                year: {type: "number", description: "Filter by release year"},
                page: {type: "number", minimum: 1, description: "Page number"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"},
                include_adult: {type: "boolean", description: "Include adult results"},
                region: {type: "string", description: "ISO 3166-1 region code (e.g., US)"},
            },
            required: ["query"],
            additionalProperties: false,
        },
        handler: async ({query, year, page, language, include_adult, region}) => {
            const data = await tmdbFetch("/search/movie", {query, year, page, language, include_adult, region});
            const results = (data.results || []).map(mapSearchResult);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        page: data.page,
                        total_pages: data.total_pages,
                        total_results: data.total_results,
                        results
                    }, null, 2)
                }]
            };
        },
    },
    // Tool: search_tmdb_tv
    // Purpose: Search specifically for TV shows in TMDB.
    // Input: query (required), page (optional), language (optional), first_air_date_year (optional), include_adult (optional).
    // Output: JSON with paginated normalized TV results.
    // Use case: AI agents can find TV series matching specific criteria.
    {
        name: "search_tmdb_tv",
        description: "Searches specifically for TV shows in TMDB. Input: query (required search string), page (optional), language (optional ISO 639-1), first_air_date_year (optional year filter), include_adult (optional boolean). Output: JSON with paginated normalized results. Purpose: Targeted TV show discovery for AI-driven content queries.",
        inputSchema: {
            type: "object",
            properties: {
                query: {type: "string", description: "Search query for TV shows"},
                page: {type: "number", minimum: 1, description: "Page number"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"},
                first_air_date_year: {type: "number", description: "Filter by first air date year"},
                include_adult: {type: "boolean", description: "Include adult results"},
            },
            required: ["query"],
            additionalProperties: false,
        },
        handler: async ({query, page, language, first_air_date_year, include_adult}) => {
            const data = await tmdbFetch('/search/tv', {query, page, language, first_air_date_year, include_adult});
            const results = (data.results || []).map(mapSearchResult);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        page: data.page,
                        total_pages: data.total_pages,
                        total_results: data.total_results,
                        results
                    }, null, 2)
                }]
            };
        }
    },
    // Tool: search_tmdb_person
    // Purpose: Search for people (actors, directors, etc.) in TMDB.
    // Input: query (required), page (optional), language (optional), include_adult (optional), region (optional).
    // Output: JSON with paginated person results.
    // Use case: AI agents can find individuals involved in media production.
    {
        name: "search_tmdb_person",
        description: "Searches for people (actors, directors, etc.) in TMDB. Input: query (required search string), page (optional), language (optional ISO 639-1), include_adult (optional boolean), region (optional ISO 3166-1). Output: JSON with paginated person results. Purpose: Discover individuals for cast/crew analysis by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                query: {type: "string", description: "Search query for people"},
                page: {type: "number", minimum: 1, description: "Page number"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"},
                include_adult: {type: "boolean", description: "Include adult results"},
                region: {type: "string", description: "ISO 3166-1 region code (e.g., US)"},
            },
            required: ["query"],
            additionalProperties: false,
        },
        handler: async ({query, page, language, include_adult, region}) => {
            const data = await tmdbFetch('/search/person', {query, page, language, include_adult, region});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: get_watch_providers
    // Purpose: Retrieve available watch providers (streaming services) for movies or TV in a region.
    // Input: type (required: movie|tv), language (optional), watch_region (required ISO 3166-1).
    // Output: JSON with list of providers and their details.
    // Use case: AI agents can identify where content is available for streaming.
    {
        name: "get_watch_providers",
        description: "Retrieves watch providers (streaming services) for movies or TV in a specific region. Input: type (required: movie|tv), language (optional ISO 639-1, default en), watch_region (required ISO 3166-1 code). Output: JSON with provider list. Purpose: Discover streaming availability for content recommendations by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                type: {type: "string", enum: ["movie", "tv"], description: "Media type for providers endpoint"},
                language: {type: "string", description: "ISO 639-1 language (e.g., en)"},
                watch_region: {type: "string", description: "ISO 3166-1 region code (e.g., IT)"}
            },
            required: ["watch_region", "type"],
            additionalProperties: false
        },
        handler: async ({type = "tv", language = "en", watch_region}) => {
            const data = await tmdbFetch(`/watch/providers/${type}`, {language, watch_region});
            return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: discover_by_provider
    // Purpose: Discover content available on specific streaming providers in a region.
    // Input: type (optional: tv|movie, default tv), with_watch_providers (required comma-separated IDs), watch_region (required), language (optional), page (optional), sort_by (optional).
    // Output: JSON with paginated content results.
    // Use case: AI agents can find content based on user's streaming subscriptions.
    {
        name: "discover_by_provider",
        description: "Discovers movies or TV shows available on specific streaming providers in a region. Input: type (optional: tv|movie, default tv), with_watch_providers (required comma-separated provider IDs), watch_region (required ISO 3166-1), language (optional ISO 639-1, default en), page (optional), sort_by (optional). Output: JSON with paginated results. Purpose: Personalized content discovery based on streaming availability for AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                type: {
                    type: "string",
                    enum: ["tv", "movie"],
                    description: "Media type to discover: tv (default) or movie"
                },
                with_watch_providers: {
                    type: "string",
                    description: "Provider ID(s), comma-separated (e.g., '8'), from service get_watch_providers"
                },
                watch_region: {type: "string", description: "ISO 3166-1 region code (e.g., IS)"},
                language: {type: "string", description: "ISO 639-1 language (e.g., en)"},
                page: {type: "number", minimum: 1, description: "Page number"},
                sort_by: {
                    type: "string",
                    description: "Sort order (e.g., release_date.desc, first_air_date.desc, popularity.desc)"
                }
            },
            required: ["with_watch_providers", "watch_region"],
            additionalProperties: false
        },
        handler: async ({
                             type = "tv",
                             with_watch_providers,
                             watch_region,
                             language = "en",
                             page = 1,
                             sort_by = "release_date.desc"
                         }) => {
            const data = await tmdbFetch(`/discover/${type}`, {
                language,
                page,
                with_watch_providers,
                sort_by,
                watch_region
            });
            return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: discover_movies
    // Purpose: Advanced discovery of movies with extensive filtering options.
    // Input: Various optional filters like language, region, sort_by, certifications, dates, genres, etc. (see schema).
    // Output: JSON with paginated movie results.
    // Use case: AI agents can perform sophisticated movie searches based on multiple criteria.
    {
        name: "discover_movies",
        description: "Performs advanced discovery of movies with extensive filtering options. Input: Optional parameters including language (ISO 639-1), region (ISO 3166-1), sort_by, certifications, release dates, genres, keywords, watch providers, vote counts, etc. Output: JSON with paginated results. Purpose: Enable complex, criteria-based movie discovery for AI-driven content curation.",
        inputSchema: {
            type: "object",
            properties: {
                language: {type: "string", description: "ISO 639-1 language (e.g., en-US)"},
                region: {type: "string", description: "ISO 3166-1 region (e.g., US)"},
                sort_by: {
                    type: "string",
                    description: "Sort by (e.g., popularity.desc, release_date.desc, vote_average.desc, primary_release_date.desc, revenue.desc, original_title.asc)"
                },
                certification: {type: "string", description: "Filter by certification (e.g., PG-13)"},
                'certification.gte': {type: "string", description: "Certification greater than or equal to"},
                'certification.lte': {type: "string", description: "Certification less than or equal to"},
                'certification_country': {type: "string", description: "Certification country (ISO 3166-1)"},
                include_adult: {type: "boolean", description: "Include adult titles (default false)"},
                include_video: {type: "boolean", description: "Include items with videos"},
                page: {type: "number", minimum: 1, description: "Page number (1-500)"},
                'primary_release_year': {type: "number", description: "Primary release year"},
                'primary_release_date.gte': {type: "string", description: "Primary release date from (YYYY-MM-DD)"},
                'primary_release_date.lte': {type: "string", description: "Primary release date to (YYYY-MM-DD)"},
                'release_date.gte': {type: "string", description: "Release date from (YYYY-MM-DD)"},
                'release_date.lte': {type: "string", description: "Release date to (YYYY-MM-DD)"},
                with_release_type: {
                    type: "string",
                    description: "Comma-separated release types (e.g., 2|3). TMDB expects bitmask but pipe is accepted by API"
                },
                'with_original_language': {type: "string", description: "Original language (ISO 639-1)"},
                'with_runtime.gte': {type: "number", description: "Runtime min (minutes)"},
                'with_runtime.lte': {type: "number", description: "Runtime max (minutes)"},
                'with_cast': {type: "string", description: "Comma-separated person IDs"},
                'with_crew': {type: "string", description: "Comma-separated person IDs"},
                'with_people': {type: "string", description: "Comma-separated person IDs"},
                'with_companies': {type: "string", description: "Comma-separated company IDs"},
                'with_genres': {type: "string", description: "Comma-separated genre IDs"},
                'without_genres': {type: "string", description: "Comma-separated genre IDs to exclude"},
                'with_keywords': {type: "string", description: "Comma-separated keyword IDs"},
                'without_keywords': {type: "string", description: "Comma-separated keyword IDs to exclude"},
                'with_watch_providers': {type: "string", description: "Comma-separated watch provider IDs"},
                'watch_region': {type: "string", description: "ISO 3166-1 region for watch providers"},
                'with_watch_monetization_types': {
                    type: "string",
                    description: "Comma-separated monetization types (flatrate|free|ads|rent|buy)"
                },
                'vote_count.gte': {type: "number", description: "Minimum vote count"},
                'vote_count.lte': {type: "number", description: "Maximum vote count"},
                'vote_average.gte': {type: "number", description: "Minimum vote average (0-10)"},
                'vote_average.lte': {type: "number", description: "Maximum vote average (0-10)"},
                'with_release_type.gte': {type: "number", description: "Min release type mask (advanced)"},
                'with_release_type.lte': {type: "number", description: "Max release type mask (advanced)"},
                with_status: {
                    type: "string",
                    description: "Comma-separated status (Rumored|Planned|In Production|Post Production|Released|Canceled)"
                },
                with_type: {type: "string", description: "Comma-separated movie types (Documentary, etc.)"},
                'without_companies': {type: "string", description: "Comma-separated company IDs to exclude"},
                'screened_theatrically': {type: "boolean", description: "Filter for movies screened theatrically"}
            },
            additionalProperties: false
        },
        handler: async (args = {}) => {
            const data = await tmdbFetch('/discover/movie', args);
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: discover_tv
    // Purpose: Advanced discovery of TV shows with extensive filtering options.
    // Input: Various optional filters like language, sort_by, air dates, genres, networks, etc. (see schema).
    // Output: JSON with paginated TV results.
    // Use case: AI agents can perform sophisticated TV show searches based on multiple criteria.
    {
        name: "discover_tv",
        description: "Performs advanced discovery of TV shows with extensive filtering options. Input: Optional parameters including language (ISO 639-1), sort_by, air dates, genres, networks, keywords, watch providers, vote counts, etc. Output: JSON with paginated results. Purpose: Enable complex, criteria-based TV show discovery for AI-driven content curation.",
        inputSchema: {
            type: "object",
            properties: {
                language: {type: "string", description: "ISO 639-1 language (e.g., en-US)"},
                sort_by: {
                    type: "string",
                    description: "Sort by (e.g., popularity.desc, first_air_date.desc, vote_average.desc)"
                },
                'air_date.gte': {type: "string", description: "Air date from (YYYY-MM-DD)"},
                'air_date.lte': {type: "string", description: "Air date to (YYYY-MM-DD)"},
                'first_air_date.gte': {type: "string", description: "First air date from (YYYY-MM-DD)"},
                'first_air_date.lte': {type: "string", description: "First air date to (YYYY-MM-DD)"},
                'first_air_date_year': {type: "number", description: "First air date year"},
                page: {type: "number", minimum: 1, description: "Page number (1-500)"},
                timezone: {type: "string", description: "Timezone for air date lookups (e.g., America/New_York)"},
                'with_runtime.gte': {type: "number", description: "Runtime min (minutes)"},
                'with_runtime.lte': {type: "number", description: "Runtime max (minutes)"},
                include_null_first_air_dates: {type: "boolean", description: "Include shows with null first air dates"},
                'with_original_language': {type: "string", description: "Original language (ISO 639-1)"},
                'without_genres': {type: "string", description: "Comma-separated genre IDs to exclude"},
                'with_genres': {type: "string", description: "Comma-separated genre IDs"},
                'with_networks': {type: "string", description: "Comma-separated network IDs"},
                'with_companies': {type: "string", description: "Comma-separated company IDs"},
                'with_keywords': {type: "string", description: "Comma-separated keyword IDs"},
                'without_keywords': {type: "string", description: "Comma-separated keyword IDs to exclude"},
                'screened_theatrically': {type: "boolean", description: "Not applicable to TV but accepted safely"},
                'with_status': {
                    type: "string",
                    description: "Comma-separated production status (Returning Series|Planned|In Production|Ended|Canceled|Pilot)"
                },
                'with_type': {type: "string", description: "Comma-separated TV types (e.g., Documentary, News)"},
                'vote_average.gte': {type: "number", description: "Minimum vote average"},
                'vote_average.lte': {type: "number", description: "Maximum vote average"},
                'vote_count.gte': {type: "number", description: "Minimum vote count"},
                'vote_count.lte': {type: "number", description: "Maximum vote count"},
                'with_watch_providers': {type: "string", description: "Comma-separated watch provider IDs"},
                'watch_region': {type: "string", description: "ISO 3166-1 region for watch providers"},
                'with_watch_monetization_types': {
                    type: "string",
                    description: "Comma-separated monetization types (flatrate|free|ads|rent|buy)"
                },
                'with_name_translation': {
                    type: "string",
                    description: "ISO 639-1 language to filter by available translations"
                },
                'with_overview_translation': {
                    type: "string",
                    description: "ISO 639-1 language to filter overview translations"
                }
            },
            additionalProperties: false
        },
        handler: async (args = {}) => {
            const data = await tmdbFetch('/discover/tv', args);
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: trending_all
    // Purpose: Get trending content across all media types (movies, TV, people).
    // Input: time_window (required: day|week), page (optional), language (optional), region (optional), include_adult (optional).
    // Output: JSON with paginated trending results.
    // Use case: AI agents can identify currently popular content for recommendations.
    {
        name: "trending_all",
        description: "Retrieves trending content across movies, TV shows, and people. Input: time_window (required: day|week), page (optional), language (optional ISO 639-1), region (optional ISO 3166-1), include_adult (optional boolean). Output: JSON with paginated trending results. Purpose: Discover currently popular media for trend analysis and recommendations by AI agents.",
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
            const data = await tmdbFetch(`/trending/all/${time_window}`, {page, language, region, include_adult});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: trending_movies
    // Purpose: Get trending movies.
    // Input: time_window (required: day|week), page (optional), language (optional), region (optional), include_adult (optional).
    // Output: JSON with paginated trending movie results.
    // Use case: AI agents can identify currently popular movies.
    {
        name: "trending_movies",
        description: "Retrieves trending movies. Input: time_window (required: day|week), page (optional), language (optional ISO 639-1), region (optional ISO 3166-1), include_adult (optional boolean). Output: JSON with paginated trending results. Purpose: Discover currently popular movies for trend analysis by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                time_window: {type: "string", enum: ["day", "week"]},
                page: {type: "number", minimum: 1},
                language: {type: "string"},
                region: {type: "string"},
                include_adult: {type: "boolean"}
            },
            required: ["time_window"],
            additionalProperties: false
        },
        handler: async ({time_window, page, language, region, include_adult}) => {
            const data = await tmdbFetch(`/trending/movie/${time_window}`, {page, language, region, include_adult});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: trending_tv
    // Purpose: Get trending TV shows.
    // Input: time_window (required: day|week), page (optional), language (optional).
    // Output: JSON with paginated trending TV results.
    // Use case: AI agents can identify currently popular TV shows.
    {
        name: "trending_tv",
        description: "Retrieves trending TV shows. Input: time_window (required: day|week), page (optional), language (optional ISO 639-1). Output: JSON with paginated trending results. Purpose: Discover currently popular TV shows for trend analysis by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                time_window: {type: "string", enum: ["day", "week"]},
                page: {type: "number", minimum: 1},
                language: {type: "string"}
            },
            required: ["time_window"],
            additionalProperties: false
        },
        handler: async ({time_window, page, language}) => {
            const data = await tmdbFetch(`/trending/tv/${time_window}`, {page, language});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: trending_people
    // Purpose: Get trending people.
    // Input: time_window (required: day|week), page (optional), language (optional).
    // Output: JSON with paginated trending people results.
    // Use case: AI agents can identify currently popular individuals in media.
    {
        name: "trending_people",
        description: "Retrieves trending people (actors, directors, etc.). Input: time_window (required: day|week), page (optional), language (optional ISO 639-1). Output: JSON with paginated trending results. Purpose: Discover currently popular people for trend analysis by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                time_window: {type: "string", enum: ["day", "week"]},
                page: {type: "number", minimum: 1},
                language: {type: "string"}
            },
            required: ["time_window"],
            additionalProperties: false
        },
        handler: async ({time_window, page, language}) => {
            const data = await tmdbFetch(`/trending/person/${time_window}`, {page, language});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: tv_top_rated
    // Purpose: Get top-rated TV series.
    // Input: page (optional), language (optional), region (optional).
    // Output: JSON with paginated top-rated TV results.
    // Use case: AI agents can access highly rated TV content.
    {
        name: "tv_top_rated",
        description: "Retrieves top-rated TV series. Input: page (optional), language (optional ISO 639-1), region (optional ISO 3166-1). Output: JSON with paginated results. Purpose: Access highly rated TV shows for quality content recommendations by AI agents.",
        inputSchema: {
            type: "object",
            properties: {page: {type: "number", minimum: 1}, language: {type: "string"}, region: {type: "string"}},
            additionalProperties: false
        },
        handler: async ({page, language, region}) => {
            const data = await tmdbFetch('/tv/top_rated', {page, language, region});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: tv_airing_today
    // Purpose: Get TV series airing today.
    // Input: page (optional), language (optional), timezone (optional).
    // Output: JSON with paginated TV results airing today.
    // Use case: AI agents can find currently airing TV content.
    {
        name: "tv_airing_today",
        description: "Retrieves TV series airing today. Input: page (optional), language (optional ISO 639-1), timezone (optional). Output: JSON with paginated results. Purpose: Discover TV shows currently airing for timely recommendations by AI agents.",
        inputSchema: {
            type: "object",
            properties: {page: {type: "number", minimum: 1}, language: {type: "string"}, timezone: {type: "string"}},
            additionalProperties: false
        },
        handler: async ({page, language, timezone}) => {
            const data = await tmdbFetch('/tv/airing_today', {page, language, timezone});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: tv_popular
    // Purpose: Get popular TV series.
    // Input: page (optional), language (optional), region (optional).
    // Output: JSON with paginated popular TV results.
    // Use case: AI agents can access widely popular TV content.
    {
        name: "tv_popular",
        description: "Retrieves popular TV series. Input: page (optional), language (optional ISO 639-1), region (optional ISO 3166-1). Output: JSON with paginated results. Purpose: Access widely popular TV shows for general recommendations by AI agents.",
        inputSchema: {
            type: "object",
            properties: {page: {type: "number", minimum: 1}, language: {type: "string"}, region: {type: "string"}},
            additionalProperties: false
        },
        handler: async ({page, language, region}) => {
            const data = await tmdbFetch('/tv/popular', {page, language, region});
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
        }
    },
    // Tool: tv_credits
    // Purpose: Get cast and crew information for a TV show.
    // Input: tv_id (required), language (optional).
    // Output: JSON with cast and crew arrays.
    // Use case: AI agents can identify actors, directors, and production staff for a TV series.
    {
        name: "tv_credits",
        description: "Fetches cast and crew credits for a TV show. Input: tv_id (required TMDB ID), language (optional ISO 639-1). Output: JSON with cast and crew details. Purpose: Retrieve detailed personnel information for TV show analysis and recommendations by AI agents.",
        inputSchema: {
            type: "object",
            properties: {
                tv_id: {type: "number", description: "TMDB TV Show ID"},
                language: {type: "string", description: "ISO 639-1 code (e.g., en-US)"}
            },
            required: ["tv_id"],
            additionalProperties: false
        },
        handler: async ({tv_id, language}) => {
            const data = await tmdbFetch(`/tv/${tv_id}/credits`, {language});
            return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
        }
    },
];

// Register handlers for MCP tool methods
server.setRequestHandler(ListToolsRequestSchema, async (_req) => ({
    tools: tools.map(({name, description, inputSchema}) => ({name, description, inputSchema})),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
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
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await sendLog("info", "Server started successfully");
    console.error("[mcp-tmdb] Server started on stdio. Tools: person_details, movie_lists, movie_images, movie_reviews, movie_credits, search_keywords, search_tmdb, get_tmdb_details, search_tmdb_movies, search_tmdb_tv, search_tmdb_person, get_watch_providers, discover_by_provider, discover_movies, discover_tv, trending_all, trending_movies, trending_tv, trending_people, tv_top_rated, tv_airing_today, tv_popular, tv_credits");
}

main().catch(async (err) => {
    await sendLog("error", `Fatal error on startup: ${err && err.message ? err.message : String(err)}`);
    console.error("[mcp-tmdb] Fatal error:", err);
    process.exit(1);
});
