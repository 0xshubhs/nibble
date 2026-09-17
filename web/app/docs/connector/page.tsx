import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, Code, DocFooter, DocHead } from '@/components/ui';

export const metadata: Metadata = {
  title: 'MCP connector',
  description: 'Turn it on, connect a client, and the three things that keep a local server shut.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="connect an llm"
        title="MCP connector"
        lede="A Model Context Protocol server on loopback, so your assistant can search your memory instead of asking you to paste it."
      />

      <h2 id="turn-it-on">Turn it on</h2>
      <p>
        Open the <strong>Memory</strong> tab and switch on the local MCP connector. The app then
        shows you three things: the command line for a stdio client, the URL for an HTTP client,
        and the bearer token.
      </p>

      <h2 id="stdio">Claude Code and Claude Desktop</h2>
      <p>These spawn a relay over stdio rather than talking to a port:</p>
      <Code label="terminal">{`claude mcp add nibble -- node /path/to/nibble/mcp/stdio.js`}</Code>
      <p>
        The app prints the exact path for your install. The relay has no dependencies on
        purpose: a client spawns it with a plain <code>node</code>, which cannot require
        anything out of a packaged asar archive, so it ships as one standalone file that reads
        the port and token from the app&apos;s config and forwards to the HTTP server.
      </p>

      <h2 id="http">Anything that takes a URL</h2>
      <Code>{`http://127.0.0.1:8787/mcp
Authorization: Bearer <the token from the app>`}</Code>
      <p>
        If 8787 is busy, the server falls back to an ephemeral port rather than leaving the
        connector dead, and the app shows the port it actually got. There is a{' '}
        <code>/health</code> endpoint that needs no token, for checking the server is up.
      </p>

      <h2 id="security">What keeps it shut</h2>
      <p>Three things, because any one of them alone would not be enough:</p>
      <ul>
        <li>
          <strong>It binds to 127.0.0.1 only.</strong> Nothing off your machine can reach it at
          all, on any network you join.
        </li>
        <li>
          <strong>Every request needs the bearer token.</strong> Loopback is not a security
          boundary: anything else running on your machine can reach it, and so can a web page
          you have open.
        </li>
        <li>
          <strong>The Origin header is checked.</strong> A browser will happily send a request
          to localhost from a site you did not expect, which is what DNS rebinding attacks use.
          The MCP specification calls this out specifically.
        </li>
      </ul>
      <Callout tone="warn" title="Treat the token like a password">
        Anything holding it can read everything you have captured. Generate a new one from the
        Memory tab if you have pasted it somewhere you regret; existing clients then have to be
        updated.
      </Callout>

      <h2 id="stateless">Stateless by design</h2>
      <p>
        A fresh server and transport are built per request and torn down with it. There is no
        long-lived session to leak, and a client that dies mid-call leaves nothing behind. The
        app keeps the last fifty tool calls in memory so you can see what your assistant has
        been asking for, and shows the recent count next to the switch.
      </p>

      <h2 id="what-it-gets">What your assistant can do</h2>
      <p>
        Seven tools: search, follow a result to what is near it, list recent captures, store
        something new, report the index state, list reminders and schedule one. Each is
        documented with its arguments in the{' '}
        <Link href="/docs/tools/">tool reference</Link>.
      </p>

      <DocFooter href="/docs/connector/" />
    </>
  );
}
