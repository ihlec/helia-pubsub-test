import { generateKeyPair } from '@libp2p/crypto/keys'
import { toString } from 'uint8arrays/to-string'

async function generateSecret() {
  const key = await generateKeyPair('Ed25519')
  
  // The 'raw' property is 64 bytes. 
  // The first 32 bytes are the Private Key Seed.
  const seed = key.raw.subarray(0, 32)
  
  const exported = toString(seed, 'base64pad')
  
  console.log("---------------------------------------------------")
  console.log("YOUR SHARED SECRET (SEED):")
  console.log(exported)
  console.log("---------------------------------------------------")
}

generateSecret()