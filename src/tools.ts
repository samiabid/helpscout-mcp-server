import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HelpScoutClient, type QueryParams } from "./helpscoutClient.js";
import { normalizeError } from "./errors.js";

export interface RegisterHelpScoutToolsOptions {
  server: McpServer;
  client: HelpScoutClient;
  enableWrites: boolean;
}

const positiveInt = z.number().int().positive();
const status = z.enum(["active", "closed", "inbox_predefined", "open", "pending", "spam"]);
const attachment = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  data: z.string().min(1).describe("Base64-encoded attachment data.")
});
const fieldValue = z.object({
  id: positiveInt,
  value: z.string()
});

const paginationShape = {
  page: z.number().int().min(1).optional(),
  size: z.number().int().min(1).max(100).optional(),
  allPages: z.boolean().optional().describe("Fetch pages until the API has no next page."),
  maxPages: z.number().int().min(1).max(25).optional().describe("Safety cap when allPages is true.")
};

export function registerHelpScoutTools(options: RegisterHelpScoutToolsOptions): void {
  const { server, client, enableWrites } = options;

  server.registerTool(
    "helpscout_whoami",
    {
      title: "Help Scout Resource Owner",
      description: "Return the Help Scout user associated with the configured OAuth credentials.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async () => runRead(() => client.whoami())
  );

  server.registerTool(
    "helpscout_list_inboxes",
    {
      title: "List Help Scout Inboxes",
      description: "List Help Scout inboxes/mailboxes visible to the authenticated user.",
      inputSchema: paginationShape,
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => runRead(() => maybePaged(client, "mailboxes", "mailboxes", args))
  );

  server.registerTool(
    "helpscout_get_inbox",
    {
      title: "Get Help Scout Inbox",
      description: "Get one Help Scout inbox/mailbox by ID.",
      inputSchema: {
        mailboxId: positiveInt
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ mailboxId }) => runRead(() => client.getInbox(mailboxId))
  );

  server.registerTool(
    "helpscout_list_inbox_folders",
    {
      title: "List Help Scout Inbox Folders",
      description: "List folders for a Help Scout inbox/mailbox.",
      inputSchema: {
        mailboxId: positiveInt,
        ...paginationShape
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) =>
      runRead(() =>
        maybePaged(client, `mailboxes/${args.mailboxId}/folders`, "folders", stripToolOnlyArgs(args))
      )
  );

  server.registerTool(
    "helpscout_list_inbox_fields",
    {
      title: "List Help Scout Inbox Fields",
      description: "List custom fields configured for a Help Scout inbox/mailbox.",
      inputSchema: {
        mailboxId: positiveInt
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ mailboxId }) => runRead(() => client.listInboxFields(mailboxId))
  );

  server.registerTool(
    "helpscout_list_users",
    {
      title: "List Help Scout Users",
      description: "List Help Scout users visible to the authenticated user.",
      inputSchema: {
        mailbox: positiveInt.optional(),
        modifiedSince: z.string().optional(),
        ...paginationShape
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => runRead(() => maybePaged(client, "users", "users", args))
  );

  server.registerTool(
    "helpscout_list_tags",
    {
      title: "List Help Scout Tags",
      description: "List Help Scout tags.",
      inputSchema: {
        query: z.string().optional(),
        ...paginationShape
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => runRead(() => maybePaged(client, "tags", "tags", args))
  );

  server.registerTool(
    "helpscout_list_saved_replies",
    {
      title: "List Help Scout Saved Replies",
      description: "List saved replies for a Help Scout inbox/mailbox.",
      inputSchema: {
        mailboxId: positiveInt,
        includeChatReplies: z.boolean().optional()
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ mailboxId, includeChatReplies }) =>
      runRead(() => client.listSavedReplies(mailboxId, includeChatReplies))
  );

  server.registerTool(
    "helpscout_get_saved_reply",
    {
      title: "Get Help Scout Saved Reply",
      description: "Get one saved reply by inbox/mailbox ID and saved reply ID.",
      inputSchema: {
        mailboxId: positiveInt,
        savedReplyId: positiveInt
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ mailboxId, savedReplyId }) =>
      runRead(() => client.getSavedReply(mailboxId, savedReplyId))
  );

  server.registerTool(
    "helpscout_search_conversations",
    {
      title: "Search Help Scout Conversations",
      description: "List/search Help Scout conversations using API filters and query syntax.",
      inputSchema: {
        mailbox: positiveInt.optional(),
        folder: positiveInt.optional(),
        status: z.enum(["active", "closed", "pending", "spam", "all"]).optional(),
        tag: z.string().optional(),
        query: z.string().optional(),
        embed: z.enum(["threads"]).optional(),
        sortField: z.enum(["createdAt", "modifiedAt", "number", "waitingSince"]).optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        modifiedSince: z.string().optional(),
        ...paginationShape
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => runRead(() => maybePaged(client, "conversations", "conversations", args))
  );

  server.registerTool(
    "helpscout_get_conversation",
    {
      title: "Get Help Scout Conversation",
      description: "Get a Help Scout conversation by ID. Optionally embed threads.",
      inputSchema: {
        conversationId: positiveInt,
        embed: z.enum(["threads"]).optional()
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ conversationId, embed }) => runRead(() => client.getConversation(conversationId, embed))
  );

  server.registerTool(
    "helpscout_list_threads",
    {
      title: "List Help Scout Conversation Threads",
      description: "List threads for a Help Scout conversation.",
      inputSchema: {
        conversationId: positiveInt,
        ...paginationShape
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) =>
      runRead(() =>
        maybePaged(client, `conversations/${args.conversationId}/threads`, "threads", stripToolOnlyArgs(args))
      )
  );

  server.registerTool(
    "helpscout_create_draft_reply",
    {
      title: "Create Help Scout Draft Reply",
      description:
        "Create a draft customer reply on an existing Help Scout conversation. This never sends the reply.",
      inputSchema: {
        conversationId: positiveInt,
        text: z.string().min(1),
        status: status.optional(),
        user: positiveInt.optional(),
        assignTo: z.union([positiveInt, z.null()]).optional(),
        imported: z.boolean().optional(),
        createdAt: z.string().optional(),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        attachments: z.array(attachment).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (args) =>
      runWrite(enableWrites, () =>
        client.createReplyThread(args.conversationId, {
          ...compactRecord(stripToolOnlyArgs(args)),
          draft: true
        })
      )
  );

  server.registerTool(
    "helpscout_create_note",
    {
      title: "Create Help Scout Note",
      description: "Create an internal note thread on an existing Help Scout conversation.",
      inputSchema: {
        conversationId: positiveInt,
        text: z.string().min(1),
        status: status.optional(),
        user: positiveInt.optional(),
        imported: z.boolean().optional(),
        createdAt: z.string().optional(),
        attachments: z.array(attachment).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (args) =>
      runWrite(enableWrites, () => client.createNote(args.conversationId, compactRecord(stripToolOnlyArgs(args))))
  );

  server.registerTool(
    "helpscout_patch_conversation",
    {
      title: "Patch Help Scout Conversation",
      description: "Patch one allowed Help Scout conversation field with JSON Patch semantics.",
      inputSchema: {
        conversationId: positiveInt,
        op: z.enum(["add", "move", "remove", "replace"]),
        path: z.enum(["/assignTo", "/draft", "/mailboxId", "/primaryCustomer.id", "/status", "/subject"]),
        value: z.unknown().optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (args) =>
      runWrite(enableWrites, () =>
        client.patchConversation(args.conversationId, compactRecord(stripToolOnlyArgs(args)))
      )
  );

  server.registerTool(
    "helpscout_set_conversation_tags",
    {
      title: "Set Help Scout Conversation Tags",
      description: "Replace the entire tag list on a Help Scout conversation.",
      inputSchema: {
        conversationId: positiveInt,
        tags: z.array(z.string())
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ conversationId, tags }) =>
      runWrite(enableWrites, () => client.setConversationTags(conversationId, tags))
  );

  server.registerTool(
    "helpscout_update_custom_fields",
    {
      title: "Update Help Scout Conversation Custom Fields",
      description: "Replace the entire custom field value list on a Help Scout conversation.",
      inputSchema: {
        conversationId: positiveInt,
        fields: z.array(fieldValue)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ conversationId, fields }) =>
      runWrite(enableWrites, () => client.updateCustomFields(conversationId, fields))
  );
}

async function runRead<T>(operation: () => Promise<T>): Promise<CallToolResult> {
  return runTool(operation);
}

async function runWrite<T>(enabled: boolean, operation: () => Promise<T>): Promise<CallToolResult> {
  if (!enabled) {
    return errorResult({
      name: "WritesDisabled",
      message: "Write tools are disabled. Set HELPSCOUT_MCP_ENABLE_WRITES=true to allow Help Scout mutations."
    });
  }

  return runTool(operation);
}

async function runTool<T>(operation: () => Promise<T>): Promise<CallToolResult> {
  try {
    return jsonResult(await operation());
  } catch (error) {
    return errorResult(normalizeError(error));
  }
}

function jsonResult(value: unknown): CallToolResult {
  const payload = normalizeResponse(value);
  return {
    structuredContent: {
      result: payload
    },
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function errorResult(error: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    structuredContent: {
      error
    },
    content: [
      {
        type: "text",
        text: JSON.stringify(error, null, 2)
      }
    ]
  };
}

function normalizeResponse(value: unknown): unknown {
  if (isRecord(value) && "data" in value && "status" in value) {
    return {
      status: value.status,
      statusText: value.statusText,
      resourceId: value.resourceId,
      location: value.location,
      webLocation: value.webLocation,
      rateLimit: value.rateLimit,
      requestCost: value.requestCost,
      data: value.data ?? null
    };
  }

  return value;
}

async function maybePaged(
  client: HelpScoutClient,
  path: string,
  embeddedKey: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const query = compactRecord(stripPagingControlArgs(args)) as QueryParams;

  if (args.allPages) {
    return client.listPaged(path, query, embeddedKey, Number(args.maxPages || 5));
  }

  return client.get(path, query);
}

function stripPagingControlArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { allPages: _allPages, maxPages: _maxPages, ...query } = args;
  return query;
}

function stripToolOnlyArgs<T extends Record<string, unknown>>(args: T): Record<string, unknown> {
  const { conversationId: _conversationId, mailboxId: _mailboxId, ...payload } = args;
  return payload;
}

function compactRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }

  return compacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
