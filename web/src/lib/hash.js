// Keccak-256 (Ethereum flavour, the same function the contract uses) for local verification of stored release sections.
export async function keccakHex(text) {
  const { keccak256, stringToBytes } = await import("viem");
  return keccak256(stringToBytes(String(text))).slice(2);
}

const norm = (value) => String(value || "").trim().toLowerCase().replace(/^0x/, "");
export const sameHash = (a, b) => norm(a) !== "" && norm(a) === norm(b);
