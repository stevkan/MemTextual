import { resolve } from "node:path";

export interface McpRuntimeConfig {
  databasePath: string;
  migrationsDirectory: string;
}

export interface ResolveMcpConfigOptions {
  argv?: string[];
  environment?: NodeJS.ProcessEnv;
  workingDirectory?: string;
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function rejectUnknownArguments(argv: string[]): void {
  const recognized = new Set(["--database", "--migrations"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }
    if (!recognized.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }
}

export function resolveMcpRuntimeConfig(
  options: ResolveMcpConfigOptions = {},
): McpRuntimeConfig {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const workingDirectory = options.workingDirectory ?? process.cwd();

  rejectUnknownArguments(argv);

  const databaseValue =
    readOption(argv, "--database") ??
    environment.MEMTEXTUAL_DB_PATH ??
    "memtextual.db";
  const migrationsValue =
    readOption(argv, "--migrations") ??
    environment.MEMTEXTUAL_MIGRATIONS_DIR ??
    "migrations";

  return {
    databasePath: resolve(workingDirectory, databaseValue),
    migrationsDirectory: resolve(workingDirectory, migrationsValue),
  };
}
