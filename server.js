
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json({ limit: '12mb' }));

const PASS = process.env.ADMIN_PASS || 'admin123';
const SU = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SK = process.env.SUPABASE_KEY;

const CATS = [
  '1-chi taom',
  '2-chi taom',
  'Salat va ichimliklar',
  'Boshqa'
];

const P = __dirname;
const PUB = path.join(__dirname, 'mnt', 'user-data', 'outputs', 'orzu', 'public');
const LF = path.join(P, 'data.json');

const HD = {
  apikey: SK,
  Authorization: 'Bearer ' + SK,
  'Content-Type': 'application/json'
};

let CFG = {
  menu: [],
  waiters: [
    { id: 1, name: 'Ofitsiant 1', pin: '1111' },
    { id: 2, name: 'Ofitsiant 2', pin: '2222' }
  ]
};

let O = {
  list: [],
  seq: 10
};

// DATABASE LOAD
async function load() {
  if (SU) {
    for (const k of ['cfg', 'orders']) {
      const r = await fetch(
        `${SU}/rest/v1/store?key=eq.${k}&select=data`,
        { headers: HD }
      );

      if (!r.ok) throw new Error(await r.text());

      const j = await r.json();

      if (j[0]) {
        if (k === 'cfg') CFG = j[0].data;
        else O = j[0].data;
      }
    }
  } else if (fs.existsSync(LF)) {
    const d = JSON.parse(fs.readFileSync(LF, 'utf8'));
    CFG = d.CFG || CFG;
    O = d.O || O;
  }
}

// DATABASE SAVE
let q0 = Promise.resolve();

function save(k) {
  if (!SU) {
    fs.writeFileSync(LF, JSON.stringify({ CFG, O }));
    return;
  }

  const body = JSON.stringify({
    key: k,
    data: k === 'cfg' ? CFG : O
  });

  q0 = q0.then(async () => {
    const r = await fetch(`${SU}/rest/v1/store`, {
      method: 'POST',
      headers: {
        ...HD,
        Prefer: 'resolution=merge-duplicates'
      },
      body
    });

    if (!r.ok) console.error('Saqlash xato:', await r.text());
  }).catch(console.error);
}

// ADMIN AUTH
function adm(q, s, n) {
  if (q.headers['x-admin'] === PASS) return n();
  return s.status(401).json({ error: 'auth' });
}

// WAITER AUTH
function wt(q, s, n) {
  const w = CFG.waiters.find(
    w => w.id == q.query.id && w.pin == q.query.pin
  );

  if (!w) return s.status(401).json({ error: 'auth' });

  q.w = w;
  n();
}

// HEALTH
app.get('/health', (q, s) => {
  s.json({
    ok: true,
    db: SU ? 'supabase' : 'file',
    menu: CFG.menu.length,
    orders: O.list.length
  });
});

// CUSTOMER MENU
app.get('/api/menu', (q, s) => {
  s.json({
    cats: CATS,
    menu: CFG.menu.filter(m => !m.hidden)
  });
});

// CUSTOMER ORDER
app.post('/api/order', (q, s) => {
  const table = String(q.body.table || '').trim();
  const items = [];

  if (!table) {
    return s.status(400).json({ error: 'Stol raqami kerak' });
  }

  for (const i of q.body.items || []) {
    const m = CFG.menu.find(m => m.id == i.id);

    if (m && Number(i.qty) > 0) {
      items.push({
        name: m.name,
        price: m.price,
        qty: Math.min(99, Number(i.qty) | 0)
      });
    }
  }

  if (!items.length) {
    return s.status(400).json({ error: "Savat bo'sh" });
  }

  if (!CFG.waiters.length) {
    return s.status(400).json({ error: "Ofitsiant yo'q" });
  }

  const act = O.list.filter(o => o.status !== 'paid');

  let wid = (
    act.find(o =>
      o.table === table &&
      CFG.waiters.some(w => w.id === o.waiter)
    ) || {}
  ).waiter;

  if (!wid) {
    const cnt = CFG.waiters.map(w => ({
      id: w.id,
      n: new Set(
        act.filter(o => o.waiter === w.id).map(o => o.table)
      ).size
    }));

    const min = Math.min(...cnt.map(c => c.n));
    const pool = cnt.filter(c => c.n === min);

    wid = pool[Math.floor(Math.random() * pool.length)].id;
  }

  const w = CFG.waiters.find(w => w.id === wid);

  const o = {
    id: ++O.seq,
    table,
    waiter: wid,
    waiterName: w.name,
    items,
    total: items.reduce((a, i) => a + i.price * i.qty, 0),
    status: 'new',
    time: Date.now()
  };

  O.list.push(o);
  save('orders');

  s.json({ ok: true, id: o.id });
});

// WAITERS LIST
app.get('/api/waiters', (q, s) => {
  s.json(CFG.waiters.map(({ id, name }) => ({ id, name })));
});

