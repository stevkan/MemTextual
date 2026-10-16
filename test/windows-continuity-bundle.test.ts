import assert from "node:assert/strict";
import {
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

import { parseWindowsBundleCliArguments } from "../src/cli/windows-bundle.js";
import {
  applyWindowsContinuityBundleStage,
  applyWindowsContinuityBundleRemoval,
  createWindowsContinuityBundle,
  previewWindowsContinuityBundleStage,
  previewWindowsContinuityBundleRemoval,
  verifyWindowsContinuityBundle,
} from "../src/index.js";

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function createMinimalSource(source: string): void {
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
        "node_modules/development-package": {
          dev: true,
          version: "1.0.0",
        },
        "node_modules/production-package": { version: "1.0.0" },
        "node_modules/production-package/node_modules/nested-package": {
          version: "1.0.0",
        },
      },
      requires: true,
      version: "0.8.0",
    })}\n`,
  );
  write(join(source, "README.md"), "# MemTextual\n");
  write(join(source, "CHANGELOG.md"), "# Changelog\n");
  write(join(source, "LICENSE.txt"), "Test license only.\n");
  write(
    join(source, "dist", "src", "cli", "safeguard.js"),
    "export const safeguard = true;\n",
  );
  write(
    join(source, "dist", "src", "cli", "continuity-acceptance.js"),
    "export const acceptance = true;\n",
  );
  write(
    join(source, "dist", "src", "cli", "continuity-console.js"),
    "export const console = true;\n",
  );
  write(
    join(source, "dist", "src", "cli", "continuity-setup.js"),
    "export const setup = true;\n",
  );
  write(
    join(source, "dist", "src", "cli", "continuity-upgrade.js"),
    "export const upgrade = true;\n",
  );
  write(
    join(source, "dist", "src", "cli", "continuity-release-validation.js"),
    "export const releaseValidation = true;\n",
  );
  write(
    join(source, "node_modules", "production-package", "package.json"),
    '{"name":"production-package","version":"1.0.0"}\n',
  );
  write(
    join(
      source,
      "node_modules",
      "production-package",
      "node_modules",
      "nested-package",
      "package.json",
    ),
    '{"name":"nested-package","version":"1.0.0"}\n',
  );
  write(
    join(source, "node_modules", "development-package", "package.json"),
    '{"name":"development-package","version":"1.0.0"}\n',
  );
  write(
    join(source, "dist", "src", "cli", "windows-host.js"),
    "export const host = true;\n",
  );
  write(join(source, "migrations", "001_initial.sql"), "SELECT 1;\n");
  write(
    join(source, "scripts", "windows-host-executor.ps1"),
    "param()\n",
  );
}

describe("Windows Continuity bundle", () => {
  it("creates, verifies, confirms, and stages a signed bundle", async () => {
    const root = mkdtempSync(join(tmpdir(), "memtextual-windows-bundle-"));
    const source = join(root, "source");
    const output = join(root, "output");
    const target = join(root, "installed", "MemTextual Continuity");
    const signingPem = resolve(
      "test",
      "fixtures",
      "azure-test-credential.pem",
    );
    try {
      mkdirSync(source);
      mkdirSync(output);
      createMinimalSource(source);
      const created = await createWindowsContinuityBundle({
        applicationLicensePath: join(source, "LICENSE.txt"),
        createdAt: new Date("2027-01-01T00:00:00.000Z"),
        outputDirectory: output,
        runtimeExecutablePath: process.execPath,
        runtimeLicensePath: join(dirname(process.execPath), "LICENSE"),
        signingCertificatePath: signingPem,
        signingPrivateKeyPath: signingPem,
        sourceDirectory: source,
      });
      assert.equal(created.verified, true);
      assert.equal(created.publisherTrusted, true);
      assert.equal(created.manifest.nodeVersion, process.versions.node);
      assert.equal(
        created.manifest.files.some(({ path }) => path === "runtime/node.exe"),
        true,
      );
      assert.equal(
        created.manifest.files.some(
          ({ path }) =>
            path === "node_modules/production-package/package.json",
        ),
        true,
      );
      assert.equal(
        created.manifest.files.some(
          ({ path }) => path.includes("development-package"),
        ),
        false,
      );
      assert.equal(
        created.manifest.files.some(
          ({ path }) => path.includes("nested-package/package.json"),
        ),
        true,
      );
      assert.equal(
        readFileSync(
          join(created.bundleDirectory, "bundle-signing-certificate.pem"),
          "utf8",
        ).includes("PRIVATE KEY"),
        false,
      );
      assert.equal(
        created.manifest.files.some(({ path }) => path.includes("PRIVATE")),
        false,
      );

      const unpinned = await verifyWindowsContinuityBundle({
        bundleDirectory: created.bundleDirectory,
      });
      assert.equal(unpinned.publisherTrusted, false);
      mkdirSync(dirname(target), { recursive: true });
      const preview = await previewWindowsContinuityBundleStage({
        bundleDirectory: created.bundleDirectory,
        targetDirectory: target,
        trustedCertificateFingerprint256:
          created.signingCertificateFingerprint256,
      });
      assert.match(
        preview.confirmation,
        /^STAGE-WINDOWS-BUNDLE-[A-F0-9]{20}$/u,
      );
      await assert.rejects(
        applyWindowsContinuityBundleStage({
          bundleDirectory: created.bundleDirectory,
          confirmation: "STAGE-WINDOWS-BUNDLE-WRONG",
          targetDirectory: target,
          trustedCertificateFingerprint256:
            created.signingCertificateFingerprint256,
        }),
        /confirmation is missing, incorrect, or stale/u,
      );
      const staged = await applyWindowsContinuityBundleStage({
        bundleDirectory: created.bundleDirectory,
        confirmation: preview.confirmation,
        targetDirectory: target,
        trustedCertificateFingerprint256:
          created.signingCertificateFingerprint256,
      });
      assert.equal(staged.bundleDirectory, target);
      assert.equal(staged.manifestSha256, created.manifestSha256);
      await assert.rejects(
        previewWindowsContinuityBundleStage({
          bundleDirectory: created.bundleDirectory,
          targetDirectory: target,
          trustedCertificateFingerprint256:
            created.signingCertificateFingerprint256,
        }),
        /target already exists/u,
      );

      const preservedData = join(root, "data", "memtextual.db");
      write(preservedData, "user data outside application directory\n");
      const unexpectedApplicationFile = join(target, "user-added.txt");
      write(unexpectedApplicationFile, "must not be removed\n");
      await assert.rejects(
        previewWindowsContinuityBundleRemoval({
          bundleDirectory: target,
          trustedCertificateFingerprint256:
            created.signingCertificateFingerprint256,
        }),
        /missing or unexpected files/u,
      );
      assert.equal(
        readFileSync(unexpectedApplicationFile, "utf8"),
        "must not be removed\n",
      );
      rmSync(unexpectedApplicationFile);
      const removalPreview = await previewWindowsContinuityBundleRemoval({
        bundleDirectory: target,
        trustedCertificateFingerprint256:
          created.signingCertificateFingerprint256,
      });
      assert.match(
        removalPreview.confirmation,
        /^REMOVE-WINDOWS-BUNDLE-[A-F0-9]{20}$/u,
      );
      assert.equal(removalPreview.preservesExternalData, true);
      write(unexpectedApplicationFile, "added after preview\n");
      await assert.rejects(
        applyWindowsContinuityBundleRemoval({
          bundleDirectory: target,
          confirmation: removalPreview.confirmation,
          trustedCertificateFingerprint256:
            created.signingCertificateFingerprint256,
        }),
        /missing or unexpected files/u,
      );
      assert.equal(
        readFileSync(unexpectedApplicationFile, "utf8"),
        "added after preview\n",
      );
      rmSync(unexpectedApplicationFile);
      await assert.rejects(
        applyWindowsContinuityBundleRemoval({
          bundleDirectory: target,
          confirmation: "REMOVE-WINDOWS-BUNDLE-WRONG",
          trustedCertificateFingerprint256:
            created.signingCertificateFingerprint256,
        }),
        /confirmation is missing, incorrect, or stale/u,
      );
      await applyWindowsContinuityBundleRemoval({
        bundleDirectory: target,
        confirmation: removalPreview.confirmation,
        trustedCertificateFingerprint256:
          created.signingCertificateFingerprint256,
      });
      assert.equal(readFileSync(preservedData, "utf8"), "user data outside application directory\n");
      assert.equal(
        readdirSync(dirname(target)).includes("MemTextual Continuity"),
        false,
      );

      writeFileSync(
        join(created.bundleDirectory, "dist", "src", "cli", "safeguard.js"),
        `${readFileSync(
          join(created.bundleDirectory, "dist", "src", "cli", "safeguard.js"),
          "utf8",
        )}// tampered\n`,
        "utf8",
      );
      await assert.rejects(
        verifyWindowsContinuityBundle({
          bundleDirectory: created.bundleDirectory,
          trustedCertificateFingerprint256:
            created.signingCertificateFingerprint256,
        }),
        /does not match its manifest/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("requires complete command-specific CLI inputs", () => {
    assert.deepEqual(
      parseWindowsBundleCliArguments([
        "verify",
        "--bundle",
        "C:\\bundle",
      ]).command,
      "verify",
    );
    assert.throws(
      () =>
        parseWindowsBundleCliArguments([
          "stage-apply",
          "--bundle",
          "C:\\bundle",
          "--target",
          "C:\\target",
          "--trusted-fingerprint",
          "a".repeat(64),
        ]),
      /--confirm is required/u,
    );
    assert.throws(
      () =>
        parseWindowsBundleCliArguments([
          "remove-apply",
          "--bundle",
          "C:\\bundle",
          "--trusted-fingerprint",
          "a".repeat(64),
        ]),
      /--confirm is required/u,
    );
  });

  it("requires an exact Node engine in package metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "memtextual-windows-bundle-engine-"));
    const source = join(root, "source");
    const output = join(root, "output");
    try {
      mkdirSync(source);
      mkdirSync(output);
      createMinimalSource(source);
      const packagePath = join(source, "package.json");
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
        engines: { node: string };
      };
      packageJson.engines.node = ">=24.21.0";
      write(packagePath, `${JSON.stringify(packageJson)}\n`);

      await assert.rejects(
        createWindowsContinuityBundle({
          applicationLicensePath: join(source, "LICENSE.txt"),
          outputDirectory: output,
          runtimeExecutablePath: process.execPath,
          runtimeLicensePath: join(dirname(process.execPath), "LICENSE"),
          signingCertificatePath: join(source, "unused-certificate.pem"),
          signingPrivateKeyPath: join(source, "unused-key.pem"),
          sourceDirectory: source,
        }),
        /Package manifest Node engine is invalid/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
