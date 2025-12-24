# Qdrant MCP Server

Vector database access for AITO agents via Qdrant REST API.

## Use Cases

- **Code Search** - Find similar code patterns
- **Error Analysis** - Match errors to known solutions
- **Duplicate Detection** - Find similar issues/documents
- **RAG Support** - Retrieval-augmented generation

## Installation

```bash
cd mcp-servers/qdrant-mcp
npm install
npm run build
```

## Configuration

**Environment Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `QDRANT_URL` | Qdrant REST API URL | `http://qdrant:6333` |

## Tools

### Collection Management

| Tool | Description |
|------|-------------|
| `qdrant_list_collections` | List all collections |
| `qdrant_get_collection` | Get collection details (vector size, count, status) |
| `qdrant_create_collection` | Create new collection with vector size and distance metric |
| `qdrant_delete_collection` | Delete a collection |

### Point Operations

| Tool | Description |
|------|-------------|
| `qdrant_upsert_points` | Insert or update points with vectors and payloads |
| `qdrant_get_points` | Retrieve points by IDs |
| `qdrant_delete_points` | Delete points by IDs or filter |
| `qdrant_scroll` | Paginate through points |
| `qdrant_count` | Count points (with optional filter) |

### Search

| Tool | Description |
|------|-------------|
| `qdrant_search` | Vector similarity search with filters |

## Examples

### Create Collection

```json
{
  "name": "code_snippets",
  "vector_size": 1024,
  "distance": "Cosine"
}
```

### Upsert Points

```json
{
  "collection": "code_snippets",
  "points": [
    {
      "id": "snippet-1",
      "vector": [0.1, 0.2, ...],
      "payload": {
        "code": "function hello() { ... }",
        "language": "typescript",
        "file": "src/utils.ts"
      }
    }
  ]
}
```

### Search Similar

```json
{
  "collection": "code_snippets",
  "vector": [0.1, 0.2, ...],
  "limit": 5,
  "filter": {
    "must": [
      { "key": "language", "match": { "value": "typescript" } }
    ]
  }
}
```

### Filter Syntax

Qdrant uses a powerful filter syntax:

```json
{
  "filter": {
    "must": [
      { "key": "type", "match": { "value": "error" } }
    ],
    "should": [
      { "key": "severity", "match": { "value": "high" } },
      { "key": "severity", "match": { "value": "critical" } }
    ],
    "must_not": [
      { "key": "resolved", "match": { "value": true } }
    ]
  }
}
```

## Integration

### MCP Config

```json
{
  "qdrant": {
    "command": "node",
    "args": ["/app/mcp-servers/qdrant-mcp/dist/index.js"],
    "env": {
      "QDRANT_URL": "${QDRANT_URL}"
    },
    "description": "Qdrant vector database for semantic search"
  }
}
```

### With Embeddings

Combine with Ollama for embeddings:

1. Generate embedding: `ollama embeddings bge-m3 "your text"`
2. Search: `qdrant_search({ collection: "docs", vector: embedding })`

## References

- [Qdrant API Reference](https://api.qdrant.tech/api-reference)
- [Qdrant Points Documentation](https://qdrant.tech/documentation/concepts/points/)
- [Qdrant Filtering](https://qdrant.tech/documentation/concepts/filtering/)
