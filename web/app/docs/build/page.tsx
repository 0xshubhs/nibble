import type { Metadata } from 'next';
import { Callout, Code, DocFooter, DocHead } from '@/components/ui';
import { REPO } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Build and release',
  description: 'Running from source, the three native builds, signing, and this website.',
};

export default function Page() {
  return (
    <>
      <DocHead
        eyebrow="under the hood"
        title="Build and release"
        lede="Clone it, install it, run it. Every target builds natively, which is why CI runs three of them."
      />

      <h2 id="source">From source</h2>
      <Code label="the app">{`git clone ${REPO}.git
cd nibble
npm install
npm start           # compile, then run

npm run watch       # tsc --watch while developing
npm run typecheck   # no emit
npm test            # store + search tests`}</Code>

      <h2 id="builds">The three builds</h2>
      <Code>{`npm run build:mac     # .dmg + .zip     (arm64 + x64)
npm run build:win     # portable .exe + setup + .zip
npm run build:linux   # .AppImage + .deb + .tar.gz`}</Code>
      <Callout title="Each target must be built on its own OS">
        The workflow in <code>.github/workflows/build.yml</code> runs the three natively and
        attaches the results to a GitHub release when you push a tag. Building macOS on Linux
        is not a thing you can do.
      </Callout>

      <h2 id="signing">Signing</h2>
      <p>
        Builds are unsigned by default, so macOS shows an unidentified developer warning on
        first launch. To sign, add these repository secrets and drop the{' '}
        <code>CSC_IDENTITY_AUTO_DISCOVERY: false</code> line from the workflow:
      </p>
      <ul>
        <li>
          <strong>macOS:</strong> <code>CSC_LINK</code> (base64 .p12),{' '}
          <code>CSC_KEY_PASSWORD</code>, plus <code>APPLE_ID</code>,{' '}
          <code>APPLE_APP_SPECIFIC_PASSWORD</code> and <code>APPLE_TEAM_ID</code> for
          notarization
        </li>
        <li>
          <strong>Windows:</strong> <code>CSC_LINK</code> and <code>CSC_KEY_PASSWORD</code>
        </li>
      </ul>
      <p>
        Unsigned macOS builds are still ad-hoc signed by a post-pack step, because Apple silicon
        refuses to launch a completely unsigned binary.
      </p>

      <h2 id="screenshot">Screenshots without a screen grab</h2>
      <Code>{`npx electron . --dev --screenshot=out.png --tab=memory --query="release process"`}</Code>
      <p>
        This renders the window, captures it from inside the app and exits, which beats a screen
        grab that picks up whatever else is in front.
      </p>

      <h2 id="site">This website</h2>
      <Code label="the site">{`cd web
npm install
npm run dev      # http://localhost:3000
npm run build    # static export into web/out`}</Code>
      <p>
        It is a Next.js app exported to static files, because documentation for a desktop app
        has nothing to run on a server. The workflow in{' '}
        <code>.github/workflows/pages.yml</code> builds and deploys it, and it is manual on
        purpose: running it makes the page public.
      </p>
      <p>
        There is also <code>site/index.html</code>, a single self-contained page with no build
        step at all, kept for a quick local preview of the same story.
      </p>

      <h2 id="rename">Renaming it</h2>
      <p>
        The product name appears in <code>package.json</code>, <code>electron-builder.yml</code>
        , the <code>setAppUserModelId</code> call, the relay&apos;s <code>APP_DIR_NAME</code>{' '}
        and the copy on this site. The data folder name is the <code>FOLDER</code> constant in{' '}
        <code>src/main/paths.ts</code>.
      </p>

      <DocFooter href="/docs/build/" />
    </>
  );
}
