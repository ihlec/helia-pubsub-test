#!/bin/sh
set -e

echo "🔧 CONFIGURING RELAY (Pure WebSocket Mode)..."

# 1. Initialize
if [ ! -f /data/ipfs/config ]; then
  echo "⚡ Initializing IPFS..."
  ipfs init
fi

# 2. Configure Addresses (Only 4003 for Browser)
echo "🛠️ Applying Addresses..."
# We keep 4001/4002 for server peering, 4003 for you.
ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4001", "/ip4/0.0.0.0/udp/4001/quic-v1", "/ip4/0.0.0.0/tcp/4002", "/ip4/0.0.0.0/tcp/4003/ws"]'

# 3. Enable Relay
ipfs config --json Swarm.RelayService.Enabled true
ipfs config --json Swarm.RelayClient.Enabled false

# 4. FORCE DHT SERVER (To store your data)
ipfs config --json Routing.Type '"dht"'

# 5. 🟢 ENABLE PUBSUB & IPNS OVER PUBSUB
# This is the secret weapon. It allows "Publishing" via chat messages
# instead of heavy DHT queries. Much lighter on the connection.
ipfs config --json Pubsub.Enabled true
ipfs config --json Ipns.UsePubsub true

# 6. 🟢 DISABLE RESOURCE MANAGER
# This prevents the "Disconnect" during heavy operations
ipfs config --json Swarm.ResourceMgr.Enabled false

echo "🚀 STARTING DAEMON..."
# Enable experimental flags for PubSub namesys
exec ipfs daemon --enable-pubsub-experiment --enable-namesys-pubsub