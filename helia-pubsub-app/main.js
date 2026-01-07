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
// We do NOT import the real keychain anymore
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { strings } from '@helia/strings'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'

const BOOTSTRAP_NODES = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt'
];
const PRESENCE_TOPIC = 'helia-public-chat-v1'; 

let helia, heliaIpns, heliaStrings, myName = "", myPeerIdStr = "";
const allowAll = () => true;

async function startHelia(userName) {
    myName = userName;
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Generating Identity...';

    // 🟢 1. GENERATE IDENTITY IN MEMORY
    const privateKey = await generateKeyPair('Ed25519');
    const peerId = peerIdFromPrivateKey(privateKey);
    const peerIdStr = peerId.toString();
    console.log(`🔑 Generated Identity: ${peerIdStr}`);

    // 🟢 2. DEFINE THE "HOLOGRAPHIC" KEYCHAIN
    // This looks like a keychain service to Helia, but it's just a plain object.
    // It cannot fail because it has no logic!
    const mockKeychainService = () => (components) => {
        return {
            // "Do you know this ID?" -> "Yes, it's 'self'!"
            findKeyById: async (id) => {
                // Always return our one true key identity
                return { name: 'self', id: peerIdStr };
            },
            // "Do you know this name?" -> "Yes!"
            findKeyByName: async (name) => {
                return { name: 'self', id: peerIdStr };
            },
            // "Give me the private key" -> "Here it is!"
            exportKey: async (name) => {
                return privateKey;
            },
            // "Save this key" -> "Sure! (Does nothing)"
            importKey: async (name, key) => {
                return { name: 'self', id: peerIdStr };
            },
            // "List keys" -> "We have one key: self"
            listKeys: async () => {
                return [{ name: 'self', id: peerIdStr }];
            },
            // Stub other methods to prevent crashes
            createKey: async () => ({ name: 'self', id: peerIdStr }),
            removeKey: async () => {},
            renameKey: async () => {},
            rotateKeychainPass: async () => {}
        };
    };

    statusEl.textContent = 'Initializing Node...';

    // 🟢 3. INJECT THE MOCK
    const libp2pNode = await createLibp2p({
        privateKey: privateKey, // Sets Node Identity
        addresses: { listen: [], announce: [] },
        transports: [ webTransport(), webSockets(), circuitRelayTransport({ discoverRelays: 1, reservationFilter: allowAll }) ],
        connectionEncrypters: [ noise() ],
        streamMuxers: [ yamux() ],
        connectionGater: { denyDialMultiaddr: () => false },
        peerDiscovery: [ bootstrap({ list: BOOTSTRAP_NODES }), pubsubPeerDiscovery({ interval: 1000, topics: [PRESENCE_TOPIC] }) ],
        services: { 
            identify: identify(),
            ping: ping(),
            // 🛡️ REPLACED REAL KEYCHAIN WITH MOCK
            keychain: mockKeychainService(), 
            pubsub: gossipsub({ emitSelf: true, allowPublishToZeroPeers: true }),
            dht: kadDHT({ clientMode: true, protocol: '/ipfs/kad/1.0.0' })
        }
    });

    console.log("🛠️ Mock Keychain Injected Successfully");

    statusEl.textContent = 'Starting Helia...';

    helia = await createHelia({ 
        blockstore: new MemoryBlockstore(),
        datastore: new MemoryDatastore(),
        libp2p: libp2pNode 
    });
    
    heliaIpns = ipns(helia);
    heliaStrings = strings(helia);
    window.helia = helia;
    myPeerIdStr = libp2pNode.peerId.toString();

    document.getElementById('node-id').textContent = myPeerIdStr.slice(-6); 
    document.getElementById('user-name').textContent = userName;
    statusEl.textContent = 'Connecting...';
    setupChat();
    
    // 4. PUBLISH
    publishMyName(userName);
}

async function publishMyName(name) {
    console.log("📝 Starting Publish Process...");
    appendSystemMessage(`📝 Preparing IPNS record...`);

    try {
        const myContentCid = await heliaStrings.add(JSON.stringify({ name: name, time: Date.now() }));
        console.log("📦 Content CID:", myContentCid.toString());
        
        console.log(`🚀 Publishing IPNS to /ipns/${helia.libp2p.peerId.toString()}`);
        appendSystemMessage(`🚀 Publishing... (This takes 30s+)`);
        
        // 
        
        // This will call our Mock Keychain -> exportKey -> Success
        await heliaIpns.publish(helia.libp2p.peerId, myContentCid);
        
        console.log(`✅ Success!`);
        appendSystemMessage(`✅ IPNS Published!`);
        appendChatMessage("System", `Published!`, true);
    } catch (e) {
        console.error("IPNS Fail:", e);
        appendSystemMessage(`⚠️ IPNS Fail: ${e.message}`);
    }
}

// ... (Chat logic remains the same) ...
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
    }, 3000);
}

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