// FITTING AI LIVE - backend tipis (tanpa dependensi). Node >= 20.
// Fungsi: simpan API key di server, kuota di server, idempotensi, rate limit, validasi input.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {FAL_KEY,FAL_MODEL='fal-ai/image-apps-v2/virtual-try-on',PORT=3000}=process.env;
const LIMIT=+process.env.FREE_QUOTA||3,DB=path.join(__dirname,'data.json'),MAX_BODY=6e6;
const IMG=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/,RID=/^[A-Za-z0-9-]{8,64}$/;
let db={users:{}};try{db=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{}
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));
const hits=new Map();
function limited(k){const n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<6e4);a.push(n);hits.set(k,a);return a.length>10}
function uid(req,res){const m=/fal_uid=([\w-]{36})/.exec(req.headers.cookie||'');let id=m&&m[1];
 if(!id){id=crypto.randomUUID();res.setHeader('Set-Cookie',`fal_uid=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`)}
 return db.users[id]||(db.users[id]={used:0,reqs:{}}),id}
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
function body(req){return new Promise((ok,no)=>{let b='',n=0;req.on('data',d=>{n+=d.length;if(n>MAX_BODY){no(new Error('big'));req.destroy()}else b+=d});req.on('end',()=>{try{ok(JSON.parse(b))}catch(e){no(e)}})})}
async function callFal(person,garment){
 const r=await fetch('https://fal.run/'+FAL_MODEL,{method:'POST',headers:{Authorization:'Key '+FAL_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({person_image_url:person,clothing_image_url:garment,preserve_pose:true}),signal:AbortSignal.timeout(120000)});
 if(!r.ok)throw new Error('fal '+r.status);const u=(await r.json()).images?.[0]?.url;if(!/^https:\/\//.test(u||''))throw new Error('no image');return u}
http.createServer(async(req,res)=>{try{
 const id=uid(req,res),u=db.users[id],ip=req.socket.remoteAddress;
 if(req.method==='GET'&&req.url==='/api/config')return send(res,200,{aiConfigured:!!FAL_KEY,limit:LIMIT,remaining:Math.max(0,LIMIT-u.used)});
 if(req.method==='POST'&&req.url==='/api/tryon'){
  if(!FAL_KEY)return send(res,503,{code:'NOT_CONFIGURED'});
  if(limited(id)||limited('ip'+ip))return send(res,429,{code:'RATE'});
  const b=await body(req);
  if(b.consent!==true||!RID.test(b.requestId||'')||!IMG.test(b.person||'')||!IMG.test(b.garment||''))return send(res,400,{code:'BAD_INPUT'});
  const prev=u.reqs[b.requestId];
  if(prev?.url)return send(res,200,{imageUrl:prev.url,remaining:LIMIT-u.used,replay:true}); // idempoten: tidak dipotong lagi
  if(prev)return send(res,409,{code:'PENDING'});
  if(u.used>=LIMIT)return send(res,402,{code:'QUOTA',remaining:0});
  u.used++;u.reqs[b.requestId]={};save(); // potong atomik (satu proses Node) sebelum memanggil AI
  try{const url=await callFal(b.person,b.garment);u.reqs[b.requestId]={url};save();return send(res,200,{imageUrl:url,remaining:LIMIT-u.used})}
  catch(e){u.used--;delete u.reqs[b.requestId];save();console.error(e.message);return send(res,502,{code:'AI_FAILED',remaining:LIMIT-u.used})} // gagal teknis: kuota dikembalikan
 }
 if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Permissions-Policy':'camera=(self)'});return res.end(fs.readFileSync(path.join(__dirname,'public/index.html')))}
 send(res,404,{code:'NOT_FOUND'});
}catch(e){send(res,500,{code:'ERROR'})}}).listen(PORT,()=>console.log('http://localhost:'+PORT+(FAL_KEY?'':'  (FAL_KEY belum diisi: mode demo)')));
