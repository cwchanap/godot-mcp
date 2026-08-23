import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const binaryArgument = process.argv[2];

if (!binaryArgument) {
  console.error('Usage: node scripts/smoke-packed-cli.js <godot-plugin-binary>');
  process.exit(2);
}

const packageManifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);
const binaryPath = resolve(binaryArgument);
await access(binaryPath);

const transport = new StdioClientTransport({
  command: binaryPath,
  stderr: 'inherit',
});
const client = new Client(
  {
    name: 'godot-plugin-package-smoke',
    version: '1.0.0',
  },
  {
    capabilities: {},
  }
);

try {
  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  if (serverVersion?.name !== 'godot-mcp' || serverVersion.version !== packageManifest.version) {
    throw new Error(`Unexpected MCP server metadata: ${JSON.stringify(serverVersion)}`);
  }

  const { tools } = await client.listTools();
  if (!tools.some((tool) => tool.name === 'get_godot_version')) {
    throw new Error('Packed server did not expose get_godot_version.');
  }

  console.log(JSON.stringify({
    serverVersion,
    toolCount: tools.length,
  }));
} finally {
  await client.close();
}
