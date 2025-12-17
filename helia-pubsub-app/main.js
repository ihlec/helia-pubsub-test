import { createHelia } from 'helia'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { kadDHT } from '@libp2p/kad-dht'
import { ping } from '@libp2p/ping' // 📦 NEW IMPORT
import { ipns } from '@helia/ipns'
import { strings } from '@helia/strings'
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys'
import { fromString } from 'uint8arrays/from-string'
import { keychain } from '@libp2p/keychain'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'

// --- CONFIGURATION ---

const SHARED_KEY_STRING = 'TL+0YBiCedGwobNXEIr47PEIN0/HmUHtwYK9x4W1mjg=' 
const SHARED_KEY_ALIAS = 'shared-registry-key'

const GATEWAYS = [
    'https://ipfs.io/ipns/',
    'https://dweb.link/ipns/',
    'https://cloudflare-ipfs.com/ipns/'
];

const KEYCHAIN_CONFIG = {
  pass: 'my-secure-registry-password-123',
  dek: {
    keyLength: 512 / 8,
    iterationCount: 10000,
    salt: 'registry-salt-fixed-value', 
    hash: 'sha2-512'
  }
}

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
    addresses: { listen: [] },
    transports: [ webSockets() ],
    connectionEncrypters: [ noise() ],
    streamMuxers: [ yamux() ],
    peerDiscovery: [ bootstrap({ list: BOOTSTRAP_NODES }) ],
    services: {
      // 📡 DHT ENABLED
      dht: kadDHT({
        clientMode: true,
        protocol: '/ipfs/kad/1.0.0'
      }),
      
      // 🏓 PING ENABLED (Required by DHT)
      ping: ping(),

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
      identify: identify(),
      pubsub: gossipsub({ allowPublishToZeroPeers: true })
    }
  }

  // B. Create Helia
  const helia = await createHelia({ libp2p: libp2pConfig })
  
  const nameSystem = ipns(helia)
  const jsonStorage = strings(helia)
  
  const peerId = helia.libp2p.peerId.toString()
  console.log(`Helia started. My Peer ID: ${peerId}`)

  // --- D. IMPORT THE SHARED KEY ---
  let sharedPeerId;
  
  try {
    const myKeychain = helia.libp2p.services.keychain
    
    // 1. Check if key exists
    const keys = await myKeychain.listKeys()
    const alreadyExists = keys.some(k => k.name === SHARED_KEY_ALIAS)

    if (!alreadyExists) {
      console.log("Importing shared key...")
      const seedBytes = fromString(SHARED_KEY_STRING, 'base64pad')
      const privateKey = await generateKeyPairFromSeed('Ed25519', seedBytes)
      await myKeychain.importKey(SHARED_KEY_ALIAS, privateKey)
    }

    // 2. Retrieve key
    const storedPrivateKey = await myKeychain.exportKey(SHARED_KEY_ALIAS)
    
    sharedPeerId = peerIdFromPrivateKey(storedPrivateKey)
    if (storedPrivateKey.bytes) {
        sharedPeerId.privateKey = storedPrivateKey.bytes
    }

    console.log("--------------------------------------------------")
    console.log(`✅ SHARED REGISTRY ACTIVE`)
    console.log(`IPNS Name: ${sharedPeerId.toString()}`)
    console.log(`Gateway URL: https://ipfs.io/ipns/${sharedPeerId.toCID().toString()}`)
    console.log("--------------------------------------------------")

    document.getElementById('node-id').textContent = peerId
    document.getElementById('user-name').textContent = userName
    document.getElementById('status').textContent = 'Connected (Scanning Registry...)'

    startRegistryLoop(nameSystem, jsonStorage, sharedPeerId, userName)
    startNetworkMonitor(helia)

  } catch (e) {
    console.error("Failed to setup shared key:", e)
    alert("Key Import Failed. See console.")
  }

  return { helia }
}

function startNetworkMonitor(helia) {
    const el = document.createElement('div');
    el.id = 'network-stats';
    el.style = "background: #eee; padding: 10px; margin-top: 10px; font-size: 12px; font-family: monospace;";
    document.getElementById('app-container').appendChild(el);

    setInterval(() => {
        const peers = helia.libp2p.getPeers();
        el.innerHTML = `
            <strong>Network Diagnostics:</strong><br>
            Connected Peers: ${peers.length}<br>
            DHT Mode: Client (Ping + DHT Active)<br>
            <em>(Wait 3-5 mins after "Record Announced" for Gateways to update)</em>
        `;
    }, 2000);
}

