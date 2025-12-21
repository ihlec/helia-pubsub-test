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
import { ipns } from '@helia/ipns'
import { ipnsValidator, ipnsSelector } from '@helia/ipns'
import { strings } from '@helia/strings'
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys'
import { fromString } from 'uint8arrays/from-string'
import { keychain } from '@libp2p/keychain'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { multiaddr } from '@multiformats/multiaddr'

// --- CONFIGURATION ---

const SHARED_KEY_STRING = 'TL+0YBiCedGwobNXEIr47PEIN0/HmUHtwYK9x4W1mjg=' 
const SHARED_KEY_ALIAS = 'shared-registry-key'

const KEYCHAIN_CONFIG = {
  pass: 'my-secure-registry-password-123',
  dek: {
    keyLength: 512 / 8,
    iterationCount: 10000,
    salt: 'registry-salt-fixed-value', 
    hash: 'sha2-512'
  }
}

// 🟢 BOOTSTRAP LIST (UPDATE ME with new Docker ID)
const BOOTSTRAP_NODES = [
  '/dns4/localhost/tcp/4003/ws/p2p/12D3KooWQy55Fzbgn8dCp6ywG1odbJWPK3th4sQnS19CRyRWoWx7'
];

const allowAll = () => true

async function startHelia(userName) {
  
  if (SHARED_KEY_STRING === 'YOUR_BASE64_SEED_STRING_GOES_HERE') {
      alert("Error: You haven't pasted your generated key seed yet!")
      throw new Error("Missing Shared Key")
  }

  // --- A. Libp2p Configuration ---
  const libp2pConfig = {
    connectionGater: {
      denyDialMultiaddr: () => false,
    },
    addresses: { 
        listen: ['/webrtc'] 
    },
    transports: [ 
        webSockets({ filter: allowAll }),
        webRTC(), 
        circuitRelayTransport({ discoverRelays: 3 })
    ],
    connectionManager: {
        minConnections: 1, 
        autoDial: true
    },
    connectionEncrypters: [ noise() ],
    streamMuxers: [ yamux() ],
    peerDiscovery: [ 
        bootstrap({ list: BOOTSTRAP_NODES }),
        pubsubPeerDiscovery({
            interval: 3000, 
            topics: ['_peer-discovery._p2p._pubsub', 'helia-registry-discovery'],
            listenOnly: false
        })
    ],
    services: {
      autoNAT: autoNAT(),
      dcutr: dcutr(),
      dht: kadDHT({
        clientMode: true,
        protocol: '/ipfs/kad/1.0.0',
        validators: { ipns: ipnsValidator },
        selectors: { ipns: ipnsSelector }
      }),
      ping: ping(),
      identify: identify(),
      pubsub: gossipsub({ allowPublishToZeroPeers: true }),
      keychain: keychain(KEYCHAIN_CONFIG)
    }
  }

  const helia = await createHelia({ libp2p: libp2pConfig })
  window.helia = helia;

  // 🟢 🔍 FORCE DIAL & TAG RELAY
  try {
      console.log("🔨 Attempting Manual Dial to Relay...");
      const targetStr = BOOTSTRAP_NODES[0];
      const ma = multiaddr(targetStr);
      const connection = await helia.libp2p.dial(ma);
      console.log("✅ MANUAL DIAL SUCCESS!", connection);

      const relayPeerId = connection.remotePeer;
      await helia.libp2p.peerStore.merge(relayPeerId, {
          tags: {
              'relay-peer': { value: 100, ttl: 1576800000000 }
          }
      });
      console.log("🛡️ Relay connection tagged as protected.");
  } catch (err) {
      console.error("❌ MANUAL DIAL FAILED:", err);
  }

  // 🟢 PURE P2P NAMING SYSTEM
  const nameSystem = ipns(helia)
  const jsonStorage = strings(helia)
  
  const peerId = helia.libp2p.peerId.toString()
  console.log(`Helia started. My Peer ID: ${peerId}`)

  // --- C. IMPORT KEY ---
  let sharedPeerId;
  try {
    const myKeychain = helia.libp2p.services.keychain;
    const seedBytes = fromString(SHARED_KEY_STRING, 'base64pad');
    const expectedKey = await generateKeyPairFromSeed('Ed25519', seedBytes);
    
    const keys = await myKeychain.listKeys();
    const existingKeyRef = keys.find(k => k.name === SHARED_KEY_ALIAS);
    if (existingKeyRef) await myKeychain.removeKey(SHARED_KEY_ALIAS);
    await myKeychain.importKey(SHARED_KEY_ALIAS, expectedKey);

    const finalKey = await myKeychain.exportKey(SHARED_KEY_ALIAS);
    sharedPeerId = peerIdFromPrivateKey(finalKey);

    console.log("--------------------------------------------------")
    console.log(`✅ SHARED REGISTRY ACTIVE`)
    console.log(`IPNS Name: ${sharedPeerId.toString()}`)
    console.log("--------------------------------------------------")

    document.getElementById('node-id').textContent = peerId
    document.getElementById('user-name').textContent = userName
    document.getElementById('status').textContent = 'Connected'

    // Start Loops
    startRegistryLoop(nameSystem, jsonStorage, sharedPeerId, userName, helia)
    startNetworkMonitor(helia)
    startHeartbeat(helia)

  } catch (e) {
    console.error("Failed to setup shared key:", e)
    alert("Key Import Failed. See console.")
  }

  return { helia }
}

