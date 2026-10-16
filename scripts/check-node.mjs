const requiredNodeVersion = "24.21.0";

if (process.versions.node !== requiredNodeVersion) {
  console.error(
    `MemTextual requires Node.js ${requiredNodeVersion}. Current version: ${process.versions.node}.`,
  );
  process.exit(1);
}
