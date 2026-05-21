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

const positiveInt = z.preprocess((value) => {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value);
  }

  return value;
}, z.number().int().positive());
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
const tagNames = z.array(z.string().trim().min(1)).min(1);

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
    "helpscout_list_customer_properties",
    {
      title: "List Help Scout Customer Properties",
      description:
        "List customer property definitions, which are Help Scout's customer-level custom fields.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async () => runRead(() => client.listCustomerProperties())
  );

  server.registerTool(
    "helpscout_get_customer",
    {
      title: "Get Help Scout Customer",
      description:
        "Get one Help Scout customer/contact by ID, including customer-level custom properties when present.",
      inputSchema: {
        customerId: positiveInt
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ customerId }) => runRead(() => client.getCustomer(customerId))
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
    "helpscout_get_conversation_customer_properties",
    {
      title: "Get Conversation Customer Properties",
      description:
        "Get the primary customer's custom properties for a Help Scout conversation.",
      inputSchema: {
        conversationId: positiveInt
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ conversationId }) => runRead(() => getConversationCustomerProperties(client, conversationId))
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
        customerId: positiveInt.describe("Help Scout customer ID being replied to. Use the conversation customer ID."),
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
          customer: { id: args.customerId },
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
        path: z.enum(["/assignTo", "/mailboxId", "/primaryCustomer.id", "/status", "/subject"]),
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
    "helpscout_snooze_conversation",
    {
      title: "Snooze Help Scout Conversation",
      description:
        "Snooze a Help Scout conversation until an ISO 8601 timestamp. Defaults to unsnoozing on customer reply.",
      inputSchema: {
        conversationId: positiveInt,
        snoozedUntil: z.string().min(1).describe("Future ISO 8601 timestamp, for example 2026-06-01T12:00:00Z."),
        unsnoozeOnCustomerReply: z.boolean().optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (args) =>
      runWrite(enableWrites, () =>
        client.snoozeConversation(args.conversationId, {
          snoozedUntil: args.snoozedUntil,
          unsnoozeOnCustomerReply: args.unsnoozeOnCustomerReply ?? true
        })
      )
  );

  server.registerTool(
    "helpscout_add_conversation_tags",
    {
      title: "Add Help Scout Conversation Tags",
      description:
        "Add one or more tags to a Help Scout conversation while preserving any existing tags not mentioned.",
      inputSchema: {
        conversationId: positiveInt,
        tags: tagNames
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ conversationId, tags }) =>
      runWrite(enableWrites, () => modifyConversationTags(client, conversationId, tags, "add"))
  );

  server.registerTool(
    "helpscout_remove_conversation_tags",
    {
      title: "Remove Help Scout Conversation Tags",
      description:
        "Remove one or more tags from a Help Scout conversation while preserving all other existing tags.",
      inputSchema: {
        conversationId: positiveInt,
        tags: tagNames
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ conversationId, tags }) =>
      runWrite(enableWrites, () => modifyConversationTags(client, conversationId, tags, "remove"))
  );

  server.registerTool(
    "helpscout_set_conversation_tags",
    {
      title: "Set Help Scout Conversation Tags",
      description: "Replace the entire tag list on a Help Scout conversation.",
      inputSchema: {
        conversationId: positiveInt,
        tags: z.array(z.string().trim().min(1))
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

async function getConversationCustomerProperties(
  client: HelpScoutClient,
  conversationId: number
): Promise<unknown> {
  const conversation = await client.getConversation(conversationId);
  const customerId = extractPrimaryCustomerId(conversation.data);
  if (!customerId) {
    throw new Error("Conversation did not include a primary customer ID.");
  }

  const customer = await client.getCustomer(customerId);

  return {
    conversationId,
    customerId,
    requestCost: conversation.requestCost + customer.requestCost,
    conversationPrimaryCustomer: isRecord(conversation.data) ? conversation.data.primaryCustomer : undefined,
    customer: customer.data,
    properties: extractCustomerProperties(customer.data)
  };
}

async function modifyConversationTags(
  client: HelpScoutClient,
  conversationId: number,
  tags: string[],
  mode: "add" | "remove"
): Promise<unknown> {
  const conversation = await client.getConversation(conversationId);
  const previousTags = extractConversationTagNames(conversation.data);
  const nextTags = mode === "add" ? addTags(previousTags, tags) : removeTags(previousTags, tags);
  const response = await client.setConversationTags(conversationId, nextTags);

  return {
    ...response,
    requestCost: conversation.requestCost + response.requestCost,
    data: {
      previousTags,
      tags: nextTags,
      changedTags: mode === "add" ? addedTags(previousTags, nextTags) : removedTags(previousTags, nextTags)
    }
  };
}

function extractPrimaryCustomerId(conversation: unknown): number | undefined {
  if (!isRecord(conversation)) {
    return undefined;
  }

  const primaryCustomer = conversation.primaryCustomer;
  if (isRecord(primaryCustomer) && typeof primaryCustomer.id === "number") {
    return primaryCustomer.id;
  }

  const links = conversation._links;
  if (!isRecord(links)) {
    return undefined;
  }

  const primaryCustomerLink = links.primaryCustomer;
  if (!isRecord(primaryCustomerLink) || typeof primaryCustomerLink.href !== "string") {
    return undefined;
  }

  const match = primaryCustomerLink.href.match(/\/customers\/(\d+)(?:\b|$)/);
  return match ? Number(match[1]) : undefined;
}

function extractCustomerProperties(customer: unknown): unknown[] {
  if (!isRecord(customer) || !isRecord(customer._embedded) || !Array.isArray(customer._embedded.properties)) {
    return [];
  }

  return customer._embedded.properties;
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
  const { conversationId: _conversationId, customerId: _customerId, mailboxId: _mailboxId, ...payload } = args;
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

function extractConversationTagNames(conversation: unknown): string[] {
  if (!isRecord(conversation) || !Array.isArray(conversation.tags)) {
    return [];
  }

  const tags: string[] = [];
  for (const tag of conversation.tags) {
    if (typeof tag === "string") {
      tags.push(tag);
    } else if (isRecord(tag) && typeof tag.tag === "string") {
      tags.push(tag.tag);
    }
  }

  return uniqueTags(tags);
}

function addTags(currentTags: string[], requestedTags: string[]): string[] {
  return uniqueTags([...currentTags, ...requestedTags]);
}

function removeTags(currentTags: string[], requestedTags: string[]): string[] {
  const requestedKeys = new Set(requestedTags.map(tagKey));
  return currentTags.filter((tag) => !requestedKeys.has(tagKey(tag)));
}

function addedTags(previousTags: string[], nextTags: string[]): string[] {
  const previousKeys = new Set(previousTags.map(tagKey));
  return nextTags.filter((tag) => !previousKeys.has(tagKey(tag)));
}

function removedTags(previousTags: string[], nextTags: string[]): string[] {
  const nextKeys = new Set(nextTags.map(tagKey));
  return previousTags.filter((tag) => !nextKeys.has(tagKey(tag)));
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const tag of tags) {
    const trimmed = tag.trim();
    const key = tagKey(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(trimmed);
  }

  return unique;
}

function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
