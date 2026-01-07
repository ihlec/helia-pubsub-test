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
import { kadDHT } from '@libp2p/kad-dht'
import { ipns } from '@helia/ipns'
import { ping } from '@libp2p/ping' 
import { strings } from '@helia/strings'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'

// Crypto Imports
import { generateKeyPair, privateKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'

// --- CONFIGURATION ---
const PRESENCE_TOPIC = 'helia-public-chat-v1';
const BOOTSTRAP_NODES = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt'
];

let helia, heliaIpns, heliaStrings, myName = "", myPeerIdStr = "";

// --- HELPER: IDENTITY MANAGEMENT ---
async function getOrCreateIdentity() {
    const STORAGE_KEY = 'helia_node_seed_v1';
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
        console.log("🔑 Loading saved identity...");
        const bytes = fromString(stored, 'base64');
        return await privateKeyFromRaw(bytes);
    } else {
        console.log("🔑 Generating NEW identity...");
        const key = await generateKeyPair('Ed25519');
        // Save the raw seed (32 bytes)
        const bytes = key.raw; 
        localStorage.setItem(STORAGE_KEY, toString(bytes, 'base64'));
        return key;
    }
}

// --- HELPER: MOCK KEYCHAIN FACTORY ---
// 🟢 FIX: Removed the extra "() =>" wrapper here. 
// Now it correctly returns the service object when Libp2p calls it.
const createMockKeychain = (privateKey) => (components) => {
    const peerIdStr = peerIdFromPrivateKey(privateKey).toString();
    const keyRecord = { name: 'self', id: peerIdStr };
    
    return {
        findKeyById: async () => keyRecord,
        findKeyByName: async () => keyRecord,
        exportKey: async () => privateKey,
        importKey: async () => keyRecord,
        listKeys: async () => [keyRecord],
        createKey: async () => keyRecord,
        removeKey: async () => {},
        renameKey: async () => {},
        rotateKeychainPass: async () => {}
    };
};

// --- MAIN STARTUP ---
async function startHelia(userName) {
    myName = userName;
    const statusEl = document.getElementById('status');
    
    // 1. Setup Identity
    statusEl.textContent = 'Loading Identity...';
    const privateKey = await getOrCreateIdentity();
    
    // 2. Initialize Libp2p
    statusEl.textContent = 'Initializing Node...';
    const libp2pNode = await createLibp2p({
        privateKey: privateKey,
        addresses: { listen: [], announce: [] },
        transports: [
            webTransport(),
            webSockets(),
            circuitRelayTransport({ discoverRelays: 1, reservationFilter: () => true })
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
            ping: ping(),
            keychain: createMockKeychain(privateKey), 
            pubsub: gossipsub({ emitSelf: true, allowPublishToZeroPeers: true }),
            dht: kadDHT({ clientMode: true, protocol: '/ipfs/kad/1.0.0' })
        }
    });

    // 3. Initialize Helia
    statusEl.textContent = 'Starting Helia...';
    helia = await createHelia({
        blockstore: new MemoryBlockstore(),
        datastore: new MemoryDatastore(),
        libp2p: libp2pNode
    });

    // 4. Setup Services
    heliaIpns = ipns(helia);
    heliaStrings = strings(helia);
    window.helia = helia;
    myPeerIdStr = libp2pNode.peerId.toString();

    // 5. Update UI
    document.getElementById('node-id').textContent = myPeerIdStr.slice(-6);
    document.getElementById('user-name').textContent = userName;
    statusEl.textContent = 'Connecting...';
    setupChat();

    // 6. Publish IPNS Record
    publishMyName(userName);
}

// --- IPNS PUBLISHING ---
async function publishMyName(name) {
    console.log("📝 Publishing IPNS...");
    appendSystemMessage(`📝 Publishing IPNS Record...`);
    
    try {
        const contentCid = await heliaStrings.add(JSON.stringify({ 
            name: name, 
            timestamp: Date.now() 
        }));
        
        console.log(`📦 Content CID: ${contentCid.toString()}`);
        console.log(`🚀 Publishing to /ipns/${helia.libp2p.peerId.toString()}`);
        
        
        
        await heliaIpns.publish(helia.libp2p.peerId, contentCid);
        
        console.log("✅ IPNS Publish Success!");
        appendSystemMessage(`✅ Published! Your ID is permanent.`);
    } catch (e) {
        console.error("IPNS Error:", e);
        appendSystemMessage(`⚠️ Publish Error: ${e.message}`);
    }
}

// --- CHAT & UI HANDLERS ---
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

    // Heartbeat to keep connections alive
    setInterval(() => {
        const msg = JSON.stringify({ type: 'heartbeat', from: myPeerIdStr });
        pubsub.publish(PRESENCE_TOPIC, fromString(msg)).catch(()=>{});
    }, 4000);
}

function appendSystemMessage(text) {
    const chatBox = document.getElementById('chat-messages');
    if (!chatBox) return;
    const div = document.createElement('div');
    div.style.padding = '4px 8px';
    div.style.color = '#666';
    div.style.fontStyle = 'italic';
    div.style.fontSize = '0.85em';
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendChatMessage(sender, text, isMe) {
    const chatBox = document.getElementById('chat-messages');
    if (!chatBox) return;
    const div = document.createElement('div');
    div.style.margin = '4px 0';
    div.style.padding = '8px 12px';
    div.style.borderRadius = '8px';
    div.style.background = isMe ? '#d1e7dd' : '#f8f9fa';
    div.style.alignSelf = isMe ? 'flex-end' : 'flex-start';
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
        const input = document.getElementById('msg-input');
        if (input.value) {
            const msg = JSON.stringify({ type: 'chat', name: myName, text: input.value });
            await window.helia.libp2p.services.pubsub.publish(PRESENCE_TOPIC, fromString(msg));
            appendChatMessage("Me", input.value, true);
            input.value = '';
        }
    };
});