import { createHelia } from 'helia'
import { createLibp2p } from 'libp2p'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { strings } from '@helia/strings'

// 🟢 PUBLIC BOOTSTRAP NODES
const BOOTSTRAP_NODES = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt'
];

const PRESENCE_TOPIC = 'helia-public-chat-v1'; 

let helia;
let myName = "";
let myPeerIdStr = "";

const allowAll = () => true

async function startHelia(userName) {
    myName = userName;
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Initializing (Public Mode)...';

    // 1. Create Libp2p Node
    const libp2pNode = await createLibp2p({
        addresses: { 
            // 🟢 FIX: Empty listen array. Browsers don't listen, they dial.
            listen: [], 
            announce: [] 
        },
        transports: [ 
            webTransport(), // Primary transport for Public Nodes
            webSockets(),   // Fallback
            circuitRelayTransport({ discoverRelays: 1, reservationFilter: allowAll }) 
        ],
        connectionEncrypters: [ noise() ],
        streamMuxers: [ yamux() ],
        connectionGater: { denyDialMultiaddr: () => false },
        peerDiscovery: [ 
            bootstrap({ list: BOOTSTRAP_NODES }), 
            pubsubPeerDiscovery({ interval: 1000, topics: [PRESENCE_TOPIC] }) 
        ],
        services: { 
            identify: identify(), 
            pubsub: gossipsub({ emitSelf: true, allowPublishToZeroPeers: true }) 
        }
    });

    statusEl.textContent = 'Starting Helia...';

    helia = await createHelia({ 
        blockstore: new MemoryBlockstore(),
        datastore: new MemoryDatastore(),
        libp2p: libp2pNode 
    });
    
    window.helia = helia;
    myPeerIdStr = libp2pNode.peerId.toString();

    document.getElementById('node-id').textContent = myPeerIdStr.slice(-6); 
    document.getElementById('user-name').textContent = userName;

    statusEl.textContent = 'Connecting to Swarm...';
    
    setupChat();
    
    // Status Check
    setInterval(() => {
        const peers = helia.libp2p.getPeers();
        if(peers.length > 0) {
            statusEl.textContent = `Online (${peers.length} Peers) 🟢`;
            statusEl.style.color = "green";
        } else {
            statusEl.textContent = 'Searching for Peers... 🟡';
            statusEl.style.color = "orange";
        }
    }, 2000);
}

function setupChat() {
    const pubsub = helia.libp2p.services.pubsub;
    pubsub.subscribe(PRESENCE_TOPIC);

    pubsub.addEventListener('message', (evt) => {
        if (evt.detail.topic !== PRESENCE_TOPIC) return;
        try {
            const payload = JSON.parse(toString(evt.detail.data));
            if (payload.from === myPeerIdStr) return;
            if (payload.type === 'chat') {
                appendChatMessage(payload.name, payload.text, false);
            }
        } catch(e) {}
    });

    // Announce presence
    setInterval(() => {
        const msg = JSON.stringify({ type: 'heartbeat', from: myPeerIdStr });
        pubsub.publish(PRESENCE_TOPIC, fromString(msg)).catch(()=>{});
    }, 3000);
}

function appendChatMessage(sender, text, isMe) {
    const chatBox = document.getElementById('chat-messages'); 
    if (!chatBox) return;
    const div = document.createElement('div');
    div.style.margin = '5px';
    div.style.padding = '8px';
    div.style.borderRadius = '5px';
    div.style.background = isMe ? '#e6f3ff' : '#eee';
    div.innerHTML = `<strong>${sender}:</strong> ${text}`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('start-helia').onclick = async () => {
        const name = document.getElementById('user-name-input').value;
        if(name) await startHelia(name);
    };

    document.getElementById('send-msg-btn').onclick = async () => {
        const text = document.getElementById('msg-input').value;
        if (text) {
            const msg = JSON.stringify({ type: 'chat', name: myName, text: text });
            await window.helia.libp2p.services.pubsub.publish(PRESENCE_TOPIC, fromString(msg));
            appendChatMessage("Me", text, true);
            document.getElementById('msg-input').value = '';
        }
    };
});