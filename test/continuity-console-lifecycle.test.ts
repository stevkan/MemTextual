import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { closeContinuityConsoleResources } from "../src/runtime/continuity-console-lifecycle.js";

describe("Continuity console lifecycle", () => {
  it("closes the listener, conversation runtime, and database in dependency order", async () => {
    const order: string[] = [];
    await closeContinuityConsoleResources({
      closeConsole: async () => {
        order.push("console");
      },
      closeConversationRuntime: async () => {
        order.push("conversation-runtime");
      },
      closeDatabase: () => {
        order.push("database");
      },
    });
    assert.deepEqual(order, ["console", "conversation-runtime", "database"]);
  });

  it("attempts every close and reports the first failure", async () => {
    const order: string[] = [];
    const first = new Error("console close failed");
    await assert.rejects(
      closeContinuityConsoleResources({
        closeConsole: async () => {
          order.push("console");
          throw first;
        },
        closeConversationRuntime: async () => {
          order.push("conversation-runtime");
          throw new Error("runtime close failed");
        },
        closeDatabase: () => {
          order.push("database");
        },
      }),
      (error: unknown) => error === first,
    );
    assert.deepEqual(order, ["console", "conversation-runtime", "database"]);
  });
});
