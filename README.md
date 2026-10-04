# frontend-moniter-sdk

TypeScript SDK for frontend monitoring.

## Requirements

- Node.js 18 or newer
- npm

## Development

```bash
npm install
npm run check

cd demo
npm install
npm run build
```

## Commands

- `npm run build` creates the minified SDK and bundled declarations in `dist/`
- `npm run server` starts the report receiver on port `9800`
- `npm test` runs the test suite once
- `npm run test:watch` runs Vitest in watch mode
- `npm run typecheck` checks TypeScript without emitting files
- `npm run check` runs type checking, tests, and the production build
- `npm pack --dry-run` previews the files that will be published
- `npm publish` runs `prepublishOnly`, then publishes the ESM package

## Usage

Initialize browser performance and runtime error monitoring with built-in
batched reporting:

```ts
import frontendMonitor from "frontend-moniter-sdk";

frontendMonitor.init({
  url: "/monitor",
  projectName: "storefront",
  appId: "web",
  userId: "user-1",
  batchSize: 5,
});
```

The SDK batches reports, prefers `navigator.sendBeacon`, and falls back to an
unmonitored `XMLHttpRequest`. Set `isImageUpload: true` to send the encoded
payload in the `data` query parameter of an image request. Without `url`, no
network request is made and `onReport` continues to receive every report.

Install Vue error capture through the application plugin API. The plugin
accepts the same reporting options:

```ts
app.use(frontendMonitor, { url: "/monitor", onReport });
```

Forward errors from a React Error Boundary:

```ts
componentDidCatch(error, info) {
  frontendMonitor.errorBoundary(error, info);
}
```

The public package API starts in `src/index.ts`. `init` only updates the default
reporting configuration; it does not start monitors or select individual
metrics. Call the monitor APIs directly when the application needs to start
collection.

The production build uses Vite library mode for the browser-ready ESM bundle
and TypeScript for declaration files. The package exposes the SDK through its
root ESM entry and declares `web-vitals` as an external runtime dependency.
Installing the package therefore installs `web-vitals` in the business
application. Vue remains a development dependency only because the SDK's Vue
integration is covered by tests.

The `demo/` directory is an independent Vue application with its own package
manifest, lock file, TypeScript configuration, Vite configuration, and build
output. It imports the SDK directly from `src/index.ts`, so SDK source changes
are reflected without building the package first. Install both the SDK and demo
dependencies before starting the demo:

```bash
npm install
npm install --prefix demo
npm --prefix demo run dev
```

Then visit `http://localhost:4173/`.

## Report server

Start the local report receiver:

```bash
npm run server
```

Configure the SDK to send reports to
`http://localhost:9800/reportData`. The server accepts JSON sent by Beacon or
XHR and the `data` query parameter used by image reporting. Received report
envelopes are printed to the terminal. Set `PORT` to override the default port:

```bash
PORT=3000 npm run server
```

The Vue demo uses hash routing:

- `#/` for the monitoring dashboard
- `#/reports` for the full report list
- `#/about` for SDK notes

## License

MIT
