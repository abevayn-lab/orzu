// ORZU local thermal-printer bridge for Windows laptops
// Run: node orzu-printer-bridge.js
const http = require('http');
const net = require('net');
const HOST = '127.0.0.1';
const PORT = 17891;
const ALLOWED_ORIGIN = 'https://hospitable-appreciation-production-6442.up.railway.app';
const API_BASE = ALLOWED_ORIGIN;
const PRINT_KEY = 'ORZU-LOCAL-PRINT-KEY-9f42c7b1-2026-11';
let polling = false;
const esc = s => String(s ?? '').normalize('NFKD')
  .replace(/[‘’ʻʼ`]/g, "'").replace(/[“”]/g, '"')
  .replace(/o'/gi, m => m[0] === 'O' ? 'O' : 'o')
  .replace(/g'/gi, m => m[0] === 'G' ? 'G' : 'g')
  .replace(/[^\x20-\x7E]/g, '?');
const money = n => Math.round(Number(n)||0).toLocaleString('en-US') + " som";
function line(s='') { return Buffer.from(esc(s) + '\n', 'ascii'); }
function makeReceipt(o) {
  const out = [
    Buffer.from([0x1b,0x40]),
    Buffer.from([0x1b,0x61,0x01]),
    Buffer.from([0x1b,0x45,0x01]),
    Buffer.from([0x1d,0x21,0x11]),
    line('ORZU'),
    Buffer.from([0x1d,0x21,0x00]),
    line('RESTAURANT'),
    Buffer.from([0x1b,0x45,0x00]),
    line('ARNASOY'),
    line('================================')
  ];
  out.push(
    Buffer.from([0x1b,0x61,0x00]),
    line('BUYURTMA  #' + o.id),
    line('Stol: ' + o.table),
    line('Ofitsiant: ' + (o.waiterName || '-')),
    line(new Date(o.paidAt || o.time || Date.now()).toLocaleString('uz-UZ')),
    line('--------------------------------')
  );
  for (const it of (Array.isArray(o.items) ? o.items : [])) {
    const name = esc(it.name).slice(0, 32);
    const qty = Math.max(0, Number(it.qty)||0);
    const total = money((Number(it.price)||0)*qty);
    out.push(line(name), line('  ' + qty + ' x ' + money(it.price) + ' = ' + total));
  }
  out.push(
    line('--------------------------------'),
    Buffer.from([0x1b,0x45,0x01]),
    line('JAMI: ' + money(o.total)),
    Buffer.from([0x1b,0x45,0x00]),
    line('Tolov: ' + esc(o.paymentMethod || 'Naqd')),
    line('================================'),
    Buffer.from([0x1b,0x61,0x01]),
    line('TASHRIFINGIZ UCHUN RAHMAT!'),
    line(''),
    line('Instagram sahifamizga obuna'),
    line("bo'lgan bo'lsangiz, xizmat haqi"),
    line('OLINMAYDI!'),
    Buffer.from([0x1b,0x45,0x01]),
    line('@orzu_arnasoy'),
    Buffer.from([0x1b,0x45,0x00]),
    line(''),
    line(''),
    line('')
  );
  out.push(Buffer.from([0x1d,0x56,0x42,0x00]));
  return Buffer.concat(out);
}
function send(ip, bytes) {
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:ip,port:9100,timeout:5000},()=>{
      socket.end(bytes,()=>resolve());
    });
    socket.on('error',reject);
    socket.on('timeout',()=>socket.destroy(new Error('Printer ulanish vaqti tugadi')));
  });
}

async function pollPrintJobs(){
  if(polling)return;
  polling=true;
  try{
    const r=await fetch(API_BASE+'/api/printer/jobs',{headers:{'x-orzu-print-key':PRINT_KEY}});
    if(!r.ok)throw new Error('Print queue HTTP '+r.status);
    const data=await r.json();
    if(data.job){
      await send(data.job.printerIp || '192.168.1.51',makeReceipt(data.job.order));
      const ack=await fetch(API_BASE+'/api/printer/jobs/ack',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-orzu-print-key':PRINT_KEY},
        body:JSON.stringify({id:data.job.id})
      });
      if(!ack.ok)throw new Error('Print acknowledgement failed');
      console.log('ORZU chek chiqarildi:',data.job.order.id);
    }
  }catch(e){console.error('ORZU print queue:',e.message)}
  finally{polling=false}
}

const server=http.createServer((req,res)=>{
  const origin=req.headers.origin||'';
  if (origin===ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network','true');
  }
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,service:'ORZU printer bridge'}));}
  if(req.method!=='POST'||req.url!=='/print'){res.writeHead(404);return res.end('Not found');}
  if(origin!==ALLOWED_ORIGIN){res.writeHead(403);return res.end('Origin blocked');}
  let raw='';req.on('data',c=>{raw+=c;if(raw.length>1000000){res.writeHead(413);res.end('Too large');req.destroy();}});
  req.on('end',async()=>{
    try{
      const body=JSON.parse(raw||'{}'), ip=String(body.printerIp||'');
      if(!/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)) throw new Error('Printer IP 192.168.x.x formatida bo‘lishi kerak');
      const o=body.order;
      if(!o||!Array.isArray(o.items)) throw new Error('Chek ma’lumoti noto‘g‘ri');
      await send(ip,makeReceipt(o));
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true}));
    }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message||'Printer xatosi'}));}
  });
});
server.listen(PORT,HOST,()=>{console.log('ORZU printer bridge ishlayapti: http://127.0.0.1:'+PORT);pollPrintJobs();setInterval(pollPrintJobs,2500);});
