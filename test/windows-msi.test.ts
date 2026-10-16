import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { parseWindowsMsiArguments } from "../src/cli/windows-msi.js";
import {
  applyWindowsMsiBuild,
  previewWindowsMsiBuild,
  renderWindowsMsiSource,
  windowsMsiUpgradeCode,
  type WindowsMsiBundleVerifier,
  type WindowsMsiOperations,
} from "../src/index.js";

function setup(invalidOutput = false) {
  const root = mkdtempSync(join(tmpdir(), "memtextual-msi-"));
  const bundleDirectory = join(root, "bundle");
  mkdirSync(join(bundleDirectory, "dist"), { recursive: true });
  writeFileSync(join(bundleDirectory, "dist", "app.js"), "app\n");
  mkdirSync(join(bundleDirectory, "dist", "src", "cli"), { recursive: true });
  mkdirSync(join(bundleDirectory, "runtime"), { recursive: true });
  writeFileSync(join(bundleDirectory, "dist", "src", "cli", "windows-msi-host-action.js"), "host\n");
  writeFileSync(join(bundleDirectory, "runtime", "node.exe"), "node\n");
  for (const name of ["bundle-manifest.json", "bundle-manifest.sig", "bundle-signing-certificate.pem"]) writeFileSync(join(bundleDirectory, name), `${name}\n`);
  const wixExecutablePath = join(root, "wix.exe");
  const outputPath = join(root, "MemTextual-unsigned.msi");
  writeFileSync(wixExecutablePath, "synthetic wix\n");
  let validations = 0;
  const operations: WindowsMsiOperations = {
    async build(sourcePath, targetPath) {
      assert.match(readFileSync(sourcePath, "utf8"), /Scope="perMachine"/u);
      assert.match(readFileSync(sourcePath, "utf8"), /bundle-manifest\.json/u);
      writeFileSync(targetPath, invalidOutput ? Buffer.from("invalid") : Buffer.from("d0cf11e0a1b11ae17061796c6f6164", "hex"));
    },
    async validate(targetPath) {
      assert.equal(targetPath.endsWith("MemTextual-unsigned.msi"), true);
      assert.notEqual(targetPath, outputPath);
      validations += 1;
    },
    async version() { return "7.0.0"; },
  };
  const verifyBundle: WindowsMsiBundleVerifier = async () => ({
    bundleDirectory: resolve(bundleDirectory), fileCount: 4,
    manifest: {
      architecture: "x64", createdAt: "2027-01-01T00:00:00.000Z",
      files: [
        { bytes: 4, path: "dist/app.js", sha256: "a".repeat(64) },
        { bytes: 5, path: "dist/src/cli/windows-msi-host-action.js", sha256: "d".repeat(64) },
        { bytes: 5, path: "runtime/node.exe", sha256: "e".repeat(64) },
      ],
      formatVersion: 1, nodeVersion: "24.21.0", packageName: "memtextual-continuity",
      packageVersion: "0.8.0", platform: "windows", signingCertificateFingerprint256: "b".repeat(64),
    },
    manifestSha256: "c".repeat(64), publisherTrusted: true,
    signingCertificateFingerprint256: "b".repeat(64), totalBytes: 4, verified: true,
  });
  const options = {
    bundleDirectory, manufacturer: "Release Owner", operations, outputPath,
    trustedCertificateFingerprint256: "b".repeat(64), verifyBundle,
    wixEulaAccepted: true as const, wixExecutablePath,
  };
  return { options, outputPath, root, validations: () => validations };
}

describe("Windows MSI build boundary", () => {
  it("renders a per-machine, x64 component inventory with stable product identity", () => {
    const source = renderWindowsMsiSource({
      bundleDirectory: "C:\\bundle", files: [
        "dist/app&one.js", "dist/src/cli/windows-msi-host-action.js", "README.md", "runtime/node.exe",
      ],
      manufacturer: "Owner & Publisher", packageVersion: "0.8.0",
    });
    assert.match(source, /Scope="perMachine"/u);
    assert.match(source, new RegExp(windowsMsiUpgradeCode.replaceAll("{", "\\{").replaceAll("}", "\\}"), "u"));
    assert.match(source, /Bitness="always64"/u);
    assert.match(source, /Owner &amp; Publisher/u);
    assert.match(source, /app&amp;one\.js/u);
    assert.match(source, /Execute="rollback" Impersonate="no"/u);
    assert.match(source, /MEMTEXTUAL_HOST_ACTIONS = 1 AND NOT Installed/u);
    assert.match(source, /NOT UPGRADINGPRODUCTCODE/u);
    assert.equal(source.match(/HideTarget="yes"/gu)?.length, 4);
    assert.match(source, /C:\\ProgramData\\MemTextual Continuity\\deployment\.json/u);
  });

  it("previews, exactly confirms, builds, and validates an unsigned MSI", async () => {
    const fixture = setup();
    try {
      const preview = await previewWindowsMsiBuild(fixture.options);
      assert.match(preview.confirmation, /^BUILD-WINDOWS-MSI-[A-F0-9]{20}$/u);
      assert.equal(preview.scope, "perMachine");
      const report = await applyWindowsMsiBuild({ ...fixture.options, confirmation: preview.confirmation });
      assert.equal(report.validated, true);
      assert.equal(fixture.validations(), 1);
      assert.equal(existsSync(fixture.outputPath), true);
    } finally { rmSync(fixture.root, { force: true, recursive: true }); }
  });

  it("does not publish an invalid MSI candidate", async () => {
    const fixture = setup(true);
    try {
      const preview = await previewWindowsMsiBuild(fixture.options);
      await assert.rejects(applyWindowsMsiBuild({ ...fixture.options, confirmation: preview.confirmation }), /not a Windows Installer compound file/u);
      assert.equal(existsSync(fixture.outputPath), false);
    } finally { rmSync(fixture.root, { force: true, recursive: true }); }
  });

  it("requires explicit WiX EULA acceptance and apply confirmation", () => {
    const base = ["--bundle", "C:\\bundle", "--output", "C:\\release\\app.msi", "--wix", "C:\\wix.exe", "--manufacturer", "Owner", "--trusted-fingerprint", "a".repeat(64)];
    assert.throws(() => parseWindowsMsiArguments(["preview", ...base]), /accept-wix-eula/u);
    assert.throws(() => parseWindowsMsiArguments(["apply", ...base, "--accept-wix-eula"]), /requires --confirm/u);
    assert.equal(parseWindowsMsiArguments(["preview", ...base, "--accept-wix-eula"]).command, "preview");
  });
});
