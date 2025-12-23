import { createLibp2p } from 'libp2p'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { floodsub } from '@libp2p/floodsub'
import { createHelia } from 'helia'
import { strings } from '@helia/strings'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'

const NEGOTIATION_TOPIC = 'storage-negotiation-v1';
const ALLOWED_PEERS = new Set(); 
const DATA_LIBRARY = [];

async function startServer() {
    console.log("⚡ Starting Relay (Robust PubSub Mode)...");

    const helia = await createHelia({ blockstore: new MemoryBlockstore(), datastore: new MemoryDatastore() });
    const heliaStrings = strings(helia);

    for (let i = 1; i <= 100; i++) {
        const content = `[RELAY-ASSET-${i}-${Math.random()}]`; 
        const cid = await heliaStrings.add(content);
        DATA_LIBRARY.push({ id: i, cid: cid.toString(), content: content });
    }

    const relayNode = await createLibp2p({
        addresses: { listen: ['/ip4/0.0.0.0/tcp/4003/ws'] },
        transports: [ webSockets() ],
        connectionEncrypters: [ noise() ],
        streamMuxers: [ yamux() ],
        services: {
            identify: identify(),
            pubsub: floodsub({ emitSelf: true, strictSigning: false }), 
            relay: circuitRelayServer({
                reservations: { maxReservations: 100000, applyDefaultLimit: false }
            })
        }
    });

    relayNode.services.pubsub.subscribe(NEGOTIATION_TOPIC);
    
    relayNode.services.pubsub.addEventListener('message', async (evt) => {
        if (evt.detail.topic !== NEGOTIATION_TOPIC) return;
        
        const msgStr = toString(evt.detail.data);
        const fromPeer = evt.detail.from.toString();
        
        if (fromPeer === relayNode.peerId.toString()) return;

        try {
            const req = JSON.parse(msgStr);
            console.log(`📩 Msg from ${fromPeer.slice(-6)}: ${req.type}`);

            // 🟢 CRITICAL FIX: Wait for mesh to settle before replying
            await new Promise(r => setTimeout(r, 500));

            // Check if we actually see subscribers
            const subs = relayNode.services.pubsub.getPeers(NEGOTIATION_TOPIC);
            console.log(`   ↳ Broadcasting reply to ${subs.length} subscribers...`);

            if (req.type === 'REQUEST_WORK') {
                const assignments = DATA_LIBRARY.slice(0, 5).map(d => d.cid);
                const reply = { type: 'ASSIGNMENT', target: fromPeer, cids: assignments };
                await relayNode.services.pubsub.publish(NEGOTIATION_TOPIC, fromString(JSON.stringify(reply)));
            }

            if (req.type === 'FETCH_DATA') {
                const item = DATA_LIBRARY.find(d => d.cid === req.cid);
                if (item) {
                    const reply = { type: 'DATA_DELIVERY', target: fromPeer, cid: req.cid, content: item.content };
                    await relayNode.services.pubsub.publish(NEGOTIATION_TOPIC, fromString(JSON.stringify(reply)));
                }
            }

            if (req.type === 'SUBMIT_PROOF') {
                const item = DATA_LIBRARY.find(d => d.cid === req.cid);
                if (item && item.content === req.content) {
                    console.log(`✅ Access Granted to ${fromPeer.slice(-6)}`);
                    ALLOWED_PEERS.add(fromPeer);
                    const reply = { type: 'ACCESS_GRANTED', target: fromPeer };
                    await relayNode.services.pubsub.publish(NEGOTIATION_TOPIC, fromString(JSON.stringify(reply)));
                }
            }

        } catch (e) { console.error("Bad Msg:", e); }
    });

    relayNode.services.pubsub.subscribe('helia-presence-v1');

    console.log(`🚀 Relay running on: ${relayNode.getMultiaddrs()[0]}`);
    console.log(`🆔 Peer ID: ${relayNode.peerId}`);
}

startServer();