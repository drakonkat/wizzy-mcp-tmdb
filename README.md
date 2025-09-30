# wizzy-mcp-tmdb

[![Build Status](https://img.shields.io/github/actions/workflow/status/drakonkat/wizzy-mcp-tmdb/ci.yml)](https://github.com/drakonkat/wizzy-mcp-tmdb/actions)

[![Coverage](https://img.shields.io/codecov/c/github/drakonkat/wizzy-mcp-tmdb)](https://codecov.io/gh/drakonkat/wizzy-mcp-tmdb)

## Project Overview and Purpose

The wizzy-mcp-tmdb project is an MCP (Model Context Protocol) server implemented in JavaScript that provides tools to search and retrieve information from The Movie Database (TMDB). It allows AI clients to access movie, TV show, and person data through a standardized protocol.

## Key Features

- **Search Movies**: Perform multi-search across movies, TV shows, and people using the `search_tmdb` tool.
- **Get Details**: Fetch detailed information for specific items using the `get_tmdb_details` tool.
- **Trending Content**: Retrieve trending content across all media types with the `trending_all` tool.

## Installation

### Prerequisites

- Node.js version 18 or higher (required for global fetch support)
- A TMDB API key (Bearer token) from your admin, used with the TNL TMDB proxy (production-api.tnl.one)

### Setup

1. Clone the repository and navigate to the project directory.

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up your TMDB API key as an environment variable:

   - On Windows PowerShell:
     ```powershell
     $env:TMDB_AUTH_TOKEN="YOUR_TNL_PROXY_BEARER_TOKEN"
     ```

   - On macOS/Linux:
     ```bash
     export TMDB_AUTH_TOKEN="YOUR_TNL_PROXY_BEARER_TOKEN"
     ```

## Usage

### Starting the MCP Server

To start the server:

```bash
npm start
```

The server communicates over stdio and should be configured in your MCP-compatible client (e.g., IDE or chat client) with the command `node mcp-tmdb-server.js` and the `TMDB_AUTH_TOKEN` environment variable.

### MCP Integration Examples

Here are code snippets showing how to integrate with the MCP tools:

#### Search for Movies

```javascript
// Example MCP tool call for searching
{
  "method": "tools/call",
  "params": {
    "name": "search_tmdb",
    "arguments": {
      "query": "dune",
      "page": 1,
      "language": "en-US",
      "include_adult": false
    }
  }
}
```

#### Get Movie Details

```javascript
// Example MCP tool call for getting details
{
  "method": "tools/call",
  "params": {
    "name": "get_tmdb_details",
    "arguments": {
      "type": "movie",
      "id": 438631,
      "append": "credits,images"
    }
  }
}
```

#### Get Trending Content

```javascript
// Example MCP tool call for trending content
{
  "method": "tools/call",
  "params": {
    "name": "trending_all",
    "arguments": {
      "time_window": "day",
      "page": 1,
      "language": "en-US"
    }
  }
}
```

## Testing Strategy

The project uses Jest for comprehensive testing, including:

- **Unit Tests**: Validate individual handler functions, input validation, and response formatting (see `tests/unit/handlers.test.js`).
- **Integration Tests**: Test API interactions with mocked responses, error handling, and network failures (see `tests/integration/api.test.js`).
- **Protocol Tests**: Ensure MCP protocol compliance, including tool listing and calling (see `tests/protocol/mcp.test.js`).

Run the test suite with:

```bash
npm test
```

For watch mode:

```bash
npm run test:watch
```

## Project Structure

```
wizzy-mcp-tmdb/
├── mcp-tmdb-server.js          # Main MCP server implementation
├── package.json                # Project configuration and dependencies
├── MCP_GUIDE.md                # Detailed MCP integration guide
├── babel.config.cjs            # Babel configuration for Jest
├── tests/
│   ├── unit/
│   │   └── handlers.test.js    # Unit tests for handlers
│   ├── integration/
│   │   └── api.test.js         # Integration tests for API calls
│   └── protocol/
│       └── mcp.test.js         # MCP protocol compliance tests
└── tests/fixtures/             # Mock data for tests
    ├── movieDetails.json
    ├── searchMultiResponse.json
    └── trendingAllResponse.json
```

## Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository.
2. Create a feature branch.
3. Make your changes and add tests.
4. Ensure all tests pass.
5. Submit a pull request.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Acknowledgments

- Thanks to The Movie Database (TMDB) for providing the API.
- Built using the Model Context Protocol SDK.

## Contact

For questions or support, please open an issue on GitHub.
