#!/bin/sh
set -e

echo "🔧 CONFIGURING RELAY (v0.29.0 Stable)..."

# 1. Initialize
if [ ! -f /data/ipfs/config ]; then
  echo "⚡ Initializing IPFS..."
  ipfs init
fi

# 2. Configure WebSocket Addresses
# Port 4002 = TCP
# Port 4003 = WS
echo "🛠️ Applying Addresses..."
ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4001", "/ip4/0.0.0.0/udp/4001/quic", "/ip4/0.0.0.0/tcp/4002", "/ip4/0.0.0.0/tcp/4003/ws"]'

# 3. Enable Relay
ipfs config --json Swarm.RelayService.Enabled true
ipfs config --json Swarm.RelayClient.Enabled false
ipfs config --json Swarm.ResourceMgr.Enabled false

echo "🚀 STARTING DAEMON..."
exec ipfs daemon