// Central configuration. Everything that is deployment-specific lives here.

const DEFAULT_CONTRACT = "0x54A2774072103a071d3EAB9FBF762A17F193C57e";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function readOverride() {
  try {
    const saved = localStorage.getItem("ba.contract");
    return saved && ADDRESS_RE.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

export const CONFIG = {
  appName: "BumpAudit",
  tagline: "Do version numbers tell the truth?",
  /** Deployed BumpAudit contract. Order: Settings override > VITE_CONTRACT_ADDRESS > default. */
  defaultContract: import.meta.env.VITE_CONTRACT_ADDRESS && ADDRESS_RE.test(import.meta.env.VITE_CONTRACT_ADDRESS)
    ? import.meta.env.VITE_CONTRACT_ADDRESS
    : DEFAULT_CONTRACT,
  get contractAddress() {
    return readOverride() || this.defaultContract;
  },
  chain: {
    id: 61999,
    hex: "0xf22f",
    name: "GenLayer Studionet",
    rpc: "https://studio.genlayer.com/api",
    explorer: "https://explorer-studio.genlayer.com",
    currency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  },
  links: {
    github: "https://github.com/reza9133/bumpaudit",
    x: "https://x.com/amirhp771",
    genlayer: "https://www.genlayer.com",
    genlayerDocs: "https://docs.genlayer.com",
    studio: "https://studio.genlayer.com",
    semver: "https://semver.org",
  },
  /** Public Studionet RPC allows ~30 requests/min; stay below it. */
  rpcPerMinute: 22,
  minReauditSeconds: 300,
  pageSize: 12,
};

export const ECOSYSTEMS = ["npm", "pypi", "cargo", "go", "maven", "nuget", "rubygems", "composer", "hex", "pub", "swift", "other"];
export const VERDICTS = ["COMPLIANT", "UNDER_BUMPED", "OVER_BUMPED", "EXEMPT"];

export const explorerAddress = (a) => `${CONFIG.chain.explorer}/address/${a}`;
export const explorerTx = (h) => `${CONFIG.chain.explorer}/tx/${h}`;
