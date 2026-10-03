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

The public package API starts in `src/index.ts`.

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
