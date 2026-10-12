const [major = 0, minor = 0] = process.versions.node
  .split(".")
  .map((part) => Number.parseInt(part, 10));

if (major < 22 || (major === 22 && minor < 14)) {
  console.error(
    `MemTextual requires Node.js 22.14.0 or newer. Current version: ${process.versions.node}.`,
  );
  console.error(
    "better-sqlite3 13 can crash during database initialization on older Node 22 releases.",
  );
  process.exit(1);
}
