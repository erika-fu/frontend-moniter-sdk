# React demo

This independent Vite application imports the SDK directly from `../src`.
Start the report receiver and the demo in separate terminals:

```bash
npm run server
npm install --prefix react-demo
npm --prefix react-demo run dev
```

Open `http://localhost:4174/`. Set `VITE_MONITOR_URL` to use a report
endpoint other than `http://localhost:9800/reportData`.

Run `npm --prefix react-demo test` for the demo store tests and
`npm --prefix react-demo run build` for a production build.
