import { createHelia } from 'helia'
// 🟢 CHANGE 1: Import FloodSub instead of GossipSub
import { floodsub } from '@libp2p/floodsub'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { autoNAT } from '@libp2p/autonat'
import { kadDHT } from '@libp2p/kad-dht'
import { ping } from '@libp2p/ping'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { multiaddr } from '@multiformats/multiaddr'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'

// --- CONFIGURATION ---
const RELAY_ADDR_ONLY = '/ip4/127.0.0.1/tcp/4003/ws';
// ⚠️ CHECK YOUR LOGS FOR THE NEW ID (Updates every time you wipe Docker):
const RELAY_PEER_ID = '12D3KooWAdgj2rq3ST3mRAkQ8HgvUTbdqa9uDphgMsehwBLb9ThU'; 

const FULL_RELAY_MA = `${RELAY_ADDR_ONLY}/p2p/${RELAY_PEER_ID}`;
const PRESENCE_TOPIC = 'helia-presence-v1';

const onlineUsers = new Map(); 
let myName = "";

const allowAll = () => true

async function startHelia(userName) {
  myName = userName;
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Generating Identity...';

  // 1. Generate Identity (Restart Trick)
  const tempHelia = await createHelia({
      blockstore: new MemoryBlockstore(),
      datastore: new MemoryDatastore(),
      libp2p: { addresses: { listen: [] } }
  });
  const myPeerId = tempHelia.libp2p.peerId;
  const myPeerIdString = myPeerId.toString();
  await tempHelia.stop();

  document.getElementById('node-id').textContent = myPeerIdString;
  document.getElementById('user-name').textContent = userName;

  // 2. Pre-calculate Address
  const myRelayAddress = `${FULL_RELAY_MA}/p2p-circuit/p2p/${myPeerIdString}`;
  console.log("💎 My Address:", myRelayAddress);

  // 3. Start Node
  statusEl.textContent = 'Connecting...';
  const helia = await createHelia({ 
      blockstore: new MemoryBlockstore(),
      datastore: new MemoryDatastore(),
      libp2p: {
        peerId: myPeerId,
        connectionGater: { denyDialMultiaddr: () => false },
        addresses: { 
            listen: ['/webrtc', '/p2p-circuit'],
            announce: [ myRelayAddress ] 
        },
        transports: [ 
            webSockets({ filter: allowAll }),
            webRTC(), 
            circuitRelayTransport({ discoverRelays: 1 }) 
        ],
        connectionEncrypters: [ noise() ],
        streamMuxers: [ yamux() ],
        peerDiscovery: [ 
            bootstrap({ list: [ FULL_RELAY_MA ] }),
            pubsubPeerDiscovery({ interval: 1000, topics: [PRESENCE_TOPIC] })
        ],
        services: {
          identify: identify(),
          autoNAT: autoNAT(),
          dcutr: dcutr(), 
          ping: ping(),
          dht: kadDHT({ clientMode: true }),
          // 🟢 CHANGE 2: USE FLOODSUB (Robust for simple relays)
          pubsub: floodsub() 
        }
      }
  })
  window.helia = helia; 

  try {
      await helia.libp2p.dial(multiaddr(FULL_RELAY_MA));
      statusEl.textContent = 'Online 🟢';
      
      setupPubSub(helia, myRelayAddress);

  } catch (err) {
      console.error("❌ Connection failed:", err);
      statusEl.textContent = 'Connection Failed 🔴';
  }
}

function setupPubSub(helia, myAddress) {
    const pubsub = helia.libp2p.services.pubsub;
    pubsub.subscribe(PRESENCE_TOPIC);

    // MESSAGE HANDLER
    pubsub.addEventListener('message', (evt) => {
        if (evt.detail.topic !== PRESENCE_TOPIC) return;
        
        try {
            const payload = JSON.parse(toString(evt.detail.data));
            const remotePeerId = evt.detail.from.toString();
            
            // Ignore self
            if (remotePeerId === helia.libp2p.peerId.toString()) return;

            // Handle Heartbeat (Presence)
            if (payload.type === 'heartbeat') {
                handleHeartbeat(remotePeerId, payload.name);
                
                // Optional: Attempt to dial them directly (Mesh building)
                if (payload.address) {
                    const conns = helia.libp2p.getConnections(evt.detail.from);
                    if (conns.length === 0) {
                        helia.libp2p.dial(multiaddr(payload.address)).catch(() => {});
                    }
                }
            }

            // Handle Chat Message
            if (payload.type === 'chat') {
                appendChatMessage(payload.name, payload.text, false);
            }
        } catch (e) {}
    });

    // Start Heartbeat Loop
    setInterval(() => {
        const msg = JSON.stringify({ 
            type: 'heartbeat',
            name: myName, 
            timestamp: Date.now(),
            address: myAddress 
        });
        pubsub.publish(PRESENCE_TOPIC, fromString(msg)).catch(() => {});
    }, 1000); // 1s interval for faster discovery
}

// --- UI HELPERS ---

function handleHeartbeat(id, name) {
    onlineUsers.set(id, { name: name, lastSeen: Date.now() });
    renderUserList();
}

function pruneOfflineUsers() {
    const now = Date.now();
    let changed = false;
    for (const [id, user] of onlineUsers.entries()) {
        if (now - user.lastSeen > 5000) { // 5s timeout
            onlineUsers.delete(id);
            changed = true;
        }
    }
    if (changed) renderUserList();
}

function renderUserList() {
    const el = document.getElementById('online-users-list');
    if (!el) return;
    el.innerHTML = '';
    onlineUsers.forEach((user, id) => {
        const li = document.createElement('li');
        li.innerHTML = `${user.name} <span style="color:green">●</span>`;
        el.appendChild(li);
    });
}

function appendChatMessage(sender, text, isMe) {
    const chatBox = document.getElementById('chat-messages'); 
    if (!chatBox) return;
    
    const div = document.createElement('div');
    div.style.marginBottom = '5px';
    div.style.padding = '5px';
    div.style.background = isMe ? '#e6f3ff' : '#f0f0f0';
    div.style.borderRadius = '5px';
    div.innerHTML = `<strong>${sender}:</strong> ${text}`;
    
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// --- INITIALIZATION & EVENTS ---

document.addEventListener('DOMContentLoaded', () => {
    // START BUTTON
    const startBtn = document.getElementById('start-helia');
    if (startBtn) {
        startBtn.onclick = async () => {
            const nameInput = document.getElementById('user-name-input');
            const name = nameInput.value.trim();
            if (!name) return;
            nameInput.disabled = true; startBtn.disabled = true;
            await startHelia(name);
            document.getElementById('input-area').classList.add('started');
        };
    }

    // SEND MESSAGE BUTTON
    const sendBtn = document.getElementById('send-msg-btn');
    const msgInput = document.getElementById('msg-input');
    
    if (sendBtn && msgInput) {
        sendBtn.onclick = async () => {
            const text = msgInput.value.trim();
            if (!text || !window.helia) return;
            
            const msg = JSON.stringify({
                type: 'chat',
                name: myName,
                text: text
            });
            
            await window.helia.libp2p.services.pubsub.publish(PRESENCE_TOPIC, fromString(msg));
            appendChatMessage("Me", text, true);
            msgInput.value = '';
        };
    }
    
    setInterval(pruneOfflineUsers, 2000);
});