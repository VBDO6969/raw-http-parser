# HTTP/1.1 Request Parser

An educational HTTP/1.1 server and request parser implemented from scratch in Node.js using the low-level `net` module, without relying on Node.js's built-in `http` module or external web frameworks. It handles raw TCP byte streams, accumulates fragmented chunks, detects header boundaries via a byte-level finite-state machine, parses request lines and header fields via lookup tables and a trie, and frames request bodies using `Content-Length`. It validates protocol syntax and answers requests having `Content-Length: 0` with a `204 No Content` response, but it lacks application response routing, chunked transfer decoding, and HTTP-level error status responses.

## Status

### Implemented
- Raw TCP server listening on port 3000 via `net.createServer`.
- Cross-chunk CRLFCRLF (`\r\n\r\n`) header boundary detection using a 4-state byte-level finite-state machine.
- Chunk accumulation buffer maintaining incoming `Buffer` references prior to header boundary identification.
- Maximum header size threshold enforcement (`MAX_HEADER_BYTES = 8192` bytes) protecting against Slowloris-style header bloat.
- Request-method parsing for `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` using a generated nested-switch prefix trie.
- Origin-form request-target validation (`/path`) using a 256-entry lookup table (`ALLOWED_TARGET_BYTES`).
- HTTP version parsing and validation for `HTTP/1.0` and `HTTP/1.1` (`parseVersion`).
- Header field-name token grammar validation using a 256-entry lookup table (`ALLOWED_FIELD_KEY_BYTES`), with lowercase normalization.
- Strict colon syntax verification rejecting leading whitespace before the header colon (RFC 9112 §5.1).
- Header field-value parsing with single-pass stripping of leading and trailing optional whitespace (SP and HTAB) via a 3-way byte lookup table (`ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS`).
- Duplicate header rejection via `Object.hasOwn` checks.
- Mandatory `Host` header enforcement on `HTTP/1.1` requests (RFC 9112 §3.2).
- Mutual exclusivity enforcement between `Transfer-Encoding` and `Content-Length`, destroying connections containing both (RFC 9112 §6.1, §6.3).
- Rejection of `Transfer-Encoding` on `HTTP/1.0` requests.
- Numerical validation of `Content-Length` via `/^\d+$/` and maximum body limit verification (`MAX_BODY_BYTES = 10485760` bytes).
- Immediate `HTTP/1.1 204 No Content\r\n\r\n` response and state reset for requests specifying `Content-Length: 0`.
- Body assembly across single or multiple TCP chunks for requests with `Content-Length > 0`, logging the completed `Buffer` payload to stdout.
- Zero-copy slicing of leftover bytes across message boundaries using `Buffer.subarray`.

### Not implemented / known limitations
- `Transfer-Encoding: chunked` body parsing: The execution branch exists as a code stub and does not decode chunk-encoded streams.
- Other transfer codings: Codings such as `gzip`, `deflate`, or `compress` are unhandled.
- Real HTTP response generation: The server only emits an HTTP response (`204 No Content`) when `Content-Length` is explicitly `0`. Requests with bodies (`Content-Length > 0`) or requests without bodies (such as standard `GET` requests) do not receive an HTTP response; payloads are logged to the console while the client connection remains open.
- HTTP error responses: Protocol syntax violations, invalid methods, malformed versions, missing `Host` headers, duplicate headers, or exceeded size limits immediately invoke `socket.destroy()` (often issuing a TCP RST) rather than returning formatted HTTP 4xx or 5xx responses (such as `400 Bad Request`, `414 URI Too Long`, `431 Request Header Fields Too Large`, `411 Length Required`, or `505 HTTP Version Not Supported`).
- HTTP pipelining: When residual bytes belonging to a subsequent request arrive in the same TCP chunk, they are preserved in `chunksArr`, but the parser does not loop within the active event tick to parse the next request. Processing remains suspended until the next socket `data` event fires.
- Request state lifecycle: The `req` object is scoped to the socket connection closure and only reallocates upon encountering a new header. It is not cleared when payload assembly completes, causing properties like `req.payload` to persist until the next header parse. Requests lacking both `Content-Length` and `Transfer-Encoding` reset internal buffer pointers but return no response.
- HTTP method coverage: Only five methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) are recognized. Other standard RFC methods (`HEAD`, `OPTIONS`, `CONNECT`, `TRACE`) trigger immediate socket destruction.
- URI request target forms: Only origin-form targets beginning with `/` are accepted. Asterisk-form (`*`), absolute-form (`http://...`), and authority-form URIs trigger connection teardown.
- Obsolete line folding (obs-fold): Multiline headers containing leading whitespace on continuation lines are rejected (aligned with RFC 9112 §5.2).
- Stream backpressure: Chunks are continuously accumulated in memory without invoking `socket.pause()` or coordinating with stream drain events.

