import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import nock from "nock";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createHelpScoutMcpServer } from "../src/server.js";

describe("MCP server", () => {
  let clientsToClose: Client[] = [];

  afterEach(async () => {
    await Promise.all(clientsToClose.map((client) => client.close().catch(() => undefined)));
    clientsToClose = [];
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("lists the planned read/write tools over an in-memory MCP transport", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createHelpScoutMcpServer({ config: config(false) });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    clientsToClose.push(client);

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

	    expect(names).toEqual([
	      "helpscout_add_conversation_tags",
	      "helpscout_create_draft_reply",
	      "helpscout_create_note",
	      "helpscout_get_conversation",
      "helpscout_get_inbox",
      "helpscout_get_saved_reply",
      "helpscout_list_inbox_fields",
      "helpscout_list_inbox_folders",
      "helpscout_list_inboxes",
      "helpscout_list_saved_replies",
      "helpscout_list_tags",
      "helpscout_list_threads",
	      "helpscout_list_users",
	      "helpscout_patch_conversation",
	      "helpscout_remove_conversation_tags",
	      "helpscout_search_conversations",
	      "helpscout_set_conversation_tags",
	      "helpscout_snooze_conversation",
	      "helpscout_update_custom_fields",
	      "helpscout_whoami"
	    ]);
  });

  it("exposes draft reply schema without a draft override field", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createHelpScoutMcpServer({ config: config(false) });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    clientsToClose.push(client);

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    const draftTool = tools.find((tool) => tool.name === "helpscout_create_draft_reply");
    const patchTool = tools.find((tool) => tool.name === "helpscout_patch_conversation");

    expect(names).not.toContain("helpscout_create_reply_thread");
    expect(names).not.toContain("helpscout_create_conversation");
    expect(draftTool).toBeTruthy();
    expect(draftTool?.inputSchema.properties).not.toHaveProperty("draft");
    expect(draftTool?.inputSchema.properties).toHaveProperty("customerId");
    expect(draftTool?.inputSchema.required).toContain("customerId");
    expect((patchTool?.inputSchema.properties?.path as { enum?: string[] } | undefined)?.enum).not.toContain("/draft");
  });

  it("rejects write tools when HELPSCOUT_MCP_ENABLE_WRITES is false", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createHelpScoutMcpServer({ config: config(false) });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    clientsToClose.push(client);

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "helpscout_set_conversation_tags",
      arguments: {
        conversationId: 123,
        tags: ["vip"]
      }
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain("WritesDisabled");
  });

	  it("coerces string IDs and always sends draft replies to Help Scout with draft=true", async () => {
    nock.disableNetConnect();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createHelpScoutMcpServer({ config: config(true) });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    clientsToClose.push(client);

    nock("https://api.helpscout.test")
      .post("/v2/oauth2/token")
      .reply(200, {
        token_type: "bearer",
        access_token: "draft-token",
        expires_in: 172_800
      })
      .post("/v2/conversations/123/reply", (body) => {
        expect(body).toMatchObject({
          text: "Please review this before sending.",
          cc: ["copy@example.com"],
          customer: { id: 777 },
          draft: true
        });
        expect(body).not.toHaveProperty("conversationId");
        expect(body).not.toHaveProperty("customerId");
        return true;
      })
      .reply(201, undefined, { "Resource-ID": "456" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "helpscout_create_draft_reply",
      arguments: {
        conversationId: "123",
        customerId: "777",
        text: "Please review this before sending.",
        cc: ["copy@example.com"]
      }
    });

    expect(result.isError).not.toBe(true);
    expect(nock.isDone()).toBe(true);
	  });

	  it("snoozes conversations with unsnooze-on-reply enabled by default", async () => {
	    nock.disableNetConnect();
	    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	    const server = createHelpScoutMcpServer({ config: config(true) });
	    const client = new Client({ name: "test-client", version: "0.0.0" });
	    clientsToClose.push(client);

	    nock("https://api.helpscout.test")
	      .post("/v2/oauth2/token")
	      .reply(200, {
	        token_type: "bearer",
	        access_token: "snooze-token",
	        expires_in: 172_800
	      })
	      .put("/v2/conversations/123/snooze", (body) => {
	        expect(body).toEqual({
	          snoozedUntil: "2026-06-01T12:00:00Z",
	          unsnoozeOnCustomerReply: true
	        });
	        return true;
	      })
	      .reply(204);

	    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	    const result = await client.callTool({
	      name: "helpscout_snooze_conversation",
	      arguments: {
	        conversationId: "123",
	        snoozedUntil: "2026-06-01T12:00:00Z"
	      }
	    });

	    expect(result.isError).not.toBe(true);
	    expect(nock.isDone()).toBe(true);
	  });

	  it("adds and removes conversation tags while preserving other tags", async () => {
	    nock.disableNetConnect();
	    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	    const server = createHelpScoutMcpServer({ config: config(true) });
	    const client = new Client({ name: "test-client", version: "0.0.0" });
	    clientsToClose.push(client);

	    nock("https://api.helpscout.test")
	      .post("/v2/oauth2/token")
	      .reply(200, {
	        token_type: "bearer",
	        access_token: "tags-token",
	        expires_in: 172_800
	      })
	      .get("/v2/conversations/123")
	      .reply(200, {
	        id: 123,
	        tags: [{ tag: "vip" }, { tag: "billing" }]
	      })
	      .put("/v2/conversations/123/tags", (body) => {
	        expect(body).toEqual({ tags: ["vip", "billing", "urgent"] });
	        return true;
	      })
	      .reply(204)
	      .get("/v2/conversations/123")
	      .reply(200, {
	        id: 123,
	        tags: [{ tag: "vip" }, { tag: "billing" }, { tag: "urgent" }]
	      })
	      .put("/v2/conversations/123/tags", (body) => {
	        expect(body).toEqual({ tags: ["vip", "urgent"] });
	        return true;
	      })
	      .reply(204);

	    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	    const addResult = await client.callTool({
	      name: "helpscout_add_conversation_tags",
	      arguments: {
	        conversationId: "123",
	        tags: ["urgent", "VIP"]
	      }
	    });
	    const removeResult = await client.callTool({
	      name: "helpscout_remove_conversation_tags",
	      arguments: {
	        conversationId: "123",
	        tags: ["billing"]
	      }
	    });

	    expect(addResult.isError).not.toBe(true);
	    expect(removeResult.isError).not.toBe(true);
	    expect(nock.isDone()).toBe(true);
	  });

	  it("validates tool inputs before a handler runs", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createHelpScoutMcpServer({ config: config(false) });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    clientsToClose.push(client);

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "helpscout_get_inbox",
      arguments: {
        mailboxId: "not-a-number"
      }
    });

    const content = result.content as Array<{ type: string; text?: string }>;
    expect(result.isError).toBe(true);
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text || "").toContain("Input validation error");
  });

  it("smoke-tests the stdio entrypoint by listing tools", async () => {
    const transport = new StdioClientTransport({
      command: "./node_modules/.bin/tsx",
      args: ["src/stdio.ts"],
      cwd: process.cwd(),
      stderr: "pipe",
      env: {
        PATH: process.env.PATH || "",
        HELPSCOUT_APP_ID: "app-id",
        HELPSCOUT_APP_SECRET: "app-secret",
        HELPSCOUT_API_BASE_URL: "https://api.helpscout.test/v2",
        HELPSCOUT_MCP_ENABLE_WRITES: "false"
      }
    });
    const client = new Client({ name: "stdio-smoke-client", version: "0.0.0" });
    clientsToClose.push(client);

    await client.connect(transport);
    const { tools } = await client.listTools();

    expect(tools.some((tool) => tool.name === "helpscout_whoami")).toBe(true);
  });
});

function config(enableWrites: boolean) {
  return loadConfig(
    {
      HELPSCOUT_APP_ID: "app-id",
      HELPSCOUT_APP_SECRET: "app-secret",
      HELPSCOUT_API_BASE_URL: "https://api.helpscout.test/v2",
      HELPSCOUT_MCP_ENABLE_WRITES: String(enableWrites)
    },
    "stdio"
  );
}
