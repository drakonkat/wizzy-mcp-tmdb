MCP TMDB Server (JavaScript)

Overview
- This repository includes an MCP (Model Context Protocol) server that allows an AI client to search TMDB (The Movie Database) and fetch details for items.
- Implemented in JavaScript (no TypeScript), file: mcp-tmdb-server.js
- Tools exposed:
  - search_tmdb: Multi-search across movies, TV, and people
  - search_tmdb_movies: Targeted search for movies with optional year filter
  - get_tmdb_details: Fetch details for movie/tv/person by id

Prerequisites
- Node.js 18+ (for global fetch)
- TMDB_AUTH_TOKEN: a Bearer token used with the TNL TMDB proxy (production-api.tnl.one). Ask your admin for the token, then set it as environment variable TMDB_AUTH_TOKEN.

Install
1) Install dependencies:
   npm install

Start the MCP server
- Windows PowerShell (current environment):
  $env:TMDB_AUTH_TOKEN="YOUR_TNL_PROXY_BEARER_TOKEN"; npm start

- macOS/Linux:
  TMDB_AUTH_TOKEN="YOUR_TNL_PROXY_BEARER_TOKEN" npm start

How to use with an MCP client
- This server communicates over stdio. Configure your MCP-compatible client (e.g., Model Context Protocol capable IDE or chat client) to start the command:
  Command: node mcp-tmdb-server.js
  Env: TMDB_AUTH_TOKEN=YOUR_TNL_PROXY_BEARER_TOKEN

Quick local test (discover/tv)
- After starting the server, you can manually test the proxy token is working with curl (bypassing MCP) using the exact endpoint the tools would call:
  Windows PowerShell:
  curl -H "Authorization: $env:TMDB_AUTH_TOKEN" -H "Accept: application/json" `
    "https://production-api.tnl.one/service/tmdb/3/discover/tv?language=en&page=1&with_watch_providers=8&sort_by=release_date.desc&watch_region=IS"

  macOS/Linux:
  curl -H "Authorization: $TMDB_AUTH_TOKEN" -H "Accept: application/json" \
    "https://production-api.tnl.one/service/tmdb/3/discover/tv?language=en&page=1&with_watch_providers=8&sort_by=release_date.desc&watch_region=IS"

- Expected: a JSON payload listing TV results. If you get 401/403, verify TMDB_AUTH_TOKEN is set and valid.

Tool schemas and examples
- search_tmdb
  Input JSON:
  { "query": "dune", "page": 1, "language": "en-US", "include_adult": false }
  Returns JSON with compact results: id, media_type, title, date, overview, etc.

- search_tmdb_movies
  Input JSON:
  { "query": "mission impossible", "year": 1996 }

- get_tmdb_details
  Input JSON:
  { "type": "movie", "id": 438631, "append": "credits,images" }

Junie usage guidelines
- Purpose: Provide the AI with commands to search on TMDB via MCP tools. Prefer multi-search (search_tmdb) when you don't know the media type.
- Disambiguation: When the AI receives multiple results, it should pick by id and call get_tmdb_details for more info.
- Parameters:
  - language: Prefer en-US unless the user requests another locale.
  - Pagination: If results seem truncated, increment page.
  - Adult content: Set include_adult=false unless the user explicitly requests adult content.
- Error handling: If the server returns an error about TMDB_AUTH_TOKEN, ensure the environment variable is set before retrying.

Notes
- This server is intentionally minimal to satisfy the requirements.
- Extend with more tools if needed (e.g., trending, discover endpoints).
