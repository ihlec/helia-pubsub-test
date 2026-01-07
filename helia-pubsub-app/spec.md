
# 1. System Architecture

The system consists of two primary components communicating over a private Libp2p network.

### A. The Smart Relay (Server)
d
* **Role:** Acts as the network gatekeeper and central relay. It maintains a "Data Bank" of content and only relays traffic for peers who successfully prove they have mirrored specific data chunks.
* **Transport:** WebSockets (`/ws`)
* **Muxer:** Yamux (standardized for stability)
* **Security:** Noise encryption, but with **Permissive Signing** enabled to allow browser compatibility.

### B. The Client (Browser)

* **Runtime:** Browser (Vite/React/Vue/Vanilla JS)
* **Library:** Helia (IPFS implementation for JS)
* **Role:** Connects to the Relay, negotiates access via PubSub, downloads assigned data, submits proof, and then gains access to the global chat mesh.

---

# 2. The Protocol: "PubSub Handshake"

Due to browser compatibility issues with raw streams (`it-pipe`), this system uses a **PubSub-based Negotiation Protocol** running on a dedicated topic.

**Topic Name:** `storage-negotiation-v1`

### Sequence Diagram

1. **Discovery:** Client connects to Relay and subscribes to `storage-negotiation-v1`.
2. **Request:** Client publishes `{ "type": "REQUEST_WORK" }`.
3. **Assignment:** Server observes request, selects 5 random CIDs from its Data Bank, and publishes `{ "type": "ASSIGNMENT", "target": "ClientPeerID", "cids": [...] }`.
4. **Fetch:** Client sees assignment targeting its ID. It requests data for the first CID: `{ "type": "FETCH_DATA", "cid": "..." }`.
5. **Delivery:** Server publishes the content: `{ "type": "DATA_DELIVERY", "target": "ClientPeerID", "content": "..." }`.
6. **Proof:** Client adds content to its local Helia store (mirroring) and publishes proof: `{ "type": "SUBMIT_PROOF", "cid": "...", "content": "..." }`.
7. **Access:** Server verifies content matches CID. If valid, it adds Client PeerID to the `ALLOWED_PEERS` set and publishes `{ "type": "ACCESS_GRANTED", "target": "ClientPeerID" }`.
8. **Online:** Client receives grant, unlocks UI, and joins the chat mesh (`helia-presence-v1`).

---

# 3. Component Specifications

## 3.1 Relay Server Configuration (`relay-server.js`)

**Key Configuration Rules:**

1. **Strict Signing:** Must be set to `false` in `floodsub`. This is critical. Browsers often fail strict signature verification against Node.js peers.
2. **Mesh Waiting:** The server must introduce a small artificial delay (e.g., `500ms`) before replying to a new subscriber to ensure the PubSub mesh routing table has updated.
3. **Relay Service:** Configured with high limits (`maxReservations: 100000`) to prevent disconnections during testing.

**Data Structure (The "Bank"):**
The server generates 100 random assets on startup:

```json
{
  "id": 1,
  "cid": "bafy...",
  "content": "[RELAY-ASSET-1-0.12345]"
}

```

## 3.2 Client Configuration (`main.js`)

**Key Configuration Rules:**

1. **Connection Gater:** Must explicitly allow `127.0.0.1` (`denyDialMultiaddr: () => false`) or browsers will block the local websocket connection for security.
2. **Retry Logic:** The client must implement a "Retry Loop" for the initial `REQUEST_WORK` message. In P2P meshes, the first message is often lost if the subscription hasn't propagated across the network.
3. **Filtering:** The client must filter incoming PubSub messages by checking `if (msg.target === myPeerIdStr)`.

---

# 4. JSON Payload Schemas

All messages on `storage-negotiation-v1` are JSON strings.

**Request Work (Client -> Server):**

```json
{ "type": "REQUEST_WORK" }

```

**Assignment (Server -> Client):**

```json
{
  "type": "ASSIGNMENT",
  "target": "12D3KooW...",
  "cids": ["bafy1...", "bafy2..."]
}

```

**Fetch Data (Client -> Server):**

```json
{ "type": "FETCH_DATA", "cid": "bafy1..." }

```

**Data Delivery (Server -> Client):**

```json
{
  "type": "DATA_DELIVERY",
  "target": "12D3KooW...",
  "cid": "bafy1...",
  "content": "Raw Content String"
}

```

**Submit Proof (Client -> Server):**

```json
{
  "type": "SUBMIT_PROOF",
  "cid": "bafy1...",
  "content": "Raw Content String"
}

```

**Access Granted (Server -> Client):**

```json
{ "type": "ACCESS_GRANTED", "target": "12D3KooW..." }

```

---

# 5. Future Improvements (Roadmap)

1. **Cryptographic Proof:** Currently, the proof is echoing the content. A stronger version would require the client to sign a hash of the content to prove they actually stored it, rather than just relaying the string.
2. **Persistent Identity:** Use a stored Private Key (in `localStorage` or a file) so Peer IDs do not change on every refresh/restart.
3. **Access Control List (ACL):** The server `ALLOWED_PEERS` set is currently in-memory. It should persist to a database to remember paid users across restarts.

Would you like me to implement the **Cryptographic Proof** upgrade next, or focus on the **Persistent Identity** so you don't have to keep copying Peer IDs?