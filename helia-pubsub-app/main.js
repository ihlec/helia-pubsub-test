import { createHelia } from 'helia'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { webRTC } from '@libp2p/webrtc'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'

// Configuration constants
const PUBSUB_TOPIC = 'online-users-channel'

// Reverting to the original, hardcoded array.
// NOTE: If the "Non-base58btc character" error returns, you must restore vite.config.js.
const BOOTSTRAP_NODES = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
    '/dnsaddr/va1.bootstrap.libp2p.io/p2p/12D3KooWKnDdG3iXw9eTFijk3EWSunZcFi54Zka4wmtqtt6rPxc8',
    '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ'
];

/**
 * Creates and starts a Helia node with the necessary browser configuration.
 * @param {string} userName - The name of the user to announce.
 */
async function startHelia(userName) {
  
  if (BOOTSTRAP_NODES.length === 0) {
      console.error("Fatal Error: Bootstrap nodes array is empty.");
      throw new Error("Bootstrap configuration failed.");
  }
  
  // 1. Libp2p configuration (Browser-Safe Profile)
  const libp2pConfig = {
    transports: [
        webSockets(),
        webRTC() 
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      bootstrap({
        list: BOOTSTRAP_NODES
      })
    ],
    services: {
      identify: identify(),
      relay: circuitRelayTransport(), // Required for WebRTC NAT traversal
      pubsub: gossipsub({ 
        allowPublishToZeroPeers: true 
      })
    },
  }

  // 2. Create the Helia node
  const helia = await createHelia({
    libp2p: libp2pConfig,
  })
  
  const pubsub = helia.libp2p.services.pubsub
  const peerId = helia.libp2p.peerId.toString()
  
  console.log(`Helia Node started with Peer ID: ${peerId}`) 
  
  // 3. PubSub Logic (Subscription and Announcement)
  pubsub.subscribe(PUBSUB_TOPIC, (message) => {
    const decodedMessage = new TextDecoder().decode(message.data)
    try {
      const payload = JSON.parse(decodedMessage)
      handleMessage(payload, message.from.toString())
    } catch (e) {
      console.error('Failed to parse PubSub message:', e)
    }
  })

  const announcePresence = async () => {
    const payload = JSON.stringify({ user: userName, id: peerId, action: 'join' })
    const data = new TextEncoder().encode(payload)
    await pubsub.publish(PUBSUB_TOPIC, data) 
    console.log(`Announced presence for ${userName} on channel ${PUBSUB_TOPIC}`)
  }
  
  announcePresence()
  setInterval(announcePresence, 30000)

  // 4. UI Update
  document.getElementById('node-id').textContent = peerId
  document.getElementById('user-name').textContent = userName
  
  return { pubsub, peerId }
}

/**
 * Handles incoming PubSub messages and updates the UI.
 */
function handleMessage(payload, senderId) {
  const messagesElement = document.getElementById('messages')
  const isSelf = senderId === document.getElementById('node-id').textContent
  
  if (isSelf) return // Ignore messages sent by self

  let messageText = `[${payload.user || 'Unknown'}]: ${payload.action}`
  
  const messageItem = document.createElement('li')
  messageItem.textContent = messageText
  messageItem.className = payload.action === 'join' ? 'join-message' : ''

  // Prepend the new message
  messagesElement.prepend(messageItem)
  
  // Simple online user monitoring (for demonstration)
  updateOnlineUsers(payload, senderId)
}

const onlineUsers = new Map()

/**
 * Updates the list of online users based on join messages.
 */
function updateOnlineUsers(payload, peerId) {
  const usersElement = document.getElementById('online-users-list')
  
  if (payload.action === 'join') {
    onlineUsers.set(peerId, payload.user)
  }
  
  // Re-render the online list
  usersElement.innerHTML = ''
  onlineUsers.forEach((user, id) => {
    const userItem = document.createElement('li')
    userItem.textContent = `${user} (${id.substring(id.length - 4)})`
    usersElement.appendChild(userItem)
  })
}


// --- UI Initialization Logic ---
document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-helia')
  const userNameInput = document.getElementById('user-name-input')

  if (!startButton || !userNameInput) {
    console.error("DOM Error: Could not find required elements. Check index.html.");
    return;
  }

  startButton.onclick = async () => {
    const userName = userNameInput.value.trim()
    if (!userName) {
      alert('Please enter your user name!')
      return
    }

    // Disable input/button and show loading
    userNameInput.disabled = true
    startButton.disabled = true
    document.getElementById('status').textContent = 'Connecting...'
    
    try {
      await startHelia(userName)
      document.getElementById('status').textContent = 'Online'
      document.getElementById('app-container').classList.add('started')
    } catch (e) {
      console.error('Error starting Helia node:', e)
      document.getElementById('status').textContent = 'Error'
      alert('Failed to start Helia node. Check the console for details.')
      userNameInput.disabled = false
      startButton.disabled = false
    }
  }
})