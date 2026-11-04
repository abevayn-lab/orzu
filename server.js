const express=require('express'),fs=require('fs'),path=require('path');
const app=express();app.use(express.json({limit:'12mb'}));
const PASS=process.env.ADMIN_PASS||'admin123',SU=(process.env.SUPABASE_URL||'').replace(/\/$/,''),SK=process.env.SUPABASE_KEY;
const CATS=['1-chi taom','2-chi taom','Salat va ichimliklar','Boshqa'];
const LF=path.join(__dirname,'data.json'),HD={apikey:SK,Authorization:'Bearer '+SK,'Content-Type':'application/json'};
let CFG={menu:[],waiters:[{id:1,name:'Ofitsiant 1',pin:'1111'},{id:2,name:'Ofitsiant 2',pin:'2222'}]},O={list:[],seq:10};
// --- saqlash: Supabase (jadval "store": key, data) yoki lokal fayl ---
async function load(){
  if(SU){for(const k of['cfg','orders']){const r=await fetch(`${SU}/rest/v1/store?key=eq.${k}&select=data`,{headers:HD});const j=await r.json();if(!Array.isArray(j))throw new Error('Supabase: '+JSON.stringify(j));if(j[0])k=='cfg'?CFG=j[0].data:O=j[0].data}}
  else if(fs.existsSync(LF)){const d=JSON.parse(fs.readFileSync(LF));CFG=d.CFG;O=d.O}
}
let q0=Promise.resolve();
const save=k=>{
  if(!SU){fs.writeFileSync(LF,JSON.stringify({CFG,O}));return}
  const body=JSON.stringify({key:k,data:k=='cfg'?CFG:O});
  q0=q0.then(()=>fetch(`${SU}/rest/v1/store`,{method:'POST',headers:{...HD,Prefer:'resolution=merge-duplicates'},body})).then(r=>r.ok||r.text().then(t=>console.error('Saqlash xato',t))).catch(console.error);
};
const adm=(q,s,n)=>q.headers['x-admin']===PASS?n():s.status(401).json({error:'auth'});
const wt=(q,s,n)=>{const w=CFG.waiters.find(w=>w.id==q.query.id&&w.pin==q.query.pin);if(!w)return s.status(401).json({error:'auth'});q.w=w;n()};
app.get('/health',(q,s)=>s.json({ok:true,db:SU?'supabase':'file',menu:CFG.menu.length,orders:O.list.length}));
app.get('/api/menu',(q,s)=>s.json({cats:CATS,menu:CFG.menu.filter(m=>!m.hidden)}));
app.post('/api/order',(q,s)=>{
  const table=String(q.body.table||'').trim(),items=[];
  if(!table)return s.status(400).json({error:'Stol raqami kerak'});
  for(const i of q.body.items||[]){const m=CFG.menu.find(m=>m.id==i.id);if(m&&i.qty>0)items.push({name:m.name,price:m.price,qty:Math.min(99,i.qty|0)})}
  if(!items.length)return s.status(400).json({error:"Savat bo'sh"});
  if(!CFG.waiters.length)return s.status(400).json({error:"Ofitsiant yo'q"});
  const act=O.list.filter(o=>o.status!=='paid');
  let wid=(act.find(o=>o.table===table&&CFG.waiters.some(w=>w.id===o.waiter))||{}).waiter;
  if(!wid){
    const cnt=CFG.waiters.map(w=>({id:w.id,n:new Set(act.filter(o=>o.waiter===w.id).map(o=>o.table)).size}));
    const min=Math.min(...cnt.map(c=>c.n)),pool=cnt.filter(c=>c.n===min);
    wid=pool[Math.floor(Math.random()*pool.length)].id;
  }
  const w=CFG.waiters.find(w=>w.id===wid);
  const o={id:++O.seq,table,waiter:wid,waiterName:w.name,items,total:items.reduce((a,i)=>a+i.price*i.qty,0),status:'new',time:Date.now()};
  O.list.push(o);save('orders');s.json({ok:true,id:o.id});
});
app.get('/api/waiters',(q,s)=>s.json(CFG.waiters.map(({id,name})=>({id,name}))));
app.get('/api/waiter/orders',wt,(q,s)=>s.json(O.list.filter(o=>o.waiter===q.w.id).slice(-80).reverse()));
app.post('/api/waiter/status',(q,s,n)=>{q.query=q.body;n()},wt,(q,s)=>{
  const o=O.list.find(o=>o.id==q.body.orderId&&o.waiter===q.w.id);
  if(o&&['accepted','served','paid'].includes(q.body.status)){o.status=q.body.status;save('orders')}s.json({ok:1});
});
app.get('/api/admin/data',adm,(q,s)=>s.json({cats:CATS,menu:CFG.menu,waiters:CFG.waiters,orders:O.list}));
app.post('/api/admin/menu',adm,(q,s)=>{
  const b=q.body,m=CFG.menu.find(m=>m.id==b.id);
  if(m)Object.assign(m,{name:b.name,price:+b.price,cat:+b.cat,hidden:!!b.hidden},b.img?{img:b.img}:{});
  else CFG.menu.push({id:Date.now(),name:b.name,price:+b.price,cat:+b.cat,img:b.img||'',hidden:false});
  save('cfg');s.json({ok:1});
});
app.delete('/api/admin/menu/:id',adm,(q,s)=>{CFG.menu=CFG.menu.filter(m=>m.id!=q.params.id);save('cfg');s.json({ok:1})});
app.post('/api/admin/waiter',adm,(q,s)=>{CFG.waiters.push({id:Date.now(),name:q.body.name,pin:String(q.body.pin)});save('cfg');s.json({ok:1})});
app.delete('/api/admin/waiter/:id',adm,(q,s)=>{CFG.waiters=CFG.waiters.filter(w=>w.id!=q.params.id);save('cfg');s.json({ok:1})});
const P=path.join(__dirname,'public');
app.get(['/admin','/admin/'],(q,s)=>s.sendFile(path.join(P,'admin','index.html')));
app.get(['/waiter','/waiter/'],(q,s)=>s.sendFile(path.join(P,'waiter','index.html')));
app.use(express.static(P));
load().then(()=>app.listen(process.env.PORT||3000,()=>console.log('Orzu ishga tushdi, baza:',SU?'Supabase':'fayl')))
 .catch(e=>{console.error('Bazaga ulanib bo‘lmadi:',e.message);process.exit(1)});
