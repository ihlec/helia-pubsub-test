#!/bin/sh
set -e
echo "🔧 Forcing Configuration (v14 - Pubsub One-Shot)..."

# 1. Initialize
if [ ! -f /data/ipfs/config ]; then
  echo "⚡ Initializing IPFS..."
  ipfs init
fi

# 2. Network & Transport
ipfs config --json Swarm.AddrFilters null
ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4001", "/ip4/0.0.0.0/udp/4001/quic-v1", "/ip4/0.0.0.0/tcp/4003/ws"]'
ipfs config --json Addresses.Announce '["/ip4/127.0.0.1/tcp/4003/ws"]'
ipfs config --json Swarm.Transports.Network.Websocket true

# 3. Enable Relay & Client
ipfs config --json Swarm.RelayService.Enabled true
ipfs config --json Swarm.RelayClient.Enabled true
ipfs config --json AutoNAT.ServiceMode '"enabled"'

# 4. 🟢 FIX: SET ENTIRE PUBSUB OBJECT
# Instead of editing the key, we overwrite the whole section.
# This bypasses the "key not found" error.
ipfs config --json Pubsub '{"StrictSignatureVerification": false}'

# 5. Safety & Limits
ipfs config --json Swarm.ResourceMgr.Enabled false
ipfs config --json Swarm.RelayService.MaxReservations 100000
ipfs config --json Swarm.RelayService.MaxReservationsPerIP 100000
ipfs config --json Swarm.RelayService.MaxCircuits 100000

# 6. Background Subscriptions
(
  echo "🔌 Waiting for daemon..."
  until ipfs id > /dev/null 2>&1; do sleep 1; done
  
  echo "🔌 Subscribing to topics..."
  ipfs pubsub sub _peer-discovery._p2p._pubsub &
  ipfs pubsub sub helia-presence-v1 &
  wait
) &

echo "🚀 Starting Daemon..."
exec ipfs daemon --enable-gc --enable-pubsub-experiment