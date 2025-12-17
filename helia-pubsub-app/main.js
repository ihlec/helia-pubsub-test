import { createHelia } from 'helia'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
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

// Robust Bootstrap List (Reliable Relay V2 Nodes)
const BOOTSTRAP_NODES = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
  '/dnsaddr/va1.bootstrap.libp2p.io/p2p/12D3KooWKnDdG3iXw9eTFijk3EWSunZcFi54Zka4wmtqtt6rPxc8',
  '/dnsaddr/node-1.ingress.cloudflare-ipfs.com/p2p/QmcFf2FH3CEgTNHeMRGhN7HNHU1EXAxoEk6EFu9BJnmoWH',
  '/dnsaddr/node-2.ingress.cloudflare-ipfs.com/p2p/QmcFoshkxXLnhNHrsbnjp8FpPs8nzcq9grXJfi6A9F78fk'
];

async function startHelia(userName) {
  
  if (SHARED_KEY_STRING === 'YOUR_BASE64_SEED_STRING_GOES_HERE') {
      alert("Error: You haven't pasted your generated key seed yet!")
      throw new Error("Missing Shared Key")
  }

  // A. Libp2p Configuration
  const libp2pConfig = {
    addresses: { 
        listen: [] 
    },
    transports: [ 
        webSockets(),
        // 🟢 ENABLE CIRCUIT RELAY (Updated Config)
        circuitRelayTransport({ 
            discoverRelays: 2 // Try to find at least 2 relays
        })
    ],
    // 🟢 KEEP ALIVE: Force node to maintain connections
    connectionManager: {
        minConnections: 2
    },
    connectionEncrypters: [ noise() ],
    streamMuxers: [ yamux() ],
    peerDiscovery: [ 
        bootstrap({ list: BOOTSTRAP_NODES }),
        pubsubPeerDiscovery({
            interval: 10000,
            listenOnly: false
        })
    ],
    services: {
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
      
      keychain: (components) => {
          const originalKeychain = keychain(KEYCHAIN_CONFIG)(components);
          return {
              ...originalKeychain,
              importKey: async (name, key) => {
                  if (name !== SHARED_KEY_ALIAS) return { name: SHARED_KEY_ALIAS, id: name };
                  return originalKeychain.importKey(name, key);
              },
              exportKey: async (name) => {
                  if (name !== SHARED_KEY_ALIAS) return originalKeychain.exportKey(SHARED_KEY_ALIAS);
                  return originalKeychain.exportKey(name);
              },
              listKeys: originalKeychain.listKeys.bind(originalKeychain),
              findKeyByName: originalKeychain.findKeyByName.bind(originalKeychain),
              findKeyById: originalKeychain.findKeyById.bind(originalKeychain),
              removeKey: originalKeychain.removeKey.bind(originalKeychain),
              renameKey: originalKeychain.renameKey.bind(originalKeychain),
              rotateKeychainPass: originalKeychain.rotateKeychainPass.bind(originalKeychain)
          }
      },
    }
  }

  // B. Create Helia
  const helia = await createHelia({ libp2p: libp2pConfig })
  
  const nameSystem = ipns(helia)
  const jsonStorage = strings(helia)
  
  const peerId = helia.libp2p.peerId.toString()
  console.log(`Helia started. My Peer ID: ${peerId}`)

  // --- C. IMPORT & VALIDATE SHARED KEY ---
  let sharedPeerId;
  
  try {
    const myKeychain = helia.libp2p.services.keychain;
    
    // 1. Generate expected key from seed
    const seedBytes = fromString(SHARED_KEY_STRING, 'base64pad');
    const expectedKey = await generateKeyPairFromSeed('Ed25519', seedBytes);
    const expectedPeerId = peerIdFromPrivateKey(expectedKey);
    
    // 2. Check if we have a key stored already
    const keys = await myKeychain.listKeys();
    const existingKeyRef = keys.find(k => k.name === SHARED_KEY_ALIAS);

    if (existingKeyRef) {
        // 🟢 CRITICAL: Verify stored key matches seed
        const storedKey = await myKeychain.exportKey(SHARED_KEY_ALIAS);
        const storedPeerId = peerIdFromPrivateKey(storedKey);

        if (storedPeerId.toString() !== expectedPeerId.toString()) {
            console.warn("⚠️ Stored key mismatch! Overwriting with correct Seed Key...");
            await myKeychain.removeKey(SHARED_KEY_ALIAS);
            await myKeychain.importKey(SHARED_KEY_ALIAS, expectedKey);
        } else {
            console.log("✅ Stored key verified (Matches Seed).");
        }
    } else {
        console.log("🆕 Importing new shared key from seed...");
        await myKeychain.importKey(SHARED_KEY_ALIAS, expectedKey);
    }

    // 3. Final Retrieve
    const finalKey = await myKeychain.exportKey(SHARED_KEY_ALIAS);
    sharedPeerId = peerIdFromPrivateKey(finalKey);
    
    if (finalKey.bytes) {
        sharedPeerId.privateKey = finalKey.bytes
    }

    console.log("--------------------------------------------------")
    console.log(`✅ SHARED REGISTRY ACTIVE`)
    console.log(`IPNS Name: ${sharedPeerId.toString()}`)
    console.log(`Gateway URL: https://ipfs.io/ipns/${sharedPeerId.toCID().toString()}`)
    console.log("--------------------------------------------------")

    document.getElementById('node-id').textContent = peerId
    document.getElementById('user-name').textContent = userName
    document.getElementById('status').textContent = 'Connected (Scanning Registry...)'

    // Start Loops
    startRegistryLoop(nameSystem, jsonStorage, sharedPeerId, userName, helia)
    startNetworkMonitor(helia)

  } catch (e) {
    console.error("Failed to setup shared key:", e)
    alert("Key Import Failed. See console.")
  }

  return { helia }
}