## How to run

Start the server using Node.js:

```bash
node buffer.js
```

The server binds to port 3000 and outputs:
```
server is listening on port 3000!!
```

### Sending a POST request with a payload

Send a request containing a binary payload using `curl`:

```bash
curl -v -X POST http://localhost:3000/submit \
  -H "Host: localhost:3000" \
  -H "Content-Type: text/plain" \
  --data-binary "Sample payload data"
```

The server accumulates the body chunks, concatenates the payload, and logs the resulting `Buffer` to stdout. Because response generation is not implemented for requests with non-zero payloads, `curl` will wait for a response until terminated.

### Testing an empty POST request

To observe the server's implemented HTTP response (`204 No Content`), send a request with `Content-Length: 0`:

```bash
curl -v -X POST http://localhost:3000/empty \
  -H "Host: localhost:3000" \
  -H "Content-Length: 0"
```

Expected output includes:
```
< HTTP/1.1 204 No Content
```

## What I built

The request processing pipeline executes across the following phases:

1. **Socket `data` events**: The server initializes a TCP listener via `net.createServer` (`buffer.js`, lines 26–269). Each network segment delivered to user space triggers a `data` event on the client socket, providing a `Buffer` chunk.
2. **Chunk accumulation**: Incoming chunks are pushed into `chunksArr` (`buffer.js`, line 42), and their byte counts are added to `totalBytes` (`buffer.js`, line 43). This preserves chunk references without copying data.
3. **Header-end detection**: While `isHeaderFound` remains `false`, the chunk is scanned byte-by-byte using a 4-state finite-state machine looking for `\r\n\r\n` (`buffer.js`, lines 46–63). Upon reaching the final state, `absoluteLastCRLFCRLFByte` is computed, trailing bytes are sliced into `unknownEntity` via zero-copy `Buffer.subarray` (`buffer.js`, line 58), the header chunks are concatenated into a unified `header` Buffer (`buffer.js`, line 59), and `isHeaderFound` is marked `true`.
4. **Request-line parsing**:
   - The method is parsed by `imported.parseMethod` (`generated-parser.js`, lines 1–165; called in `buffer.js`, line 75) using a byte-level switch trie.
   - The request target is checked for a leading `/` (`buffer.js`, line 78) and scanned until an ASCII space (`0x20`), validating each byte against `ALLOWED_TARGET_BYTES` (`buffer.js`, lines 82–90).
   - The HTTP version is parsed by `imported.parseVersion` (`generated-parser.js`, lines 167–206; called in `buffer.js`, line 98), confirming `HTTP/1.0` or `HTTP/1.1` followed by `\r\n`.
5. **Header-field parsing**: The server iterates through remaining header bytes until `absoluteLastCRLFCRLFByte - 1` (`buffer.js`, lines 101–142):
   - Field names are validated against `ALLOWED_FIELD_KEY_BYTES` (`buffer.js`, lines 104–106).
   - The colon character (`0x3A`) must directly follow the key; preceding whitespace triggers socket destruction (`buffer.js`, lines 107–113). Keys are normalized to lowercase.
   - Leading optional whitespace is skipped via `ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS` (`buffer.js`, lines 115–117).
   - Value bytes are scanned and trailing whitespace is trimmed using the 3-value lookup scheme (`buffer.js`, lines 119–130).
   - Each field line must end with `\r\n`. Duplicate header names trigger immediate connection teardown via `Object.hasOwn` (`buffer.js`, lines 132–135).
6. **Body framing by Content-Length**:
   - For `HTTP/1.1`, the presence of a `Host` header is verified (`buffer.js`, lines 143–146).
   - Requests containing both `Transfer-Encoding` and `Content-Length`, or `Transfer-Encoding` on `HTTP/1.0`, are rejected (`buffer.js`, lines 147–154).
   - If `Content-Length` is present, it is validated for digits (`/^\d+$/`) and parsed (`buffer.js`, lines 162–163).
   - When `Content-Length === 0`, the server transmits `HTTP/1.1 204 No Content\r\n\r\n` and resets parser variables (`buffer.js`, lines 170–179).
   - When `Content-Length > 0`, the parser sets `header = undefined` to transition to payload assembly mode (`buffer.js`, line 182) and consumes available bytes from `unknownEntity` (`buffer.js`, lines 183–206).
   - Subsequent `data` events append incoming chunks directly to `payloadArr` until `expectedPayloadLength` reaches 0 (`buffer.js`, lines 228–254).
