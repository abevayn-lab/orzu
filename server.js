const express=require('express'),fs=require('fs'),path=require('path');
const app=express();app.use(express.json({limit:'12mb'}));
const F=path.join(__dirname,'data.json'),PASS=process.env.ADMIN_PASS||'admin123';
const CATS=['1-chi taom','2-chi taom','Salat va ichimliklar','Boshqa'];
let D=fs.existsSync(F)?JSON.parse(fs.readFileSync(F)):{menu:[],waiters:[{id:1,name:'Ofitsiant 1',pin:'1111'},{id:2,name:'Ofitsiant 2',pin:'2222'}],orders:[],seq:10};
const save=()=>fs.writeFileSync(F,JSON.stringify(D));
const adm=(q,s,n)=>q.headers['x-admin']===PASS?n():s.status(401).json({error:'auth'});
const wt=(q,s,n)=>{const w=D.waiters.find(w=>w.id==q.query.id&&w.pin==q.query.pin);if(!w)return s.status(401).json({error:'auth'});q.w=w;n()};
app.get('/api/menu',(q,s)=>s.json({cats:CATS,menu:D.menu.filter(m=>!m.hidden)}));
app.post('/api/order',(q,s)=>{
  const table=String(q.body.table||'').trim(),items=[];
  if(!table)return s.status(400).json({error:'Stol raqami kerak'});
  for(const i of q.body.items||[]){const m=D.menu.find(m=>m.id==i.id);if(m&&i.qty>0)items.push({name:m.name,price:m.price,qty:Math.min(99,i.qty|0)})}
  if(!items.length)return s.status(400).json({error:"Savat bo'sh"});
  if(!D.waiters.length)return s.status(400).json({error:"Ofitsiant yo'q"});
  const act=D.orders.filter(o=>o.status!=='paid');
  let wid=(act.find(o=>o.table===table)||{}).waiter;
  if(!wid){ // eng kam stoli bor ofitsiant, teng bo'lsa tasodifiy
    const cnt=D.waiters.map(w=>({id:w.id,n:new Set(act.filter(o=>o.waiter===w.id).map(o=>o.table)).size}));
    const min=Math.min(...cnt.map(c=>c.n)),pool=cnt.filter(c=>c.n===min);
    wid=pool[Math.floor(Math.random()*pool.length)].id;
  }
  const w=D.waiters.find(w=>w.id===wid);
  const o={id:++D.seq,table,waiter:wid,waiterName:w.name,items,total:items.reduce((a,i)=>a+i.price*i.qty,0),status:'new',time:Date.now()};
  D.orders.push(o);save();s.json({ok:true,id:o.id});
});
app.get('/api/waiters',(q,s)=>s.json(D.waiters.map(({id,name})=>({id,name}))));
app.get('/api/waiter/orders',wt,(q,s)=>s.json(D.orders.filter(o=>o.waiter===q.w.id).slice(-80).reverse()));
app.post('/api/waiter/status',(q,s,n)=>{q.query=q.body;n()},wt,(q,s)=>{
  const o=D.orders.find(o=>o.id==q.body.orderId&&o.waiter===q.w.id);
  if(o&&['accepted','served','paid'].includes(q.body.status)){o.status=q.body.status;save()}s.json({ok:1});
});
app.get('/api/admin/data',adm,(q,s)=>s.json({cats:CATS,menu:D.menu,waiters:D.waiters,orders:D.orders}));
app.post('/api/admin/menu',adm,(q,s)=>{
  const b=q.body,m=D.menu.find(m=>m.id==b.id);
  if(m)Object.assign(m,{name:b.name,price:+b.price,cat:+b.cat,hidden:!!b.hidden},b.img?{img:b.img}:{});
  else D.menu.push({id:++D.seq,name:b.name,price:+b.price,cat:+b.cat,img:b.img||'',hidden:false});
  save();s.json({ok:1});
});
app.delete('/api/admin/menu/:id',adm,(q,s)=>{D.menu=D.menu.filter(m=>m.id!=q.params.id);save();s.json({ok:1})});
app.post('/api/admin/waiter',adm,(q,s)=>{D.waiters.push({id:++D.seq,name:q.body.name,pin:String(q.body.pin)});save();s.json({ok:1})});
app.delete('/api/admin/waiter/:id',adm,(q,s)=>{D.waiters=D.waiters.filter(w=>w.id!=q.params.id);save();s.json({ok:1})});
app.use(express.static(path.join(__dirname,'public')));
app.listen(process.env.PORT||3000,()=>console.log('Orzu ishga tushdi'));
