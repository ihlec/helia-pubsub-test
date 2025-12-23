import { createHelia } from 'helia'
import { floodsub } from '@libp2p/floodsub'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { multiaddr } from '@multiformats/multiaddr'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { strings } from '@helia/strings'

// 🟢 CONFIGURATION (UPDATE ID)
const RELAY_PEER_ID = '12D3KooWQKA8r2zGHY1rbfvwwscNDn8Gk1n7qPvrBAyzEu8RogRF'; 
const RELAY_ADDR = `/ip4/127.0.0.1/tcp/4003/ws/p2p/${RELAY_PEER_ID}`;

const NEGOTIATION_TOPIC = 'storage-negotiation-v1';
const PRESENCE_TOPIC = 'helia-presence-v1';

let helia;
let heliaStrings;
let myName = "";
let myPeerIdStr = "";

const allowAll = () => true

async function startHelia(userName) {
    myName = userName;
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Generating Identity...';

    const tempHelia = await createHelia({ blockstore: new MemoryBlockstore(), datastore: new MemoryDatastore(), libp2p: { addresses: { listen: [] } } });
    const myPeerId = tempHelia.libp2p.peerId;
    myPeerIdStr = myPeerId.toString();
    await tempHelia.stop();

    document.getElementById('node-id').textContent = myPeerIdStr;
    document.getElementById('user-name').textContent = userName;

    helia = await createHelia({ 
        blockstore: new MemoryBlockstore(),
        datastore: new MemoryDatastore(),
        libp2p: {
            peerId: myPeerId,
            connectionGater: { denyDialMultiaddr: () => false },
            addresses: { 
                listen: ['/webrtc'],
                announce: [`${RELAY_ADDR}/p2p-circuit/p2p/${myPeerIdStr}`]
            },
            transports: [ webSockets({ filter: allowAll }), webRTC(), circuitRelayTransport({ discoverRelays: 1, reservationFilter: allowAll }) ],
            connectionEncrypters: [ noise() ],
            streamMuxers: [ yamux() ],
            peerDiscovery: [ bootstrap({ list: [ RELAY_ADDR ] }), pubsubPeerDiscovery({ interval: 1000, topics: [PRESENCE_TOPIC] }) ],
            services: { 
                identify: identify(), 
                autoNAT: autoNAT(), 
                pubsub: floodsub({ strictSigning: false }) 
            }
        }
    });
    heliaStrings = strings(helia);
    window.helia = helia;

    statusEl.textContent = 'Connecting to Relay...';
    
    try {
        console.log("☎️ Dialing Relay:", RELAY_ADDR);
        await helia.libp2p.dial(multiaddr(RELAY_ADDR));
        console.log("✅ Connected!");

        statusEl.textContent = 'Negotiating Access...';
        await performPubSubHandshake();

        statusEl.textContent = 'Online 🟢';
        setupChat();

    } catch (e) {
        console.error("❌ Failed:", e);
        statusEl.textContent = 'Error 🔴';
        alert(e.message);
    }
}

async function performPubSubHandshake() {
    return new Promise(async (resolve, reject) => {
        const pubsub = helia.libp2p.services.pubsub;
        pubsub.subscribe(NEGOTIATION_TOPIC);
        
        let solved = false;

        // 1. Wait for Mesh
        appendSystemMessage("⏳ Waiting for Relay to join Negotiation Channel...");
        const waitForPeers = setInterval(async () => {
            const peers = pubsub.getPeers(NEGOTIATION_TOPIC);
            if (peers.length > 0) {
                clearInterval(waitForPeers);
                console.log("✅ Relay Found in Negotiation Channel!");
                startNegotiation();
            } else {
                console.log("🔍 Looking for peers...");
            }
        }, 1000);

        // 2. Start Negotiation
        const startNegotiation = async () => {
            appendSystemMessage("👮 Relay: 'Storage Payment Required. Requesting Work...'");
            
            // Retry loop
            const retryInterval = setInterval(async () => {
                if(solved) { clearInterval(retryInterval); return; }
                console.log("🔄 Sending Work Request...");
                const req = { type: 'REQUEST_WORK' };
                await pubsub.publish(NEGOTIATION_TOPIC, fromString(JSON.stringify(req)));
            }, 2000);
            
            const req = { type: 'REQUEST_WORK' };
            await pubsub.publish(NEGOTIATION_TOPIC, fromString(JSON.stringify(req)));
        };

        // 3. DEBUG MSG HANDLER (Logs EVERYTHING)
        const handleMsg = async (evt) => {
            if (evt.detail.topic !== NEGOTIATION_TOPIC) return;
            const msgStr = toString(evt.detail.data);
            console.log("📦 RAW INCOMING:", msgStr); // <--- DEBUG LOG

            const msg = JSON.parse(msgStr);
            
            // 🟢 DEBUG: Removed ID check to see if we get ANY reply
            // if (msg.target !== myPeerIdStr) return; 

            console.log("📩 Negotiation Msg Type:", msg.type);

            if (msg.type === 'ASSIGNMENT') {
                if (solved) return; // Prevent loop
                appendSystemMessage(`📦 Relay assigned ${msg.cids.length} chunks.`);
                const req = { type: 'FETCH_DATA', cid: msg.cids[0] };
                await pubsub.publish(NEGOTIATION_TOPIC, fromString(JSON.stringify(req)));
            }

            if (msg.type === 'DATA_DELIVERY') {
                await heliaStrings.add(msg.content);
                appendSystemMessage(`✅ Data Mirrored: ${msg.cid.slice(0,6)}...`);
                const proof = { type: 'SUBMIT_PROOF', cid: msg.cid, content: msg.content };
                await pubsub.publish(NEGOTIATION_TOPIC, fromString(JSON.stringify(proof)));
            }

            if (msg.type === 'ACCESS_GRANTED') {
                if(solved) return;
                solved = true;
                appendSystemMessage(`🎉 ACCESS GRANTED.`);
                pubsub.removeEventListener('message', handleMsg);
                resolve(true);
            }
        };

        pubsub.addEventListener('message', handleMsg);
    });
}

function setupChat() {
    const pubsub = helia.libp2p.services.pubsub;
    pubsub.subscribe(PRESENCE_TOPIC);

    pubsub.addEventListener('message', (evt) => {
        if (evt.detail.topic !== PRESENCE_TOPIC) return;
        try {
            const payload = JSON.parse(toString(evt.detail.data));
            if (payload.from === myPeerIdStr) return;
            if (payload.type === 'chat') appendChatMessage(payload.name, payload.text, false);
        } catch(e) {}
    });

    setInterval(() => {
        const msg = JSON.stringify({ type: 'heartbeat', from: myPeerIdStr });
        pubsub.publish(PRESENCE_TOPIC, fromString(msg)).catch(()=>{});
    }, 2000);
}

// UI Helpers (Same as before)
function appendSystemMessage(text) {
    const chatBox = document.getElementById('chat-messages');
    if (!chatBox) return;
    const div = document.createElement('div');
    div.style.padding = '5px';
    div.style.color = '#555';
    div.style.fontStyle = 'italic';
    div.style.fontSize = '0.8em';
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
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