/**
 * 🛠️ DEBUG PANEL
 */
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
Record Sequence #: ${info.seq || 'Unknown'} (Higher is newer)
Total Known Users: ${info.userCount || 0}
Last Action: ${info.status || 'Idle'}
---------------------------`;
}

/**
 * 🔄 MAIN REGISTRY LOOP
 */
async function startRegistryLoop(nameSystem, jsonStorage, sharedPeerId, userName, helia) {
  
  let lastPublishTime = 0;
  const PUBLISH_COOLDOWN = 60 * 1000; 
  let knownUsers = new Map();
  
  let debugState = {
      peerId: sharedPeerId.toString().slice(-8), 
      cid: "Not resolved yet",
      seq: "N/A",
      userCount: 0,
      status: "Initializing..."
  };

  const updateRegistry = async () => {
    const statusEl = document.getElementById('status');
    debugState.status = "1. Resolving IPNS...";
    updateDebugPanel(debugState);

    try {
      // --- STEP 1: RESOLVE ---
      let remoteUsers = [];
      let source = "None";

      try {
        console.log("🔍 [Debug] Resolving IPNS...");
        
        const result = await nameSystem.resolve(sharedPeerId, { 
             signal: AbortSignal.timeout(60000) 
        });

        debugState.cid = result.cid.toString();
        debugState.status = "2. Fetching JSON...";
        updateDebugPanel(debugState);

        const jsonStr = await jsonStorage.get(result.cid);
        remoteUsers = JSON.parse(jsonStr);
        source = "DHT";
        
        console.log(`✅ [Debug] Resolved CID: ${result.cid.toString()} | Users: ${remoteUsers.length}`);
        debugState.seq = "(Resolved)"; 

      } catch (err) {
         console.warn("⚠️ [Debug] Resolve Failed:", err.message);
         debugState.status = "Resolve Failed (Network empty or slow?)";
      }

      // --- STEP 2: MERGE ---
      if (remoteUsers.length > 0) {
          remoteUsers.forEach(user => {
            // No timestamps, just names
            if (!knownUsers.has(user.name)) {
                console.log(`👋 [Debug] Discovered new user: ${user.name}`);
                knownUsers.set(user.name, { name: user.name });
            }
          });
      }

      // Add Self (Without Timestamp -> Persistent CID)
      knownUsers.set(userName, { name: userName });
      
      // Sort alphabetically to ensure JSON string is always identical
      const userList = Array.from(knownUsers.values()).sort((a, b) => a.name.localeCompare(b.name));
      
      renderUserList(userList);
      debugState.userCount = userList.length;
      updateDebugPanel(debugState);

      // --- STEP 3: PUBLISH DECISION ---
      const timeSinceLastPublish = Date.now() - lastPublishTime;
      
      if (source === "None" && userList.length > 1) {
          debugState.status = "🛑 Publish Skipped (Unsynced)";
          updateDebugPanel(debugState);
          return;
      }

      if (timeSinceLastPublish < PUBLISH_COOLDOWN) {
          const timeLeft = Math.ceil((PUBLISH_COOLDOWN - timeSinceLastPublish) / 1000);
          debugState.status = `Idle (Cooldown: ${timeLeft}s)`;
          updateDebugPanel(debugState);
          return;
      }

      // --- STEP 4: PUBLISH ---
      debugState.status = "3. Publishing...";
      updateDebugPanel(debugState);
      statusEl.textContent = 'Publishing to Network...';
      
      const newJson = JSON.stringify(userList);
      const newCid = await jsonStorage.add(newJson);
      
      // Check if CID Changed
      if (debugState.cid === newCid.toString()) {
           console.log("ℹ️ Content matches network. Publishing 'Liveness' update (re-signing same data).");
      }
      
      console.log(`📤 [Debug] Publishing content CID: ${newCid}`);
      
      try {
        for await (const _ of helia.libp2p.services.dht.provide(newCid)) {} 
        console.log("📢 [Debug] Manually provided CID to DHT");
      } catch (e) {}

      const publishResult = await nameSystem.publish(sharedPeerId, newCid, {
          key: SHARED_KEY_ALIAS,
          signal: AbortSignal.timeout(90000) 
      });
      
      if (publishResult && publishResult.sequence) {
          debugState.seq = publishResult.sequence.toString();
          console.log(`🚀 [Debug] Publish Success! Seq: ${publishResult.sequence}`);
      } else {
           debugState.seq = "Published (Unknown Seq)";
      }
      
      lastPublishTime = Date.now();
      debugState.status = "✅ Synced & Published";
      debugState.cid = newCid.toString();
      updateDebugPanel(debugState);
      statusEl.textContent = 'Online & Synced';

    } catch (e) {
      console.error("❌ Registry Loop Critical Error:", e);
      debugState.status = `Error: ${e.message}`;
      updateDebugPanel(debugState);
      statusEl.textContent = 'Retrying...';
    }
  }

  updateRegistry();
  setInterval(updateRegistry, 30000);
}

/**
 * 📊 MONITOR (Fixed to show actual Relay Status)
 */
function startNetworkMonitor(helia) {
    const el = document.createElement('div');
    el.id = 'network-stats';
    el.style = "background: #eee; padding: 10px; margin-top: 10px; font-size: 12px; font-family: monospace;";
    document.getElementById('app-container').appendChild(el);

    setInterval(() => {
        const peers = helia.libp2p.getPeers();
        const connections = helia.libp2p.getConnections();
        
        // Correct way to count relay connections
        const relayConns = connections.filter(conn => 
            conn.remoteAddr.toString().includes('circuit')
        );

        // Check if we are listening (have a multiaddr)
        const multiaddrs = helia.libp2p.getMultiaddrs();
        const isListening = multiaddrs.length > 0;
        
        el.innerHTML = `
            <strong>Network Diagnostics:</strong><br>
            Connected Peers: ${peers.length}<br>
            Relay Connections: ${relayConns.length}<br>
            <strong>Public Status: ${isListening ? "🟢 Reachable (Listening)" : "🔴 Unreachable (NAT)"}</strong><br>
            <em>(Your Address: ${isListening ? "Yes (via Relay)" : "None"})</em>
        `;
    }, 2000);
}

function renderUserList(users) {
  const el = document.getElementById('online-users-list')
  if (!el) return
  
  el.innerHTML = ''
  
  // Sort alphabetically
  const sorted = users.sort((a, b) => a.name.localeCompare(b.name))
  
  sorted.forEach(u => {
    const li = document.createElement('li')
    li.textContent = `${u.name}`
    el.appendChild(li)
  })
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