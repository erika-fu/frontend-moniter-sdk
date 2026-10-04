import { createRequire } from "node:module";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { rollup } from "rollup";
import dts from "rollup-plugin-dts";
import ts from "typescript";
import { build as viteBuild } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryTypes = resolve(root, ".types");
const distribution = resolve(root, "dist");

function removeBuildArtifacts() {
  rmSync(temporaryTypes, { recursive: true, force: true });
  rmSync(distribution, { recursive: true, force: true });
}

function emitDeclarations() {
  const configPath = resolve(root, "tsconfig.build.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext([configFile.error], {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => root,
        getNewLine: () => ts.sys.newLine,
      }),
    );
  }

  const config = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    root,
    undefined,
    configPath,
  );
  const program = ts.createProgram(config.fileNames, config.options);
  const emitResult = program.emit();
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program),
    ...emitResult.diagnostics,
  ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => root,
        getNewLine: () => ts.sys.newLine,
      }),
    );
  }
}

async function bundleDeclarations() {
  const bundle = await rollup({
    input: resolve(temporaryTypes, "index.d.ts"),
    external: (id) => /^web-vitals(?:\/|$)/.test(id),
    plugins: [dts()],
  });

  try {
    await bundle.write({
      file: resolve(distribution, "index.d.ts"),
      format: "es",
    });
  } finally {
    await bundle.close();
  }
}

async function verifyBuild() {
  const expectedFiles = [
    "index.cjs",
    "index.d.ts",
    "index.iife.js",
    "index.js",
  ];
  const files = readdirSync(distribution).sort();

  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Unexpected dist files: ${files.join(", ")}`);
  }

  const esmPath = resolve(distribution, "index.js");
  const cjsPath = resolve(distribution, "index.cjs");
  const iifePath = resolve(distribution, "index.iife.js");
  const esmSource = readFileSync(esmPath, "utf8");
  const cjsSource = readFileSync(cjsPath, "utf8");
  const iifeSource = readFileSync(iifePath, "utf8");

  if (!esmSource.includes('from "web-vitals"')) {
    throw new Error("ESM build must keep web-vitals external");
  }
  if (!cjsSource.includes('require("web-vitals")')) {
    throw new Error("CommonJS build must keep web-vitals external");
  }
  if (iifeSource.includes("webVitals") || iifeSource.includes("web-vitals")) {
    throw new Error("IIFE build must include web-vitals");
  }

  const esm = await import(pathToFileURL(esmPath).href);
  const require = createRequire(import.meta.url);
  const cjs = require(cjsPath);
  const iifeContext = {};
  runInNewContext(iifeSource, iifeContext);

  if (
    typeof esm.init !== "function" ||
    typeof cjs.init !== "function" ||
    typeof iifeContext.FrontendMonitor?.init !== "function"
  ) {
    throw new Error("A distribution format does not expose the public API");
  }
}

let buildSucceeded = false;
removeBuildArtifacts();

try {
  await viteBuild({ root });
  await viteBuild({ root, mode: "iife" });
  emitDeclarations();
  await bundleDeclarations();
  await verifyBuild();
  buildSucceeded = true;
} finally {
  rmSync(temporaryTypes, { recursive: true, force: true });
  if (!buildSucceeded) {
    rmSync(distribution, { recursive: true, force: true });
  }
}
