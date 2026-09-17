import type { Metadata } from 'next';
import { Callout, Code, DocFooter, DocHead, Table } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Storage and portability',
  description: 'Two flat files, tombstones, compaction, and how portable mode is decided.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="the memory"
        title="Storage and portability"
        lede="Everything the app knows is a handful of files you can open, in a folder you chose."
      />

      <h2 id="files">The files</h2>
      <Code label="inside the data folder">{`store.json            settings and reminders
memory/chunks.jsonl   one JSON record per line, appended, never rewritten
memory/vectors.bin    fixed-width Float32 rows; row N belongs to line N
memory/meta.json      embedding width and model id
models/               the downloaded embedding model`}</Code>

      <h2 id="no-database">Why not a database</h2>
      <p>
        A native SQLite build means a compiled module for every platform and architecture
        combination, which is four or six binaries to ship and keep in step. Two flat files
        behave identically everywhere, the keyword index rebuilds at load in a few
        milliseconds, and you can read your own memory with <code>cat</code>.
      </p>
      <p>
        The trade-off is honest: this design holds tens of thousands of chunks comfortably and
        is not built for millions.
      </p>

      <h2 id="integrity">Why it cannot tear</h2>
      <ul>
        <li>
          The log is append-only. A row is never rewritten, so a crash mid-write can only ever
          leave a torn final line, which is skipped at load.
        </li>
        <li>
          Whether a row is embedded is derived from the vector file, not stored. The two files
          cannot disagree.
        </li>
        <li>
          At load, <code>vectors.bin</code> is made exactly as long as the log: padded if it is
          short, truncated if a compaction was interrupted.
        </li>
        <li>
          Deletions are tombstones, written as their own line. Replaying one as a row would
          shift every later row away from its vector, so they are applied to the row they name.
        </li>
      </ul>
      <p>
        <strong>Compact</strong> rewrites both files without the tombstoned rows, through
        temporary files and a rename, then reloads. That is when the space actually comes back.
      </p>

      <h2 id="portable">Portable mode</h2>
      <p>
        When portable mode is on, everything lives in a <code>nibble-data</code> folder beside
        the executable. It turns on when any of these is true:
      </p>
      <Table
        head={['Trigger', 'Where it comes from']}
        rows={[
          [<code key="a">--portable</code>, 'You passed the flag'],
          [<code key="b">PORTABLE_EXECUTABLE_DIR</code>, "Windows' portable build sets it"],
          [<code key="c">APPIMAGE</code>, 'Running as an AppImage sets it'],
          [
            <>
              a file named <code>portable</code>
            </>,
            'You created it next to the executable',
          ],
        ]}
      />
      <Callout title="macOS is the exception">
        A .app bundle often lives somewhere read-only, and /Applications needs admin rights, so
        portable mode is only honoured there when the directory is genuinely writable. It falls
        back to the normal per-user path instead of failing to start.
      </Callout>

      <h2 id="installed">Installed mode</h2>
      <Code>{`~/Library/Application Support/Nibble    macOS
%APPDATA%\\Nibble                       Windows
~/.config/Nibble                       Linux`}</Code>
      <p>
        The tray menu&apos;s <strong>Show data folder</strong> opens whichever one is actually in
        use, and the Settings tab prints the full path, so there is never a question about where
        your memory is.
      </p>

      <h2 id="retention">Retention</h2>
      <p>
        Two optional caps exist: an age in days and a maximum number of chunks. Both are off by
        default (0 means keep everything), and both are applied at startup, oldest first.
      </p>

      <DocFooter href="/docs/storage/" />
    </>
  );
}
