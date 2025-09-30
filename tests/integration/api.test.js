import fs from 'fs';
import path from 'path';

// Load fixtures
const searchResponse = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/searchMultiResponse.json'), 'utf8'));
const movieDetails = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/movieDetails.json'), 'utf8'));
const trendingResponse = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/trendingAllResponse.json'), 'utf8'));

// Mock global fetch
global.fetch = jest.fn();

// Define TMDB constants (copied from main)
const TMDB_AUTH_TOKEN = "Bearer test_token";
const TMDB_BASE = "https://production-api.tnl.one/service/tmdb/3";

// Define tmdbFetch (copied from main)
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

// Define handlers (copied)
const searchTmdbHandler = async ({query, page, language, include_adult, region}) => {
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
};

const getTmdbDetailsHandler = async ({type, id, language, append}) => {
    const data = await tmdbFetch(`/${type}/${id}`, {language, append_to_response: append});
    return {content: [{type: "text", text: JSON.stringify(data)}]};
};

const trendingAllHandler = async ({time_window, page, language, region, include_adult}) => {
    const data = await tmdbFetch(`/trending/all/${time_window}`, {page, language, region, include_adult});
    return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
};

describe('API Integration Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('search_tmdb', () => {
        it('should handle successful search with mocked API response', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(searchResponse),
            });

            const result = await searchTmdbHandler({query: 'test movie', page: 1, language: 'en-US'});

            expect(global.fetch).toHaveBeenCalledWith(
                new URL('https://production-api.tnl.one/service/tmdb/3/search/multi?query=test+movie&page=1&language=en-US'),
                { headers: { Accept: "application/json", Authorization: "Bearer test_token" } }
            );

            expect(result.content[0].type).toBe('text');
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.results).toHaveLength(2);
            expect(parsed.results[0].title).toBe('Test Movie');
        });

        it('should handle API error response', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 404,
                text: () => Promise.resolve('Not Found'),
            });

            await expect(searchTmdbHandler({query: 'nonexistent'})).rejects.toThrow('TMDB request failed 404: Not Found');
        });

        it('should handle network error', async () => {
            global.fetch.mockRejectedValue(new Error('Network error'));

            await expect(searchTmdbHandler({query: 'test'})).rejects.toThrow('Network error');
        });
    });

    describe('get_tmdb_details', () => {
        it('should fetch movie details successfully', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(movieDetails),
            });

            const result = await getTmdbDetailsHandler({type: 'movie', id: 123, language: 'en', append: 'credits'});

            expect(global.fetch).toHaveBeenCalledWith(
                new URL('https://production-api.tnl.one/service/tmdb/3/movie/123?language=en&append_to_response=credits'),
                { headers: { Accept: "application/json", Authorization: "Bearer test_token" } }
            );

            expect(result.content[0].text).toBe(JSON.stringify(movieDetails));
        });
    });

    describe('trending_all', () => {
        it('should fetch trending content', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(trendingResponse),
            });

            const result = await trendingAllHandler({time_window: 'day', page: 1});

            expect(global.fetch).toHaveBeenCalledWith(
                new URL('https://production-api.tnl.one/service/tmdb/3/trending/all/day?page=1'),
                { headers: { Accept: "application/json", Authorization: "Bearer test_token" } }
            );

            expect(result.content[0].text).toBe(JSON.stringify(trendingResponse, null, 2));
        });
    });
});