7. **Size limits**: The cumulative header size is compared against `MAX_HEADER_BYTES` (8192 bytes) during chunk arrival and boundary detection (`buffer.js`, lines 54–57, 66–68). The payload size is compared against `MAX_BODY_BYTES` (10485760 bytes) before allocating body buffers (`buffer.js`, lines 165–168). Violations destroy the socket.
8. **State reset**: Upon completing payload assembly or handling a zero-length request, parsing flags (`isHeaderFound`, `state`, `expectedPayloadLength`, `absoluteLastCRLFCRLFByte`, `payloadArr`) are cleared. Surplus bytes past the payload boundary are sliced into `chunksArr` via `Buffer.subarray` for subsequent processing (`buffer.js`, lines 198, 246).

## Algorithms and data structures

### Byte-level finite-state machine for CRLFCRLF detection
- **What it is**: A deterministic 4-state automaton tracking sequential occurrences of Carriage Return (`\r`, `0x0D`) and Line Feed (`\n`, `0x0A`).
- **Where it is**: `buffer.js`, lines 47–63.
- **Why it was chosen**: TCP segment boundaries do not align with HTTP delimiters; the delimiter `\r\n\r\n` can split across consecutive packets (e.g., `\r\n\r` in one chunk, `\n` in the next). The FSM maintains matching state across chunk boundaries without concatenating buffers prematurely or rescanning previously processed bytes.

### 256-entry Uint8Array lookup tables for byte classification
- **What it is**: Flat direct-indexed byte arrays (`Uint8Array(256)`) mapping byte values (0–255) to character classification categories.
- **Where it is**: `buffer.js`, lines 4–24 (`ALLOWED_TARGET_BYTES`, `ALLOWED_FIELD_KEY_BYTES`, `ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS`).
- **Why it was chosen**: Direct array indexing provides O(1) byte classification with zero regular expression overhead and predictable branch execution. The 3-way scheme in `ALLOWED_FIELD_VALUE_BYTES_AND_SKIPPING_SP_AND_OWS` (0 = delimiter/invalid, 1 = visible characters/obs-text, 2 = whitespace SP/HTAB) enables single-pass scanning and clean trimming of leading and trailing optional whitespace (OWS) without backtracking or substring allocations.

### Nested-switch trie for method matching
- **What it is**: A character prefix tree (trie) compiled into nested JavaScript `switch` statements matching method bytes sequentially.
- **Where it is**: `generated-parser.js`, lines 4–161 (generated by `methodGenerator.js`, lines 6–54).
- **Why it was chosen**: Matches valid methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) in O(L) time where L is the token length. It avoids string allocations, regex execution, and hash lookups on raw byte streams, destroying the socket immediately upon the first invalid character.

### Pointer-based parsing over a single Buffer
- **What it is**: Cursor-driven traversal using integer index offsets (`req.pointer`) directly across raw memory buffers.
- **Where it is**: `buffer.js`, lines 78–142, and `generated-parser.js`, lines 1–205.
- **Why it was chosen**: Validates protocol grammar directly against binary memory, avoiding intermediary V8 heap string allocations until syntactic tokens are validated.

### Buffer.subarray zero-copy slicing vs. Buffer.concat copying
- **What it is**: Offset-based TypedArray view creation (`Buffer.subarray`) versus contiguous heap memory reallocation and copying (`Buffer.concat`).
- **Where it is**: `buffer.js`, lines 58, 59, 188, 197–198, 234, 244–246.
- **Why it was chosen**: `Buffer.subarray` creates a lightweight wrapper pointing to existing memory without copying bytes, used for extracting pipelined residuals (`unknownEntity`) and framing payload boundaries. `Buffer.concat` is executed only when complete segments (the full header block or full body) must be assembled into a single contiguous buffer for consumption.

### Array of chunk references as accumulation buffer
- **What it is**: An in-memory JavaScript array (`chunksArr`) appending references to incoming `Buffer` instances.
- **Where it is**: `buffer.js`, lines 29, 42.
- **Why it was chosen**: Appending references to an array is an O(1) operation. Progressively concatenating buffers on every incoming TCP segment would cause quadratic O(N^2) memory reallocation and excessive garbage collection overhead.

### Header-size and body-size limits as DoS protection
- **What it is**: Hard thresholds on cumulative header bytes (`MAX_HEADER_BYTES = 8192` bytes) and declared payload size (`MAX_BODY_BYTES = 10485760` bytes).
- **Where it is**: `buffer.js`, lines 33–34, 54–57, 66–68, 165–168.
- **Why it was chosen**: Protects against Slowloris attacks and process out-of-memory crashes by terminating connections that stream indefinite header bytes or declare excessively large payloads before memory is allocated.

### Duplicate-header rejection
- **What it is**: Single-definition validation enforced via `Object.hasOwn(req.headers, currentKey)`.
- **Where it is**: `buffer.js`, lines 132–135.
- **Why it was chosen**: Mitigates HTTP request smuggling, cache poisoning, and parameter injection vulnerabilities caused by ambiguous duplicate header handling across proxies and origin servers.

