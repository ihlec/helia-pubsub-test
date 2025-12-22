#!/bin/sh
set -e

echo "🔧 Forcing Configuration (v3 - Final Fix)..."

# 1. Initialize IPFS
if [ ! -f /data/ipfs/config ]; then
  echo "⚡ Initializing IPFS..."
  ipfs init
fi

# 2. CLEAR ALL FILTERS (Critical for Docker/Localhost)
ipfs config --json Swarm.AddrFilters null

# 3. CONFIGURE LISTENERS
# We listen on all interfaces (0.0.0.0) so Docker maps the ports
ipfs config --json Addresses.Swarm '[
  "/ip4/0.0.0.0/tcp/4001",
  "/ip4/0.0.0.0/udp/4001/quic-v1",
  "/ip4/0.0.0.0/tcp/4003/ws"
]'

# 4. ANNOUNCE LOCALHOST (🟢 THE FIX for "Reservation Timed Out")
# This aligns the internal IP with the external IP the browser sees.
ipfs config --json Addresses.Announce '[
  "/ip4/127.0.0.1/tcp/4003/ws"
]'

# 5. ENABLE TRANSPORTS
ipfs config --json Swarm.Transports.Network.Websocket true
ipfs config --json Swarm.RelayService.Enabled true

# 6. DISABLE RESOURCE MANAGER (Critical for Docker)
ipfs config --json Swarm.ResourceMgr.Enabled false

# 7. INCREASE LIMITS
ipfs config --json Swarm.RelayService.MaxReservations 10000
ipfs config --json Swarm.RelayService.MaxReservationsPerIP 10000
ipfs config --json Swarm.RelayService.MaxCircuits 10000

echo "📝 Verified Config:"
echo "   - ResourceMgr: $(ipfs config Swarm.ResourceMgr.Enabled)"
echo "   - Announce:    $(ipfs config Addresses.Announce)"

echo "🚀 Starting Daemon..."
exec ipfs daemon --enable-gc