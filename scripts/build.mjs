import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

let buildSucceeded = false;
removeBuildArtifacts();

try {
  await viteBuild({ root });
  emitDeclarations();
  await bundleDeclarations();
  buildSucceeded = true;
} finally {
  rmSync(temporaryTypes, { recursive: true, force: true });
  if (!buildSucceeded) {
    rmSync(distribution, { recursive: true, force: true });
  }
}