// WAITER ORDERS
app.get('/api/waiter/orders', wt, (q, s) => {
  s.json(
    O.list
      .filter(o => o.waiter === q.w.id)
      .slice(-80)
      .reverse()
  );
});

// WAITER STATUS
app.post('/api/waiter/status', (q, s, n) => {
  q.query = q.body;
  n();
}, wt, (q, s) => {
  const o = O.list.find(
    o => o.id == q.body.orderId && o.waiter === q.w.id
  );

  if (o && ['accepted', 'served', 'paid'].includes(q.body.status)) {
    o.status = q.body.status;
    save('orders');
  }

  s.json({ ok: 1 });
});

// WAITER ADD ITEMS (to an existing order, or a new order for a table)
app.post('/api/waiter/add', (q, s, n) => {
  q.query = q.body;
  n();
}, wt, (q, s) => {
  const items = [];

  for (const i of q.body.items || []) {
    const m = CFG.menu.find(m => m.id == i.id);
    const qty = Math.min(99, Number(i.qty) | 0);

    if (m && qty > 0) items.push({ name: m.name, price: m.price, qty });
  }

  if (!items.length) {
    return s.status(400).json({ error: "Taom tanlanmagan" });
  }

  let o;

  if (q.body.orderId) {
    o = O.list.find(
      o => o.id == q.body.orderId && o.waiter === q.w.id
    );

    if (!o || o.status === 'paid') {
      return s.status(400).json({ error: 'Buyurtma topilmadi' });
    }

    for (const it of items) {
      const ex = o.items.find(
        x => x.name === it.name && x.price === it.price
      );

      if (ex) ex.qty = Math.min(99, ex.qty + it.qty);
      else o.items.push(it);
    }

    if (o.status === 'served') o.status = 'accepted';
  } else {
    const table = String(q.body.table || '').trim();

    if (!table) {
      return s.status(400).json({ error: 'Stol raqami kerak' });
    }

    o = {
      id: ++O.seq,
      table,
      waiter: q.w.id,
      waiterName: q.w.name,
      items,
      total: 0,
      status: 'accepted',
      time: Date.now()
    };

    O.list.push(o);
  }

  o.total = o.items.reduce((a, i) => a + i.price * i.qty, 0);
  save('orders');

  s.json({ ok: true, id: o.id });
});

// ADMIN DATA
app.get('/api/admin/data', adm, (q, s) => {
  s.json({
    cats: CATS,
    menu: CFG.menu,
    waiters: CFG.waiters,
    orders: O.list
  });
});

// ADMIN ADD / EDIT MENU
app.post('/api/admin/menu', adm, (q, s) => {
  const b = q.body;
  const m = CFG.menu.find(m => m.id == b.id);

  if (m) {
    Object.assign(
      m,
      {
        name: b.name,
        price: +b.price,
        cat: +b.cat,
        hidden: !!b.hidden
      },
      b.img ? { img: b.img } : {}
    );
  } else {
    CFG.menu.push({
      id: Date.now(),
      name: b.name,
      price: +b.price,
      cat: +b.cat,
      img: b.img || '',
      hidden: false
    });
  }

  save('cfg');
  s.json({ ok: 1 });
});

// ADMIN DELETE MENU
app.delete('/api/admin/menu/:id', adm, (q, s) => {
  CFG.menu = CFG.menu.filter(m => m.id != q.params.id);
  save('cfg');
  s.json({ ok: 1 });
});

// ADMIN ADD WAITER
app.post('/api/admin/waiter', adm, (q, s) => {
  CFG.waiters.push({
    id: Date.now(),
    name: q.body.name,
    pin: String(q.body.pin)
  });

  save('cfg');
  s.json({ ok: 1 });
});

// ADMIN DELETE WAITER
app.delete('/api/admin/waiter/:id', adm, (q, s) => {
  CFG.waiters = CFG.waiters.filter(w => w.id != q.params.id);
  save('cfg');
  s.json({ ok: 1 });
});

// CUSTOMER PAGE
app.get('/', (q, s) => {
  s.sendFile(path.join(P, 'index.html'));
});

// ADMIN PAGE
app.get(['/admin', '/admin/'], (q, s) => {
  s.sendFile(path.join(PUB, 'admin', 'index.html'));
});

// WAITER PAGE
app.get(['/waiter', '/waiter/'], (q, s) => {
  s.sendFile(path.join(PUB, 'waiter', 'index.html'));
});

// STATIC FILES
app.use(express.static(P));

// START SERVER
load()
  .then(() => {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        'Orzu ishga tushdi, baza:',
        SU ? 'Supabase' : 'fayl'
      );
    });
  })
  .catch(e => {
    console.error('Bazaga ulanib bo‘lmadi:', e.message);
    process.exit(1);
  });
