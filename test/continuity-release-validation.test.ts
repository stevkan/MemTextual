import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { parseContinuityReleaseValidationArguments } from "../src/cli/continuity-release-validation.js";
import {
  createWindowsContinuityBundle,
  validateContinuityReleaseCandidate,
} from "../src/index.js";

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function copyMigrations(target: string, maximumVersion = 21): void {
  mkdirSync(target, { recursive: true });
  for (const filename of readdirSync(resolve("migrations"))) {
    const version = Number.parseInt(filename.match(/^(\d+)/u)?.[1] ?? "0", 10);
    if (version > 0 && version <= maximumVersion) {
      copyFileSync(resolve("migrations", filename), join(target, filename));
    }
  }
}

function createCandidateSource(source: string): void {
  write(
    join(source, "package.json"),
    `${JSON.stringify({
      dependencies: { "production-package": "1.0.0" },
      engines: { node: process.versions.node },
      name: "memtextual",
      type: "module",
      version: "0.8.0",
    })}\n`,
  );
  write(
    join(source, "package-lock.json"),
    `${JSON.stringify({
      lockfileVersion: 3,
      name: "memtextual",
      packages: {
        "": {
          dependencies: { "production-package": "1.0.0" },
          name: "memtextual",
          version: "0.8.0",
        },
        "node_modules/production-package": { version: "1.0.0" },
      },
      version: "0.8.0",
    })}\n`,
  );
  write(join(source, "README.md"), "# Synthetic candidate\n");
  write(join(source, "CHANGELOG.md"), "# Synthetic changelog\n");
  write(join(source, "LICENSE.txt"), "Synthetic test license.\n");
  for (const name of [
    "continuity-acceptance",
    "continuity-console",
    "continuity-release-validation",
    "continuity-setup",
    "continuity-upgrade",
    "memtextual",
    "memtextual-developer",
    "safeguard",
    "windows-host",
    "windows-elevated-host-validation",
    "windows-msi-host-action",
  ]) {
    write(join(source, "dist", "src", "cli", `${name}.js`), "export {};\n");
  }
  write(
    join(source, "node_modules", "production-package", "package.json"),
    '{"name":"production-package","version":"1.0.0"}\n',
  );
  write(join(source, "scripts", "windows-host-executor.ps1"), "param()\n");
  copyMigrations(join(source, "migrations"));
}

describe("Continuity release-candidate validation", () => {
  it("parses the explicit disposable validation boundary", () => {
    assert.deepEqual(
      parseContinuityReleaseValidationArguments([
        "validate",
        "--bundle",
        "candidate",
        "--trusted-fingerprint",
        "a".repeat(64),
        "--baseline-migrations",
        "baseline",
        "--workspace",
        "C:\\release-validation",
      ]),
      {
        baselineMigrationsDirectory: "baseline",
        bundleDirectory: "candidate",
        trustedCertificateFingerprint256: "a".repeat(64),
        workspaceDirectory: "C:\\release-validation",
      },
    );
  });

  it("exercises the non-privileged lifecycle on synthetic disposable data", async () => {
    const root = mkdtempSync(join(tmpdir(), "memtextual-release-validation-"));
    const source = join(root, "source");
    const output = join(root, "candidate-output");
    const baseline = join(root, "baseline-migrations");
    const workspace = join(root, "run", "workspace");
    const signingPem = resolve("test", "fixtures", "azure-test-credential.pem");
    try {
      mkdirSync(source);
      mkdirSync(output);
      mkdirSync(dirname(workspace));
      createCandidateSource(source);
      copyMigrations(baseline, 20);
      const candidate = await createWindowsContinuityBundle({
        applicationLicensePath: join(source, "LICENSE.txt"),
        createdAt: new Date("2027-02-01T00:00:00.000Z"),
        outputDirectory: output,
        runtimeExecutablePath: process.execPath,
        runtimeLicensePath: join(dirname(process.execPath), "LICENSE"),
        signingCertificatePath: signingPem,
        signingPrivateKeyPath: signingPem,
        sourceDirectory: source,
      });

      const report = await validateContinuityReleaseCandidate({
        baselineMigrationsDirectory: baseline,
        bundleDirectory: candidate.bundleDirectory,
        now: new Date("2027-02-02T00:00:00.000Z"),
        trustedCertificateFingerprint256: candidate.signingCertificateFingerprint256,
        workspaceDirectory: workspace,
      });

      assert.equal(report.passed, true);
      assert.equal(report.syntheticDataOnly, true);
      assert.equal(report.phases.length, 7);
      assert.equal(report.privilegedHostValidation.status, "not_run");
      assert.equal(existsSync(join(workspace, "application")), false);
      assert.equal(existsSync(join(workspace, "data", "memtextual.db")), true);
      assert.equal(existsSync(report.reportPath), true);
      assert.equal(
        existsSync(join(workspace, ".memtextual-release-validation.json")),
        true,
      );
      assert.equal(
        readFileSync(report.reportPath, "utf8").includes("PRIVATE KEY"),
        false,
      );
    } finally {
      rmSync(root, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
    }
  });

  it("refuses to reuse an existing workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "memtextual-release-existing-"));
    try {
      await assert.rejects(
        validateContinuityReleaseCandidate({
          baselineMigrationsDirectory: root,
          bundleDirectory: root,
          trustedCertificateFingerprint256: "a".repeat(64),
          workspaceDirectory: root,
        }),
        /must not already exist/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
