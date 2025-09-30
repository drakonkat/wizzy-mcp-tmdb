import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';

// Load fixtures
const searchResponse = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/searchMultiResponse.json'), 'utf8'));
const movieDetails = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/movieDetails.json'), 'utf8'));
const trendingResponse = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/trendingAllResponse.json'), 'utf8'));

// Mock tmdbFetch
const mockTmdbFetch = jest.fn();

// Mock server.sendLoggingMessage
const mockSendLoggingMessage = jest.fn();

// Define mapSearchResult function (copied from main code)
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

// Define handlers (copied from main code)
const searchTmdbHandler = async ({query, page, language, include_adult, region}) => {
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
};

const getTmdbDetailsHandler = async ({type, id, language, append}) => {
    const data = await mockTmdbFetch(`/${type}/${id}`, {language, append_to_response: append});
    return {content: [{type: "text", text: JSON.stringify(data)}]};
};

const trendingAllHandler = async ({time_window, page, language, region, include_adult}) => {
    const data = await mockTmdbFetch(`/trending/all/${time_window}`, {page, language, region, include_adult});
    return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}]};
};

describe('Tool Handlers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('search_tmdb', () => {
        it('should validate query parameter', async () => {
            await expect(searchTmdbHandler({})).rejects.toThrow('query must be a non-empty string');
            await expect(searchTmdbHandler({query: ''})).rejects.toThrow('query must be a non-empty string');
            await expect(searchTmdbHandler({query: 123})).rejects.toThrow('query must be a non-empty string');
        });

        it('should call tmdbFetch with correct params and format response', async () => {
            mockTmdbFetch.mockResolvedValue(searchResponse);
            const result = await searchTmdbHandler({query: 'test', page: 1, language: 'en'});
            expect(mockTmdbFetch).toHaveBeenCalledWith('/search/multi', {query: 'test', page: 1, language: 'en', include_adult: undefined, region: undefined});
            expect(result.content[0].type).toBe('text');
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.results).toHaveLength(2);
            expect(parsed.results[0]).toHaveProperty('id', 123);
            expect(parsed.results[0]).toHaveProperty('media_type', 'movie');
        });

        it('should handle empty results', async () => {
            mockTmdbFetch.mockResolvedValue({...searchResponse, results: []});
            const result = await searchTmdbHandler({query: 'empty'});
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.results).toEqual([]);
        });

        it('should handle API error', async () => {
            mockTmdbFetch.mockRejectedValue(new Error('API Error'));
            await expect(searchTmdbHandler({query: 'error'})).rejects.toThrow('API Error');
        });
    });

    describe('get_tmdb_details', () => {
        it('should call tmdbFetch with correct path and params', async () => {
            mockTmdbFetch.mockResolvedValue(movieDetails);
            const result = await getTmdbDetailsHandler({type: 'movie', id: 123, language: 'en', append: 'credits'});
            expect(mockTmdbFetch).toHaveBeenCalledWith('/movie/123', {language: 'en', append_to_response: 'credits'});
            expect(result.content[0].type).toBe('text');
            expect(JSON.parse(result.content[0].text)).toEqual(movieDetails);
        });

        it('should handle API error', async () => {
            mockTmdbFetch.mockRejectedValue(new Error('Not found'));
            await expect(getTmdbDetailsHandler({type: 'movie', id: 999})).rejects.toThrow('Not found');
        });
    });

    describe('trending_all', () => {
        it('should call tmdbFetch with correct path and params', async () => {
            mockTmdbFetch.mockResolvedValue(trendingResponse);
            const result = await trendingAllHandler({time_window: 'day', page: 1});
            expect(mockTmdbFetch).toHaveBeenCalledWith('/trending/all/day', {page: 1, language: undefined, region: undefined, include_adult: undefined});
            expect(result.content[0].type).toBe('text');
            expect(JSON.parse(result.content[0].text)).toEqual(trendingResponse);
        });

        it('should handle API error', async () => {
            mockTmdbFetch.mockRejectedValue(new Error('Server error'));
            await expect(trendingAllHandler({time_window: 'week'})).rejects.toThrow('Server error');
        });
    });
});