import { createHelia } from 'helia'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
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

// --- CONFIGURATION ---
// 1. We match the address shown in your 'ipfs id' output (127.0.0.1)
const RELAY_ADDR_ONLY = '/ip4/127.0.0.1/tcp/4003/ws';

// 2. We use the NEW ID from your logs
const RELAY_PEER_ID = '12D3KooWLtiioxKAt47vPYhVmyLQi7q9JbyTGNAkaCLWvoWWmF8N'; 

const FULL_RELAY_MA = `${RELAY_ADDR_ONLY}/p2p/${RELAY_PEER_ID}`;
const PRESENCE_TOPIC = 'helia-presence-v1';
const HEARTBEAT_INTERVAL = 2000; 
const OFFLINE_TIMEOUT = 12000;   

const onlineUsers = new Map(); 
let myName = "";
let myRelayAddress = null; 

const allowAll = () => true

async function startHelia(userName) {
  myName = userName;

  const libp2pConfig = {
    connectionGater: { denyDialMultiaddr: () => false },
    addresses: { 
        // 🟢 CRITICAL FIX: This tells libp2p to ask the relay for a reservation
        listen: ['/webrtc', '/p2p-circuit'] 
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
        pubsubPeerDiscovery({
            interval: 2000, 
            topics: [PRESENCE_TOPIC]
        })
    ],
    services: {
      identify: identify(),
      autoNAT: autoNAT(),
      dcutr: dcutr(), 
      ping: ping(),
      dht: kadDHT({ clientMode: true }),
      pubsub: gossipsub({ 
        allowPublishToZeroPeers: true,
        fallbackToFloodsub: true
      }) 
    }
  }

  const helia = await createHelia({ libp2p: libp2pConfig })
  window.helia = helia; 
  const peerId = helia.libp2p.peerId.toString();

  document.getElementById('node-id').textContent = peerId;
  document.getElementById('user-name').textContent = userName;
  document.getElementById('status').textContent = 'Connecting to Relay...';

  try {
      const ma = multiaddr(FULL_RELAY_MA);
      await helia.libp2p.dial(ma);
      console.log(`✅ Connected to Relay: ${RELAY_PEER_ID}`);

      console.log("⏳ Waiting for auto-reservation...");
      const success = await waitForReservation(helia);
      
      if (success) {
        console.log("🎟️ Reservation confirmed!");
        // We reconstruct the address manually to ensure we broadcast the correct one
        myRelayAddress = `${FULL_RELAY_MA}/p2p-circuit/p2p/${peerId}`;
        document.getElementById('status').textContent = 'Online 🟢';
        
        setupPresenceSystem(helia);
        startRandomWalk(helia);
      } else {
        throw new Error("Relay reservation timed out - Check 'listen' config");
      }

  } catch (err) {
      console.error("❌ Connection failed:", err);
      document.getElementById('status').textContent = 'Relay Connection Failed';
  }

  return { helia }
}

async function waitForReservation(helia) {
    for (let i = 0; i < 15; i++) { // Wait ~7.5 seconds
        const addrs = helia.libp2p.getMultiaddrs().map(m => m.toString());
        // Look for any address containing 'p2p-circuit'
        if (addrs.some(a => a.includes('p2p-circuit'))) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
}

function startRandomWalk(helia) {
    setInterval(async () => {
        try {
            const randomKey = new Uint8Array(32);
            crypto.getRandomValues(randomKey);
            for await (const event of helia.libp2p.services.dht.getClosestPeers(randomKey)) {}
        } catch (e) {}
    }, 10000);
}

function setupPresenceSystem(helia) {
    const pubsub = helia.libp2p.services.pubsub;
    pubsub.subscribe(PRESENCE_TOPIC);

    pubsub.addEventListener('message', async (evt) => {
        if (evt.detail.topic !== PRESENCE_TOPIC) return;
        const remotePeerId = evt.detail.from.toString();
        
        try {
            const payload = JSON.parse(toString(evt.detail.data));
            console.log(`📨 Heartbeat from ${payload.name}`);
            
            // If we see a peer on the relay, try to upgrade the connection
            if (payload.address && remotePeerId !== helia.libp2p.peerId.toString()) {
                const conns = helia.libp2p.getConnections(evt.detail.from);
                if (conns.length === 0) {
                    helia.libp2p.dial(multiaddr(payload.address)).catch(() => {});
                }
            }
            handleHeartbeat(remotePeerId, payload.name);
        } catch (e) {}
    });

    setInterval(() => broadcastHeartbeat(helia), HEARTBEAT_INTERVAL);
    setInterval(() => pruneOfflineUsers(), 2000);
}

function broadcastHeartbeat(helia) {
    if (!helia || !myRelayAddress) return;
    const msg = JSON.stringify({ 
        name: myName, 
        timestamp: Date.now(),
        address: myRelayAddress 
    });
    helia.libp2p.services.pubsub.publish(PRESENCE_TOPIC, fromString(msg)).catch(() => {});
}

function handleHeartbeat(id, name) {
    onlineUsers.set(id, { name: name, lastSeen: Date.now() });
    renderUserList();
}

function pruneOfflineUsers() {
    const now = Date.now();
    let changed = false;
    for (const [id, user] of onlineUsers.entries()) {
        if (now - user.lastSeen > OFFLINE_TIMEOUT) {
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
        li.innerHTML = `${user.name} <span style="color:green">●</span> <small>(${id.slice(-6)})</small>`;
        el.appendChild(li);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-helia')
  const userNameInput = document.getElementById('user-name-input')
  if (!startButton) return
  startButton.onclick = async () => {
    const name = userNameInput.value.trim()
    if (!name) return;
    userNameInput.disabled = true; startButton.disabled = true;
    await startHelia(name);
    document.getElementById('input-area').classList.add('started');
  }
})