/**
 * 🔄 MAIN REGISTRY LOOP
 */
async function startRegistryLoop(nameSystem, jsonStorage, sharedPeerId, userName, helia) {
  
  let lastPublishTime = 0;
  const PUBLISH_COOLDOWN = 60 * 1000; 
  let knownUsers = new Map();
  let isRunning = false; 
  
  let debugState = {
      peerId: sharedPeerId.toString().slice(-8), 
      cid: "...",
      seq: "...",
      userCount: 0,
      status: "Initializing..."
  };

  const updateRegistry = async () => {
    if (isRunning) { console.log("⏳ Loop skipped"); return; }
    isRunning = true;

    try {
      // 🛑 1. Connection Check
      const connectedPeers = helia.libp2p.getPeers();
      if (connectedPeers.length === 0) {
          debugState.status = "🔴 Waiting for Relay...";
          updateDebugPanel(debugState);
          isRunning = false; 
          return;
      }

      // 🛑 2. Warm up on First Run
      if (lastPublishTime === 0) {
          console.log("⏳ Warming up DHT for 5 seconds...");
          await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // --- STEP 1: RESOLVE ---
      let remoteUsers = [];
      let source = "None";

      try {
        console.log("🔍 [Debug] Resolving IPNS (Timeout: 10s)...");
        const result = await nameSystem.resolve(sharedPeerId, { 
             signal: AbortSignal.timeout(10000) 
        });

        debugState.cid = result.cid.toString();
        debugState.status = "2. Fetching JSON...";
        updateDebugPanel(debugState);

        const jsonStr = await jsonStorage.get(result.cid);
        remoteUsers = JSON.parse(jsonStr);
        source = "DHT";
        console.log(`✅ [Debug] Resolved! Users found: ${remoteUsers.length}`);

      } catch (err) {
         console.warn("⚠️ [Debug] Resolve Failed (Likely First Run or Empty):", err.message);
         remoteUsers = []; 
      }

      // --- STEP 2: MERGE ---
      remoteUsers.forEach(user => {
        if (!knownUsers.has(user.name)) knownUsers.set(user.name, { name: user.name });
      });
      knownUsers.set(userName, { name: userName }); 

      const userList = Array.from(knownUsers.values()).sort((a, b) => a.name.localeCompare(b.name));
      renderUserList(userList);
      
      debugState.userCount = userList.length;
      updateDebugPanel(debugState);

      // --- STEP 3: PUBLISH DECISION ---
      const timeSinceLastPublish = Date.now() - lastPublishTime;
      
      if (source !== "None" && timeSinceLastPublish < PUBLISH_COOLDOWN) {
          debugState.status = "Idle (Synced)";
          updateDebugPanel(debugState);
          isRunning = false;
          return;
      }

      // --- STEP 4: PUBLISH (WITH RETRY LOGIC) ---
      debugState.status = "3. Publishing...";
      updateDebugPanel(debugState);
      
      const newJson = JSON.stringify(userList);
      const newCid = await jsonStorage.add(newJson);
      console.log(`📤 [Debug] Publishing CID: ${newCid}`);
      
      // Try to provide to DHT
      try {
        for await (const _ of helia.libp2p.services.dht.provide(newCid)) {} 
      } catch (e) {}

      // 🟢 ROBUST PUBLISH ATTEMPT
      // If the connection drops during publish, the heartbeat will fix the socket,
      // but this function needs to catch the error and NOT crash the loop.
      try {
          const publishResult = await nameSystem.publish(sharedPeerId, newCid, {
              key: SHARED_KEY_ALIAS,
              signal: AbortSignal.timeout(60000) 
          });
          
          console.log("📦 Publish Result:", publishResult);
          if (publishResult && publishResult.sequence !== undefined) {
              debugState.seq = publishResult.sequence.toString();
          } else {
              debugState.seq = "Updated";
          }
          lastPublishTime = Date.now();
          debugState.status = "✅ Success";
          console.log(`🚀 [Debug] Publish Confirmed!`);

      } catch (pubErr) {
          console.error("⚠️ Publish attempt failed (Will retry next loop):", pubErr.message);
          debugState.status = "⚠️ Publish Retry Pending";
      }
      
      updateDebugPanel(debugState);

    } catch (e) {
      console.error("❌ Error in Registry Loop:", e.message);
      debugState.status = `Error: ${e.message}`;
      updateDebugPanel(debugState);
    } finally {
        isRunning = false; 
    }
  }

  updateRegistry();
  setInterval(updateRegistry, 15000);
}

function startHeartbeat(helia) {
    setInterval(async () => {
        const peers = helia.libp2p.getPeers();
        if (peers.length === 0) {
            console.warn("💔 Disconnected! Attempting to reconnect to Relay...");
            try {
                const relayAddr = multiaddr(BOOTSTRAP_NODES[0]);
                await helia.libp2p.dial(relayAddr);
                console.log("💚 Reconnected to Relay!");
            } catch (e) { }
        }
    }, 5000);
}

function startNetworkMonitor(helia) {
    const el = document.createElement('div');
    el.id = 'network-stats';
    el.style = "background: #eee; padding: 10px; margin-top: 10px; font-size: 12px; font-family: monospace;";
    
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = "Check Reachability";
    refreshBtn.style = "font-size: 10px; margin-left: 5px; cursor: pointer;";
    refreshBtn.onclick = () => updateStats();
    
    document.getElementById('app-container').appendChild(el);
    el.appendChild(refreshBtn);

    const updateStats = () => {
        const peers = helia.libp2p.getPeers();
        const myMultiaddrs = helia.libp2p.getMultiaddrs();
        const hasRelay = myMultiaddrs.some(ma => ma.toString().includes('/p2p-circuit'));
        const relayAddress = hasRelay ? myMultiaddrs.find(ma => ma.toString().includes('/p2p-circuit')).toString() : "Searching...";

        el.innerHTML = `
            <strong>Network Diagnostics:</strong><br>
            Connected Peers: ${peers.length}<br>
            <strong>Public Reachability: ${hasRelay ? "<span style='color:green'>🟢 YES (Relay Active)</span>" : "<span style='color:red'>🔴 NO (NAT Blocked)</span>"}</strong><br>
            <div style="margin-top:5px; font-size:10px; color:#666; word-break: break-all;">
               My Address: ${relayAddress}
            </div>
        `;
        el.appendChild(refreshBtn); 
    };

    setInterval(updateStats, 2000);
    updateStats();
}

function renderUserList(users) {
  const el = document.getElementById('online-users-list')
  if (!el) return
  el.innerHTML = ''
  users.forEach(u => {
    const li = document.createElement('li')
    li.textContent = `${u.name}`
    el.appendChild(li)
  })
}

function updateDebugPanel(info) {
    let el = document.getElementById('debug-panel');
    if (!el) {
        el = document.createElement('div');
        el.id = 'debug-panel';
        el.style = "background: #222; color: #0f0; padding: 10px; margin-top: 20px; font-family: monospace; font-size: 11px; white-space: pre-wrap; border: 1px solid #444;";
        document.getElementById('app-container').appendChild(el);
    }
    el.textContent = `--- 🛠️ IPNS STATE DEBUG ---
Target PeerID: ${info.peerId || '...'}
Last Resolved CID: ${info.cid || 'Waiting...'}
Record Sequence #: ${info.seq || 'Unknown'}
Total Known Users: ${info.userCount || 0}
Last Action: ${info.status || 'Idle'}
---------------------------`;
}

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-helia')
  const userNameInput = document.getElementById('user-name-input')

  if (!startButton) return

  startButton.onclick = async () => {
    const userName = userNameInput.value.trim()
    if (!userName) {
      alert('Please enter your user name!')
      return
    }
    userNameInput.disabled = true
    startButton.disabled = true
    document.getElementById('status').textContent = 'Starting Node...'
    
    try {
      await startHelia(userName)
      document.getElementById('app-container').classList.add('started')
    } catch (e) {
      console.error('Error starting Helia node:', e)
      document.getElementById('status').textContent = 'Error'
      userNameInput.disabled = false
      startButton.disabled = false
    }
  }
})