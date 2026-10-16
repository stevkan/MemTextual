import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseWindowsAuthenticodeArguments } from "../src/cli/windows-authenticode.js";
import {
  applyWindowsAuthenticodeSigning,
  previewWindowsAuthenticodeSigning,
  WindowsSignToolOperations,
  type WindowsAuthenticodeOperations,
  type WindowsAuthenticodeSignRequest,
} from "../src/index.js";

class FakeOperations implements WindowsAuthenticodeOperations {
  failVerification = false;
  signRequests: WindowsAuthenticodeSignRequest[] = [];
  verifiedPaths: string[] = [];

  async sign(request: WindowsAuthenticodeSignRequest): Promise<void> {
    this.signRequests.push(request);
    appendFileSync(request.artifactPath, "signed\n", "utf8");
  }

  async verify(artifactPath: string): Promise<void> {
    this.verifiedPaths.push(artifactPath);
    if (this.failVerification) throw new Error("synthetic verification failure");
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "memtextual-authenticode-"));
  const unsignedArtifactPath = join(root, "unsigned.msi");
  const signedArtifactPath = join(root, "signed.msi");
  const signToolPath = join(root, "signtool.exe");
  writeFileSync(unsignedArtifactPath, "unsigned\n", "utf8");
  writeFileSync(signToolPath, "synthetic tool\n", "utf8");
  const operations = new FakeOperations();
  const options = {
    certificateStore: "current-user" as const,
    certificateThumbprint: "A".repeat(40),
    operations,
    signedArtifactPath,
    signToolPath,
    timestampUrl: "https://timestamp.example.test/",
    unsignedArtifactPath,
  };
  return { operations, options, root, signedArtifactPath, signToolPath, unsignedArtifactPath };
}

describe("Windows Authenticode signing boundary", () => {
  it("previews, exactly confirms, signs a copy, and verifies it", async () => {
    const { operations, options, root, signedArtifactPath, unsignedArtifactPath } = fixture();
    try {
      const preview = await previewWindowsAuthenticodeSigning(options);
      assert.match(preview.confirmation, /^SIGN-WINDOWS-INSTALLER-[A-F0-9]{20}$/u);
      assert.equal(existsSync(signedArtifactPath), false);
      await assert.rejects(
        applyWindowsAuthenticodeSigning({ ...options, confirmation: "WRONG" }),
        /confirmation is missing, incorrect, or stale/u,
      );
      const report = await applyWindowsAuthenticodeSigning({
        ...options,
        confirmation: preview.confirmation,
      });
      assert.equal(report.verified, true);
      assert.equal(report.unsignedArtifactSha256, preview.unsignedArtifactSha256);
      assert.notEqual(report.signedArtifactSha256, report.unsignedArtifactSha256);
      assert.equal(readFileSync(unsignedArtifactPath, "utf8"), "unsigned\n");
      assert.equal(readFileSync(signedArtifactPath, "utf8"), "unsigned\nsigned\n");
      assert.equal(operations.signRequests.length, 1);
      assert.deepEqual(operations.verifiedPaths, [signedArtifactPath]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("binds confirmation to exact source bytes", async () => {
    const { options, root, unsignedArtifactPath } = fixture();
    try {
      const preview = await previewWindowsAuthenticodeSigning(options);
      appendFileSync(unsignedArtifactPath, "changed\n", "utf8");
      await assert.rejects(
        applyWindowsAuthenticodeSigning({ ...options, confirmation: preview.confirmation }),
        /confirmation is missing, incorrect, or stale/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("invokes SignTool with SHA-256, RFC 3161 timestamping, and policy verification", async () => {
    const calls: { arguments_: readonly string[]; executablePath: string; timeoutMs: number }[] = [];
    const operations = new WindowsSignToolOperations({
      runner: (executablePath, arguments_, timeoutMs) => {
        calls.push({ arguments_: [...arguments_], executablePath, timeoutMs });
      },
      signToolPath: "C:\\sdk\\signtool.exe",
    });
    await operations.sign({
      artifactPath: "C:\\release\\signed.msi",
      certificateStore: "local-machine",
      certificateThumbprint: "B".repeat(40),
      timestampUrl: "https://timestamp.example.test/",
    });
    await operations.verify("C:\\release\\signed.msi");
    assert.deepEqual(calls[0]?.arguments_, [
      "sign",
      "/fd",
      "SHA256",
      "/sha1",
      "B".repeat(40),
      "/sm",
      "/tr",
      "https://timestamp.example.test/",
      "/td",
      "SHA256",
      "/v",
      "C:\\release\\signed.msi",
    ]);
    assert.deepEqual(calls[1]?.arguments_, [
      "verify",
      "/pa",
      "/all",
      "/v",
      "C:\\release\\signed.msi",
    ]);
  });

  it("removes an incomplete output when verification fails", async () => {
    const { operations, options, root, signedArtifactPath } = fixture();
    try {
      operations.failVerification = true;
      const preview = await previewWindowsAuthenticodeSigning(options);
      await assert.rejects(
        applyWindowsAuthenticodeSigning({ ...options, confirmation: preview.confirmation }),
        /synthetic verification failure/u,
      );
      assert.equal(existsSync(signedArtifactPath), false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects insecure timestamps, unsupported formats, and existing outputs", async () => {
    const { options, root, signedArtifactPath } = fixture();
    try {
      await assert.rejects(
        previewWindowsAuthenticodeSigning({ ...options, timestampUrl: "http://example.test" }),
        /must be an HTTPS URL/u,
      );
      const unsupported = join(root, "unsigned.zip");
      writeFileSync(unsupported, "zip\n", "utf8");
      await assert.rejects(
        previewWindowsAuthenticodeSigning({
          ...options,
          signedArtifactPath: join(root, "signed.zip"),
          unsignedArtifactPath: unsupported,
        }),
        /not a supported Windows installer format/u,
      );
      writeFileSync(signedArtifactPath, "existing\n", "utf8");
      await assert.rejects(
        previewWindowsAuthenticodeSigning(options),
        /already exists/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("requires complete command-specific CLI inputs", () => {
    const base = [
      "preview",
      "--unsigned",
      "C:\\release\\unsigned.msi",
      "--signed",
      "C:\\release\\signed.msi",
      "--signtool",
      "C:\\sdk\\signtool.exe",
      "--certificate-thumbprint",
      "A".repeat(40),
      "--certificate-store",
      "current-user",
      "--timestamp-url",
      "https://timestamp.example.test/",
    ];
    assert.equal(parseWindowsAuthenticodeArguments(base).command, "preview");
    assert.throws(
      () => parseWindowsAuthenticodeArguments(["apply", ...base.slice(1)]),
      /requires --confirm/u,
    );
    assert.throws(
      () => parseWindowsAuthenticodeArguments([...base, "--confirm", "TOKEN"]),
      /preview does not accept/u,
    );
  });
});
