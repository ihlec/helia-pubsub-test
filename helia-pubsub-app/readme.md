## Minimal Helia PubSub Demo

The application allows multiple browser instances to find each other via the public IPFS/libp2p network and exchange presence messages.

### Setup and Installation

**Install dependencies:**
```bash
npm install

```

### Running the ApplicationThis application is built with Vite.

```bash
npm run dev

```

The application will be accessible at `http://localhost:5173/`.

### How It Works 
1. **Node Initialization:** The application creates a Helia node with the minimum necessary configuration for browser compatibility.
2. **Transports and Connectivity:** The node uses **WebSockets** and **WebRTC** to communicate. It connects to the global **Bootstrap Nodes** for initial discovery and utilizes the **Circuit Relay** service to connect peers that are behind firewalls or Network Address Translators (NATs).
3. **PubSub Messaging:** The node subscribes to the `online-users-channel` and uses **GossipSub** to announce its presence every 30 seconds.

To test, open the application in **two browser tabs/windows**. After starting both nodes, they will automatically attempt to discover each other via the public network, and messages will appear in the UI once the connection is established.

| Component | Role |
| --- | --- |
| **`webSockets`** | Transport for connecting to the public network (WSS). |
| **`webRTC`** | Transport for direct browser-to-browser connections. |
| **`bootstrap`** | Peer Discovery mechanism using known public addresses. |
| **`circuitRelayTransport`** | Service that enables connection through a third-party relay node (essential for NAT traversal). |
| **`gossipsub`** | The protocol used for broadcasting messages to the subscribed channel. |

### Known Issues:
- Failed to reach nodes under browser NAT conditions.
- host own relays
- relays should mirror pinnes of user State
- relays should require clients to pinn 10 random cids of the relays choice
- browser clients need to provide one random CID every 30min or they get cut off. 
- non pinning browser clients should get cut of