### Host-header requirement for HTTP/1.1
- **What it is**: Verification that `req.headers['host']` is present on all HTTP/1.1 requests.
- **Where it is**: `buffer.js`, lines 143–146.
- **Why it was chosen**: Enforces RFC 9112 §3.2 and RFC 9110 §7.2, which require a `Host` header field in all HTTP/1.1 request messages to identify the target resource in shared/virtual hosting environments.

### Rejecting Transfer-Encoding + Content-Length together
- **What it is**: Mutual exclusivity check between `transfer-encoding` and `content-length` headers, and rejection of `transfer-encoding` in HTTP/1.0.
- **Where it is**: `buffer.js`, lines 147–154.
- **Why it was chosen**: Conforms to RFC 9112 §6.1 and §6.3. Disallowing both headers in the same request prevents desynchronization vulnerabilities (CL.TE and TE.CL smuggling attacks).

## Design notes

### Why TCP chunks are not HTTP messages
TCP is a byte-stream transport protocol operating at Layer 4. It guarantees ordered, reliable byte delivery, but possesses no architectural awareness of application-layer message boundaries, HTTP headers, or request framing. Packets are subject to Maximum Segment Size (MSS) segmentation, network fragmentation, operating system socket receive buffering, and transport-level batching algorithms (such as Nagle's algorithm). A single logical HTTP request may arrive fragmented across multiple `data` events, or multiple requests may arrive coalesced within a single TCP chunk. Application-layer parsers must therefore maintain explicit boundary-detection state across packet boundaries.

### Why limits are enforced server-side
Client-controlled signals—such as TCP FIN packets or application-level `Content-Length` headers—cannot be trusted for resource management. A misbehaved or malicious client can withhold a connection close signal or stream unbounded bytes without headers. If a server buffers incoming chunks indefinitely while awaiting a client-provided delimiter, process memory will expand unchecked, triggering out-of-memory (OOM) process termination. The server must measure received bytes per-connection and enforce limits proactively.

### Why the header limit and body limit are separate
Headers represent untrusted protocol metadata that must be buffered and parsed into memory structures before routing, authentication, or handler dispatch can take place. Because this occurs for every connection regardless of authentication, header limits are kept strict and small (8 KB) to minimize memory exposure to untrusted peers. In contrast, request bodies carry application payloads (such as file uploads) that legitimately require megabytes of storage. Separating the two thresholds allows generous payload capacity while maintaining defense against header-flooding and Slowloris attacks.

## Source files

| File | Purpose |
| :--- | :--- |
| `buffer.js` | Main server script. Implements raw TCP listener, chunk accumulation, CRLFCRLF FSM, request-line and header parsing, Content-Length body framing, DoS size limits, and connection lifecycle management. |
| `generated-parser.js` | Parser helper module. Contains `parseMethod` (nested switch trie for matching GET, POST, PUT, PATCH, DELETE) and `parseVersion` (byte validation for HTTP/1.0 and HTTP/1.1). |
| `methodGenerator.js` | Code generation utility. Constructs a prefix trie for supported HTTP methods and writes out the optimized nested-switch logic in `generated-parser.js`. |

## References

- [RFC 9112 §2.1: Client/Server Messaging](https://www.rfc-editor.org/rfc/rfc9112#section-2.1)
- [RFC 9112 §2.2: Message Format and Framing](https://www.rfc-editor.org/rfc/rfc9112#section-2.2)
- [RFC 9112 §3: Request Line](https://www.rfc-editor.org/rfc/rfc9112#section-3)
- [RFC 9112 §3.2: Reconstructing the Target URI and Host Requirement](https://www.rfc-editor.org/rfc/rfc9112#section-3.2)
- [RFC 9112 §5.1: Field Line Syntax](https://www.rfc-editor.org/rfc/rfc9112#section-5.1)
- [RFC 9112 §5.2: Obsolete Line Folding](https://www.rfc-editor.org/rfc/rfc9112#section-5.2)
- [RFC 9112 §6.1: Transfer-Encoding](https://www.rfc-editor.org/rfc/rfc9112#section-6.1)
- [RFC 9112 §6.3: Message Body Length](https://www.rfc-editor.org/rfc/rfc9112#section-6.3)
- [RFC 9110 §5.5: Field Values and Optional Whitespace](https://www.rfc-editor.org/rfc/rfc9110#section-5.5)
- [RFC 9110 §5.6.2: Tokens and Field Names](https://www.rfc-editor.org/rfc/rfc9110#section-5.6.2)
- [RFC 9110 §7.2: Host Header Semantics](https://www.rfc-editor.org/rfc/rfc9110#section-7.2)
- [RFC 9110 §8.6: Content-Length Semantics](https://www.rfc-editor.org/rfc/rfc9110#section-8.6)
- [Node.js `net` Module Documentation](https://nodejs.org/api/net.html)
- [Node.js `Buffer` Module Documentation](https://nodejs.org/api/buffer.html)
