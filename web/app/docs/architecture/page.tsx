import type { Metadata } from 'next';
import { Callout, Code, DocFooter, DocHead } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Architecture',
  description: 'Processes, the preload bridge, and where each file lives.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="under the hood"
        title="Architecture"
        lede="One Electron codebase in strict TypeScript, compiled by plain tsc, with no bundler anywhere in the build."
      />

      <h2 id="processes">Four processes</h2>
      <ul>
        <li>
          <strong>Main.</strong> Owns the store, the scheduler, the tray, the capture sources,
          the memory and the MCP server. Everything with state lives here.
        </li>
        <li>
          <strong>Renderer.</strong> The window. No framework, no imports: it is a plain script
          tag, so it stays a script rather than a module.
        </li>
        <li>
          <strong>Utility process.</strong> The embedding model, isolated so that tens of
          milliseconds of CPU per batch cannot stall the tray or the reminder timers.
        </li>
        <li>
          <strong>The notch panel.</strong> Its own renderer, on macOS only.
        </li>
      </ul>

      <h2 id="bridge">The bridge is typed</h2>
      <p>
        <code>RendererApi</code> in <code>src/types.ts</code> is implemented by{' '}
        <code>src/preload.ts</code> and declared as <code>window.api</code> for the renderer.
        Adding a channel on one side without the other is a compile error rather than a runtime
        undefined.
      </p>
      <Callout title="The renderer is sandboxed">
        Node integration is off, context isolation is on, and every call is an explicit named
        channel. A dropped file has no usable path in a sandboxed renderer, so the preload
        resolves it through webUtils, which is the only place with the privilege to do it.
      </Callout>

      <h2 id="layout">Where things are</h2>
      <Code>{`src/types.ts            every shape that crosses a boundary
src/main/index.ts       app wiring, windows, IPC
src/main/scheduler.ts   the reminder clock (chunked timers, DST-safe repeats)
src/main/store.ts       settings and reminders
src/main/paths.ts       portable-vs-installed data directory
src/main/autostart.ts   login items: LaunchServices / Run key / XDG autostart
src/main/tray.ts        menu bar icon and menu
src/main/notifier.ts    native notifications
src/main/notch.ts       the macOS notch panel
src/main/quickcapture.ts the global hotkey

src/main/memory/        chunker, store, hybrid search, embedder
src/main/memory/embed-worker.ts   the model, in its own process
src/main/capture/       capture sources behind one interface
src/main/mcp/server.ts  loopback MCP server
src/mcp/stdio.ts        dependency-free relay for stdio clients

src/preload.ts          the only bridge into the renderer
src/renderer/           the window UI (no framework)
src/renderer/tokens.css the ENS design tokens, shared by both windows
src/test/               store and search tests

web/                    this website (Next.js, static export)`}</Code>

      <h2 id="no-bundler">Why no bundler</h2>
      <p>
        <code>rootDir</code> is <code>src</code> and <code>outDir</code> is <code>out</code>, so
        every file compiles to the same depth it was written at:{' '}
        <code>src/main/index.ts</code> becomes <code>out/main/index.js</code>. The main process
        resolves the preload, the renderer, the worker and the MCP relay through{' '}
        <code>__dirname</code>, and that keeps every path correct without a single change
        between running from source and running packaged.
      </p>

      <h2 id="sources">Sources behind one interface</h2>
      <p>
        Every capture source implements the same interface, including the ones that are not
        built yet. That is what lets the UI list audio and screen honestly, with their real
        permission state, instead of hiding them or implying that they are recording.
      </p>

      <h2 id="design">The look</h2>
      <p>
        The window, the notch panel and this site all draw from the same design vocabulary: the
        ENS design system, Thorin. Satoshi as the typeface, the ENS accent ramp, Thorin&apos;s
        radii and its very soft shadows, defined once in <code>src/renderer/tokens.css</code>{' '}
        and mirrored in the site&apos;s stylesheet.
      </p>

      <DocFooter href="/docs/architecture/" />
    </>
  );
}
