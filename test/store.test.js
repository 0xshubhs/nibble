const fs = require('fs');
const os = require('os');
const path = require('path');
const { MemoryStore } = require('../src/main/memory/store.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memstore-'));
const DIM = 4;
let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { cond ? pass++ : fail++; console.log((cond?'  ok  ':'FAIL  ')+name+(cond?'':'  <-- '+extra)); };

// normalized toy vectors so dot product == cosine
const V = (a,b,c,d) => { const v=Float32Array.from([a,b,c,d]); const n=Math.hypot(...v); return v.map(x=>x/n); };

let s = new MemoryStore(dir, DIM).load();
ok('empty store loads', s.stats().chunks === 0);

const recs = s.add([
  { id:'a', source:'clipboard', title:'Release', text:'Push the release tag so CI builds the installers for every platform.' },
  { id:'b', source:'notes',     title:'Cat',     text:'The cat sat on the mat and refused to move all afternoon.' },
  { id:'c', source:'clipboard', title:'Reminder',text:'Reminders should fire even when the laptop was asleep.' },
]);
ok('add returns rows', recs.length === 3 && recs[2].row === 2);
ok('counted', s.stats().chunks === 3);
ok('all pending', s.stats().pending === 3);

// keyword only (no vectors yet)
let r = s.search('release tag installers', null, { k: 3 });
ok('keyword finds the release chunk', r[0].rec.id === 'a', r.map(x=>x.rec.id).join());
ok('keyword ignores unrelated', !r.some(x=>x.rec.id==='b'), r.map(x=>x.rec.id).join());
ok('stemming: reminder~reminders', s.search('reminder', null, {k:1})[0]?.rec.id === 'c');

// vectors
s.setVector(0, V(1,0,0,0));
s.setVector(1, V(0,1,0,0));
s.setVector(2, V(0.9,0,0.4,0));
ok('embedded counted', s.stats().embedded === 3 && s.stats().pending === 0);

const vr = s.vectorSearch(V(1,0,0.2,0), 3);
ok('vector ranks a and c above b', vr[0][0] !== 1 && vr[1][0] !== 1, JSON.stringify(vr));

// hybrid: query with no keyword overlap should still reach 'a' via vector
const hy = s.search('zzzz nothing matches', V(1,0,0,0), { k: 3 });
ok('hybrid falls back to vectors', hy.length > 0 && hy[0].rec.id === 'a', JSON.stringify(hy.map(h=>h.rec.id)));

// persistence
s.close();
s = new MemoryStore(dir, DIM).load();
ok('reload keeps chunks', s.stats().chunks === 3);
ok('reload keeps embedded flag', s.stats().embedded === 3);
const rv = s.vectorSearch(V(0,1,0,0), 1);
ok('reload keeps vector values', rv[0][0] === 1 && rv[0][1] > 0.99, JSON.stringify(rv));

// delete
ok('remove works', s.remove('b') === true);
ok('removed hidden from stats', s.stats().chunks === 2);
ok('removed hidden from keyword', !s.search('cat mat', null, {k:5}).some(x=>x.rec.id==='b'));
ok('removed hidden from vectors', !s.vectorSearch(V(0,1,0,0), 5).some(([row])=>row===1));

s.close();
s = new MemoryStore(dir, DIM).load();
ok('tombstone survives reload', s.stats().chunks === 2, JSON.stringify(s.stats()));

// compact
const kept = s.compact();
ok('compact returns live count', kept === 2, String(kept));
ok('compact keeps data', s.stats().chunks === 2 && s.stats().embedded === 2, JSON.stringify(s.stats()));
ok('compact preserved vectors', s.vectorSearch(V(1,0,0,0),1)[0][1] > 0.99);
ok('compact shrank the file', fs.statSync(path.join(dir,'vectors.bin')).size === 2*DIM*4);

// dim change drops vectors but keeps text
s.close();
const s2 = new MemoryStore(dir, 8).load();
ok('dim change keeps text', s2.stats().chunks === 2);
ok('dim change clears vectors', s2.stats().embedded === 0, JSON.stringify(s2.stats()));
s2.close();

// prune
const s3 = new MemoryStore(dir, DIM).load();
s3.add([{id:'old', source:'x', text:'an ancient note from long ago', ts: Date.now()-40*86400000}]);
ok('prune by age', s3.prune({days:30}) === 1 && !s3.byId.get('old').embedded === true);
s3.close();

fs.rmSync(dir, {recursive:true, force:true});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
