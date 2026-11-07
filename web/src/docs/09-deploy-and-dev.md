title: Deploy & develop
group: Reference
summary: Deploying the contract, running this frontend and hosting it.

## Deploy the contract to Studionet

**With the Studio UI.** Open [studio.genlayer.com](https://studio.genlayer.com), create a new contract file, paste `contracts/bump_audit.py`, select Studionet and deploy. The constructor takes no arguments.

**With the scripts** (Node 20+), from the contract repository:

```bash
npm install
npm run deploy                 # prints the contract address and explorer links
export BA_CONTRACT_ADDRESS=0x...
npm run demo -- --preview-only # free dry run of the parser on the local fixture
```

## Run this frontend

```bash
cd bumpaudit-web
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/
```

## Point it at another deployment

The contract address is resolved in this order:

1. the address saved in your browser on the [Settings](#/settings) page (for quick tests);
2. the `VITE_CONTRACT_ADDRESS` environment variable at build time;
3. the default in `src/config.js`.

```bash
VITE_CONTRACT_ADDRESS=0xYourNewContract npm run build
```

## Host it anywhere

The build uses relative asset paths and hash routing (`#/explorer`), so any static host works with no rewrite rules: GitHub Pages, Netlify, Cloudflare Pages, IPFS or a plain nginx folder.

## Replace the mascot

Mochi's artwork lives in `src/assets/`: `mochi.png` is the full figure and `mochi-head.png` is the close-up used at small sizes (100 px and below). Replace either file (`.webp`, `.jpg` and `.svg` also work) and rebuild to change the mascot everywhere on the site. If `mochi.png` is deleted, the site falls back to a built-in drawing.

## Project layout

```
src/config.js        contract address, chain parameters, limits
src/lib/             wallet (EIP-6963), chain reads, transactions, RPC limiter, helpers
src/components/      header, wallet modal, 3D scenes, spinners, tracker, badges
src/pages/           home, explorer, package, release, audit, tools, docs, about, settings
src/docs/            the documentation you are reading (Markdown)
src/styles/          design tokens, three themes, components
```