async function fetchFromGateway(peerId) {
    const pidString = peerId.toCID().toString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); 

    for (const gateway of GATEWAYS) {
        try {
            let url;
            if (gateway.includes('dweb.link')) {
                 url = `https://${pidString}.ipns.dweb.link`;
            } else {
                 url = `${gateway}${pidString}`;
            }

            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Status ${response.status}`);
            
            const data = await response.json();
            clearTimeout(timeoutId);
            return { data, source: gateway };
        } catch (e) { }
    }
    clearTimeout(timeoutId);
    return null;
}

async function startRegistryLoop(nameSystem, jsonStorage, sharedPeerId, userName) {
  
  let lastPublishTime = 0;
  const PUBLISH_COOLDOWN = 300 * 1000; // 5 Minutes
  
  let knownUsers = new Map();

  const updateRegistry = async () => {
    console.log("⌛ Checking registry...")
    const statusEl = document.getElementById('status')
    
    try {
      // 1. RESOLVE
      let remoteUsers = [];
      let source = "None";

      const gatewayResult = await fetchFromGateway(sharedPeerId);
      if (gatewayResult && Array.isArray(gatewayResult.data)) {
          remoteUsers = gatewayResult.data;
          source = `HTTP (${new URL(gatewayResult.source || 'http://gateway').hostname})`;
      } else {
          try {
            const result = await nameSystem.resolve(sharedPeerId)
            const jsonStr = await jsonStorage.get(result.cid)
            remoteUsers = JSON.parse(jsonStr)
            source = "Local DHT";
          } catch (err) {}
      }

      if (source !== "None") {
        console.log(`📥 Downloaded registry from [${source}] with ${remoteUsers.length} users.`);
      }

      // 2. MERGE
      remoteUsers.forEach(user => {
          if (!knownUsers.has(user.name)) {
              knownUsers.set(user.name, user);
          } else {
              const localUser = knownUsers.get(user.name);
              if (user.lastSeen > localUser.lastSeen) {
                  knownUsers.set(user.name, user);
              }
          }
      });

      // 3. CLEANUP
      const fifteenMinsAgo = Date.now() - (15 * 60 * 1000);
      for (const [key, user] of knownUsers) {
          if (user.lastSeen < fifteenMinsAgo) {
              knownUsers.delete(key);
          }
      }

      // 4. HEARTBEAT
      knownUsers.set(userName, { 
          name: userName, 
          lastSeen: Date.now() 
      });

      const userList = Array.from(knownUsers.values());
      renderUserList(userList);


      // 5. PUBLISH
      const timeSinceLastPublish = Date.now() - lastPublishTime;
      const timeLeft = Math.ceil((PUBLISH_COOLDOWN - timeSinceLastPublish) / 1000);

      if (timeSinceLastPublish < PUBLISH_COOLDOWN) {
          statusEl.textContent = `Online (${source}) - Next Push in ${timeLeft}s`
          return; 
      }

      statusEl.textContent = 'Publishing to Network...'
      
      const newJson = JSON.stringify(userList)
      const newCid = await jsonStorage.add(newJson)
      
      await nameSystem.publish(sharedPeerId, newCid, {
          key: SHARED_KEY_ALIAS
      })
      
      lastPublishTime = Date.now();
      console.log(`🚀 IPNS Record Announced! CID: ${newCid.toString()}`)
      statusEl.textContent = 'Online & Synced'

    } catch (e) {
      console.error("Registry Loop Error:", e)
      statusEl.textContent = 'Retrying...'
    }
  }

  updateRegistry()
  setInterval(updateRegistry, 20000)
}

function renderUserList(users) {
  const el = document.getElementById('online-users-list')
  if (!el) return
  
  el.innerHTML = ''
  
  const sorted = users.sort((a, b) => b.lastSeen - a.lastSeen)
  
  sorted.forEach(u => {
    const li = document.createElement('li')
    const timeAgo = Math.floor((Date.now() - u.lastSeen) / 1000);
    li.textContent = `${u.name} (Seen ${timeAgo}s ago)`
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