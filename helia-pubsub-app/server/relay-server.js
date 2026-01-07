import { createLibp2p } from 'libp2p'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { yamux } from '@chainsafe/libp2p-yamux'
import { floodsub } from '@libp2p/floodsub'
import { createHelia } from 'helia'
import { strings } from '@helia/strings'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'
import os from 'os';

// Helper to find your actual LAN IP (e.g. 192.168.x.x)
function getLanIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const LAN_IP = getLanIp();
const NEGOTIATION_TOPIC = 'storage-negotiation-v1';

async function startServer() {
    console.log(`⚡ Starting Relay on LAN IP: ${LAN_IP}`);

    const relayNode = await createLibp2p({
        addresses: { 
            // 🟢 LISTEN ON ALL INTERFACES
            listen: ['/ip4/0.0.0.0/udp/4003/webrtc-direct'] 
        },
        transports: [ 
            webRTCDirect(), 
            webRTC(), 
            circuitRelayTransport()
        ],
        streamMuxers: [ yamux() ],
        services: {
            identify: identify(),
            pubsub: floodsub({ emitSelf: true, strictSigning: false }), 
            relay: circuitRelayServer({
                reservations: { maxReservations: 100000, applyDefaultLimit: false }
            })
        }
    });

    // ... (Keep your existing PubSub/Helia logic here) ...
    
    // Logic to confirm server is ready
    console.log(`🚀 Relay Online!`);
    
    // Filter to find the address with the correct LAN IP
    const multiaddrs = relayNode.getMultiaddrs().map(ma => ma.toString());
    const bestAddr = multiaddrs.find(a => a.includes(LAN_IP));

    console.log(`\n📋 COPY THIS ADDRESS TO MAIN.JS:`);
    console.log(`-----------------------------------------------------------`);
    console.log(bestAddr); 
    console.log(`-----------------------------------------------------------`);
}

startServer();