'use client';

import { useEffect, useRef, useState } from 'react';
import { TrayGlyph } from './Logo';

/**
 * The hero demo: an assistant answering from the local memory.
 *
 * Every exchange here is a real tool call the connector exposes, with the
 * arguments it really takes. It is a dramatisation of the wiring, not a
 * promise about the answers.
 */

interface Turn {
  you: string;
  tool: string;
  arg: string;
  them: string;
  cite: string;
}

const TURNS: Turn[] = [
  {
    you: 'What did we decide about the Windows ARM build?',
    tool: 'search_memory',
    arg: 'windows arm build decision',
    them: 'You cut it until someone actually asks for it.',
    cite: 'Standup notes · folders',
  },
  {
    you: 'What else was going on around that decision?',
    tool: 'related_memory',
    arg: 'a41f0c8e21b3_0',
    them: 'Two things: the CI minutes thread, and the ARM runner price you copied.',
    cite: '2 neighbours · 71% and 64% similar',
  },
  {
    you: 'How often does the staging password rotate?',
    tool: 'search_memory',
    arg: 'staging credentials rotation',
    them: 'Every 90 days, done by whoever is on call.',
    cite: 'Deploy runbook · folders',
  },
  {
    you: 'Remind me to push the release tag tomorrow at 9.',
    tool: 'add_reminder',
    arg: '2026-09-18T09:00',
    them: 'Set for tomorrow, 09:00.',
    cite: 'notification · on this device',
  },
];

type Kind = 'you' | 'tool' | 'them';
interface Bubble {
  id: number;
  kind: Kind;
  turn: Turn;
}

let seq = 0;
const bubblesFor = (turn: Turn): Bubble[] =>
  (['you', 'tool', 'them'] as Kind[]).map((kind) => ({ id: seq++, kind, turn }));

export function Demo() {
  // The first exchange is in the initial render, so the exported HTML and a
  // screenshot both show the idea before any JavaScript runs.
  const [bubbles, setBubbles] = useState<Bubble[]>(() => bubblesFor(TURNS[0]));
  const [clock, setClock] = useState('--:--');
  const [ringing, setRinging] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let turn = 1;
    const push = (b: Bubble) => setBubbles((prev) => [...prev, b].slice(-3));

    const play = () => {
      const t = TURNS[turn % TURNS.length];
      turn++;
      const [you, tool, them] = bubblesFor(t);

      push(you);
      timers.current.push(
        setTimeout(() => {
          push(tool);
          setRinging(true);
          timers.current.push(setTimeout(() => setRinging(false), 700));
        }, 700),
        setTimeout(() => push(them), 1500)
      );
    };

    const id = setInterval(play, 6200);
    return () => {
      clearInterval(id);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  return (
    <div className="demo" aria-label="An assistant answering from your local memory">
      <div className="demo-bar">
        <TrayGlyph className={`glyph${ringing ? ' is-ringing' : ''}`} />
        <span>nibble · MCP</span>
        <span className="spacer" />
        <span>{clock}</span>
      </div>

      <div className="chat">
        {bubbles.map((b) => {
          if (b.kind === 'you') {
            return (
              <div className="bubble you" key={b.id}>
                {b.turn.you}
              </div>
            );
          }
          if (b.kind === 'tool') {
            return (
              <div className="bubble tool" key={b.id}>
                → <b>{b.turn.tool}</b>({JSON.stringify(b.turn.arg)})
              </div>
            );
          }
          return (
            <div className="bubble them" key={b.id}>
              {b.turn.them}
              <span className="cite">{b.turn.cite}</span>
            </div>
          );
        })}
      </div>

      <div className="demo-foot">
        <span className="dot" />
        <span>127.0.0.1 · nothing left this machine</span>
      </div>
    </div>
  );
}
