# frontend-moniter-sdk

TypeScript SDK for frontend monitoring.

## Requirements

- Node.js 18 or newer
- npm

## Development

```bash
npm install
npm run check
```

## Commands

- `npm run build` bundles the SDK and its runtime dependencies into `dist/`
- `npm run dev` starts the Vite development server with source-module HMR
- `npm test` runs the test suite once
- `npm run test:watch` runs Vitest in watch mode
- `npm run typecheck` checks TypeScript without emitting files
- `npm run check` runs type checking, tests, and the production build
- `npm run demo` starts the demo on port `4173`

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
  onReport(report) {
    console.log("monitor report", report);
  },
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

The public package API starts in `src/index.ts`. `init` enables all performance
and browser error monitors by default. Call it once during application startup.
Pass `performance: false` or `error: false` to skip either group during that
initialization, or pass
`performance: { monitors: ["fcp", "lcp"] }` to select performance observers.

The production build uses Vite library mode for the browser-ready ESM bundle
and TypeScript for declaration files. The demo imports the source
`src/performance` module directly during development, so changes can be
applied through Vite HMR without rebuilding `dist`.

To open the demo, run `npm run demo`, then visit
`http://localhost:4173/src/demo/index.html`. Do not open
`src/demo/index.html` directly with `file://`; browsers block module imports
from local files, and browsers do not execute TypeScript source files directly.

The Vue demo uses hash routing:

- `#/` for the monitoring dashboard
- `#/reports` for the full report list
- `#/about` for SDK notes

## License

MIT
