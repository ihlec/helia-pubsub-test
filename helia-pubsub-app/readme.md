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
- WS only right now, no WSS (needs DNS name)
- create data incentive for relays
- relays should mirror pinnes of user State
- relays should require clients to pinn 10 random cids of the relays choice
- browser clients need to provide one random chunk of a CID every time they interact with the relay. 
- failing to provide a chunk will get the browser clients cut off


### Data Incentive Concept 
Next thing I want to do is gatekeeping the relay access with an incentive. So the relay should have the numbers 1 to 100 stored as a CID. Every connecting browser must download a subset of CIDs to their storage and mirror them. The relay decides on 10 random CIDs that it assigns to the connecting browser. Every  interaction after initiated by the browser needs to include a chunk of one of the CIDs content. Again decided by the relay which at random which one it would be. This way the relay can outsource its redundancy and backup needs to the connecting browsers, while the connecting browsers gain connectivity. 

the topic thoes not need to be secret. Anyone one could join it. The clue is that browser nodes cannot join it without a relay, due to their NAT conditions. Therefore the browser needs the relay service. The relay on the other hand does not want to provide this service for free and therefore sets a price on relay usage, and the price is proof of storage.