import { createHelia } from 'helia'
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
import { strings } from '@helia/strings'
import { CID } from 'multiformats/cid'

// --- CONFIGURATION ---
const RELAY_ADDR_ONLY = '/ip4/127.0.0.1/tcp/4003/ws';
// ⚠️ ENSURE THIS MATCHES YOUR DOCKER LOGS:
const RELAY_PEER_ID = '12D3KooWFw8F8JK7ZQXY1pspP64jeRbt31kZFjMG13WA1583KrFX'; 

const FULL_RELAY_MA = `${RELAY_ADDR_ONLY}/p2p/${RELAY_PEER_ID}`;
const PRESENCE_TOPIC = 'helia-presence-v1';

const onlineUsers = new Map(); 
let myName = "";
let heliaStrings;

const allowAll = () => true

async function startHelia(userName) {
  myName = userName;
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Generating Identity...';

  // 1. Generate Identity
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
            // 🟢 FORCE RESERVATION ON LOCALHOST
            circuitRelayTransport({ 
                discoverRelays: 1,
                reservationFilter: allowAll 
            }) 
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
          pubsub: floodsub() 
        }
      }
  })
  window.helia = helia; 
  heliaStrings = strings(helia);

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

    pubsub.addEventListener('message', async (evt) => {
        if (evt.detail.topic !== PRESENCE_TOPIC) return;
        
        // 🟢 FIX 1: Robust Error Handling for JSON Parsing
        let payload;
        try {
            const rawData = toString(evt.detail.data);
            payload = JSON.parse(rawData);
        } catch (e) {
            // Ignore non-JSON messages (prevents console flooding)
            return;
        }

        const remotePeerId = evt.detail.from.toString();
        if (remotePeerId === helia.libp2p.peerId.toString()) return;

        if (payload.type === 'heartbeat') {
            handleHeartbeat(remotePeerId, payload.name);
            if (payload.address) {
                const conns = helia.libp2p.getConnections(evt.detail.from);
                if (conns.length === 0) {
                    helia.libp2p.dial(multiaddr(payload.address)).catch(() => {});
                }
            }
        }

        if (payload.type === 'chat-cid') {
            const msgId = appendChatMessage(payload.name, `Received CID: ${payload.cid}... Fetching...`, false);
            try {
                // Fetch Content via Bitswap/Relay
                const content = await heliaStrings.get(CID.parse(payload.cid));
                updateChatMessage(msgId, payload.name, content, payload.cid, false);
            } catch (fetchErr) {
                console.error("Fetch Error:", fetchErr);
                updateChatMessage(msgId, payload.name, `❌ Fetch Failed`, payload.cid, false);
            }
        }
    });

    setInterval(() => {
        const msg = JSON.stringify({ 
            type: 'heartbeat',
            name: myName, 
            timestamp: Date.now(),
            address: myAddress 
        });
        pubsub.publish(PRESENCE_TOPIC, fromString(msg)).catch(() => {});
    }, 1000);
    
    setInterval(pruneOfflineUsers, 2000);
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
        if (now - user.lastSeen > 5000) { onlineUsers.delete(id); changed = true; }
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
    const msgId = 'msg-' + Math.random().toString(36).substr(2, 9);
    div.id = msgId;
    div.style.marginBottom = '5px';
    div.style.padding = '8px';
    div.style.background = isMe ? '#e6f3ff' : '#f0f0f0';
    div.style.borderRadius = '5px';
    div.innerHTML = `<strong>${sender}:</strong> ${text}`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgId;
}
function updateChatMessage(elementId, sender, text, cid, isMe) {
    const div = document.getElementById(elementId);
    if (!div) return;
    div.innerHTML = `
        <strong>${sender}:</strong> ${text} <br>
        <small style="color:grey; font-size:0.7em;">CID: ${cid}</small>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
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

    const sendBtn = document.getElementById('send-msg-btn');
    const msgInput = document.getElementById('msg-input');
    
    if (sendBtn && msgInput) {
        sendBtn.onclick = async () => {
            const text = msgInput.value.trim();
            if (!text || !window.helia) return;
            
            // 1. Create CID
            const cid = await heliaStrings.add(text);
            const cidString = cid.toString();
            console.log("📝 Created CID:", cidString);

            // 🟢 FIX 2: Provide CID to the DHT
            // This announces to the network that *we* have this data
            console.log("🌐 Providing CID to DHT...");
            window.helia.libp2p.contentRouting.provide(cid).then(() => {
                console.log("✅ Successfully Provided CID to DHT");
            }).catch(e => console.warn("DHT Provide skipped (Client Mode)", e));

            // 3. Publish Message via PubSub
            const msg = JSON.stringify({ type: 'chat-cid', name: myName, cid: cidString });
            
            try {
                await window.helia.libp2p.services.pubsub.publish(PRESENCE_TOPIC, fromString(msg));
                const msgId = appendChatMessage("Me", text, true);
                updateChatMessage(msgId, "Me", text, cidString, true);
                msgInput.value = '';
            } catch (err) {
                console.error("Publish Error:", err);
            }
        };
    }
});