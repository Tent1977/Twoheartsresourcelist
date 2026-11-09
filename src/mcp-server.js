/**
 * MCP (Model Context Protocol) server for the Two Hearts Resource List.
 *
 * Exposes the full resource library as MCP tools so any Claude-connected
 * app can query, add, update, and manage community resources without
 * custom integration code.
 *
 * Usage:
 *   node src/mcp-server.js
 *
 * Connect it to Claude Desktop or any MCP host by pointing the host at
 * this process via stdio transport.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const ResourceList = require('./ResourceList');
const { validateResource, validateCategory, VALID_CATEGORIES } = require('./Validator');
const { searchByKeyword, filterByCategory, sortBy, paginate } = require('./Search');
const { summary, findIncomplete, countByCategory, topCategory, addedInLastDays } = require('./Stats');
const { load, save, DEFAULT_PATH } = require('./Storage');

// ── State ────────────────────────────────────────────────────────────────────

const list = new ResourceList();

function hydrate() {
  const saved = load();
  for (const r of saved) {
    list.resources.push(r);
    if (r.id >= list.nextId) list.nextId = r.id + 1;
  }
}

function persist() {
  save(list.getAllIncludingInactive());
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_resources',
    description:
      'Return all active community resources. Optionally filter by a single category. ' +
      `Valid categories: ${VALID_CATEGORIES.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category filter (e.g. "food", "shelter").',
        },
      },
    },
  },
  {
    name: 'search_resources',
    description:
      'Search active resources by keyword and/or category. Supports sorting and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Text to match against name, address, notes.' },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more category strings to filter by.',
        },
        sortField: { type: 'string', description: 'Field to sort by (e.g. "name", "createdAt").' },
        sortDirection: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction.' },
        page: { type: 'number', description: 'Page number (1-indexed, default 1).' },
        pageSize: { type: 'number', description: 'Results per page (default 20).' },
      },
    },
  },
  {
    name: 'get_resource',
    description: 'Get a single resource by its numeric ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The resource ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_resource',
    description:
      'Add a new community resource. Name and category are required. ' +
      `Valid categories: ${VALID_CATEGORIES.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Resource name.' },
        category: { type: 'string', description: 'Resource category.' },
        address: { type: 'string', description: 'Street address (optional).' },
        phone: { type: 'string', description: 'Phone number (optional).' },
        hours: { type: 'string', description: 'Operating hours (optional).' },
        notes: { type: 'string', description: 'Additional notes (optional).' },
      },
      required: ['name', 'category'],
    },
  },
  {
    name: 'update_resource',
    description: 'Update one or more fields on an existing resource by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The resource ID to update.' },
        name: { type: 'string' },
        category: { type: 'string' },
        address: { type: 'string' },
        phone: { type: 'string' },
        hours: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'deactivate_resource',
    description: 'Soft-delete a resource (marks it inactive without removing it).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The resource ID to deactivate.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'reactivate_resource',
    description: 'Re-enable a previously deactivated resource.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The resource ID to reactivate.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'remove_resource',
    description:
      'Permanently delete a resource by ID. Prefer deactivate_resource to preserve history.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The resource ID to delete.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_stats',
    description:
      'Get a summary of all resources: total count, active/inactive split, ' +
      'breakdown by category, most common category, and recently added count.',
    inputSchema: {
      type: 'object',
      properties: {
        recentDays: {
          type: 'number',
          description: 'Number of days to use for the "recently added" count (default 7).',
        },
      },
    },
  },
  {
    name: 'find_incomplete_resources',
    description:
      'Return active resources that are missing a phone number or street address. ' +
      'Useful for identifying records that need follow-up.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'validate_resource',
    description:
      'Validate a resource object without saving it. Returns a list of validation errors.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string' },
        phone: { type: 'string' },
        hours: { type: 'string' },
      },
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleTool(name, args) {
  args = args || {};

  switch (name) {
    case 'list_resources': {
      const resources = list.getAll(args.category || null);
      return ok({ count: resources.length, resources });
    }

    case 'search_resources': {
      const all = list.getAll();
      let results = all;
      if (args.keyword) results = searchByKeyword(results, args.keyword);
      if (args.categories && args.categories.length) {
        results = filterByCategory(results, args.categories);
      }
      if (args.sortField) results = sortBy(results, args.sortField, args.sortDirection || 'asc');
      const page = paginate(results, args.page || 1, args.pageSize || 20);
      return ok(page);
    }

    case 'get_resource': {
      const r = list.getById(args.id);
      if (!r) return err(`No resource found with id ${args.id}`);
      return ok(r);
    }

    case 'add_resource': {
      const validation = validateResource(args);
      if (!validation.valid) return err(`Validation failed: ${validation.errors.join('; ')}`);
      const created = list.add(args);
      persist();
      return ok(created);
    }

    case 'update_resource': {
      const { id, ...fields } = args;
      const updated = list.update(id, fields);
      if (!updated) return err(`No resource found with id ${id}`);
      persist();
      return ok(updated);
    }

    case 'deactivate_resource': {
      const result = list.deactivate(args.id);
      if (!result) return err(`No resource found with id ${args.id}`);
      persist();
      return ok({ success: true, id: args.id, active: false });
    }

    case 'reactivate_resource': {
      const result = list.reactivate(args.id);
      if (!result) return err(`No resource found with id ${args.id}`);
      persist();
      return ok({ success: true, id: args.id, active: true });
    }

    case 'remove_resource': {
      const result = list.remove(args.id);
      if (!result) return err(`No resource found with id ${args.id}`);
      persist();
      return ok({ success: true, id: args.id, deleted: true });
    }

    case 'get_stats': {
      const all = list.getAllIncludingInactive();
      const stats = summary(all);
      stats.addedInLastDays = addedInLastDays(all, args.recentDays || 7);
      stats.recentDaysWindow = args.recentDays || 7;
      return ok(stats);
    }

    case 'find_incomplete_resources': {
      const all = list.getAllIncludingInactive();
      const incomplete = findIncomplete(all);
      return ok({ count: incomplete.length, resources: incomplete });
    }

    case 'validate_resource': {
      const result = validateResource(args);
      return ok(result);
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}

// ── Server setup ──────────────────────────────────────────────────────────────

async function main() {
  hydrate();

  const server = new Server(
    { name: 'twohearts-resource-list', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleTool(name, args);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`MCP server error: ${e.message}\n`);
  process.exit(1);
});
