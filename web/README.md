# BumpAudit Web

The web frontend for the **BumpAudit** GenLayer Intelligent Contract
([github.com/reza9133/bumpaudit](https://github.com/reza9133/bumpaudit)), wired to the deployment on GenLayer Studionet:

```
0x54A2774072103a071d3EAB9FBF762A17F193C57e
```

## Features

- Multi-page site (hash routing, no server rules): Home, Explorer, Package, Release, Register & Audit, Tools, Docs (10 pages), About, Settings
- **EIP-6963** wallet discovery with a working connect / **real disconnect** (`wallet_revokePermissions`), live account and chain events, silent reconnect, and a network banner with one-click **switch to GenLayer Studionet** (adds the chain when the wallet does not know it)
- Transaction tracker through every consensus stage (queued, proposing, voting, revealing, accepted, **finalized**); results are confirmed on FINALIZED by default, with an option to continue on ACCEPTED
- Three themes: Light, Dim (semi-light) and Dark; reduced-motion switch
- Custom BumpAudit logo, GenLayer logo, Mochi mascot, Three.js 3D scenes, CSS 3D tilt/flip/cube spinners
- Full documentation inside the site (Markdown in `src/docs/`)
- Read-only tools: parser preview, verdict calculator, version inspector, URL checker, Keccak-256 hash verifier
- Release pages can recompute the stored section's hash in the browser
- A client-side request limiter keeps the app under the public Studionet RPC limit (about 30 requests a minute)

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

Node 18+ is required (Node 20 recommended).

## Configuration

The contract address is resolved in this order: the override saved on the Settings page, `VITE_CONTRACT_ADDRESS` at build time, then the default in `src/config.js`.

```bash
VITE_CONTRACT_ADDRESS=0xYourContract npm run build
```

Chain parameters, links and limits live in `src/config.js`.

## Mochi

Mochi's artwork is in `src/assets/`: `mochi.png` (full figure, transparent background) and `mochi-head.png` (close-up used at sizes of 100 px and below). Replace either file and rebuild to change the mascot everywhere. If `mochi.png` is deleted, the site falls back to a built-in drawing.

## Demo mode (no network)

```bash
VITE_DEMO=1 npm run dev
```

Serves the UI with sample data from `src/lib/mock.js`. It is excluded from normal builds.

## Hosting

The build uses relative paths and hash routes, so GitHub Pages, Netlify, Cloudflare Pages, IPFS or any static server works unchanged.

## Layout

```
src/config.js        contract address, chain parameters, links
src/lib/             wallet (EIP-6963), chain reads, transactions, RPC limiter, helpers
src/components/      header, wallet modal, 3D scenes, spinners, tracker, badges
src/pages/           home, explorer, package, release, audit, tools, docs, about, settings
src/docs/            documentation pages (Markdown)
src/styles/          tokens and three themes, components, pages, motion
```
