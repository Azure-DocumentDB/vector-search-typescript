import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, validateURI, safeError, SampleError } from '../dist/config.js';
import { tokenCallback, azureScope, makeClient } from '../dist/auth.js';
import { prepareSeed, validateVector, oracle, readBounded, writeNewJSON, loadFixture } from '../dist/data.js';
import { cases, indexSpec, compatibleIndex, seedData, parseHits, MongoStore } from '../dist/store.js';
import { runCases, closeBounded, within } from '../dist/run.js';
import { comparison } from '../dist/mode.js';
const env = { MONGO_AUTH_MODE:'oidc', MONGO_HOST:'approved.global.mongocluster.cosmos.azure.com', MONGO_DATABASE:'vectorsearch_disposable_unit', MONGO_COLLECTION_PREFIX:'unit', VECTOR_SEARCH_ALLOW_WRITES:'true', QUERY_VECTOR_FILE:'query.json' };
const config = () => loadConfig(env);
const params = () => ({ version:1, timeoutContext:new AbortController().signal, tokenAudience:'https://attacker.invalid', idpInfo:{ issuer:'https://attacker.invalid', clientId:'malicious', requestScopes:['evil'] } });
const controller = () => new AbortController();
const synthetic = prepareSeed([{HotelId:'a',DescriptionVector:[1,0]},{HotelId:'b',DescriptionVector:[2,0.1]},{HotelId:'c',DescriptionVector:[1.1,0.3]}],2);
const planned = cases(comparison);
const inputs = { docs:synthetic, query:[1,0], expected:new Map(['COS','L2','IP'].map(metric=>[metric,oracle(synthetic,[1,0],metric,2)])) };
function fake(item, overrides={}) {
  let indexes=[];
  return { connect:async()=>{}, indexes:async()=>indexes, createIndex:async spec=>{indexes=[spec];}, seed:async()=>({total:3,inserted:3,existing:0}), search:async()=>inputs.expected.get(item.metric).map(id=>({id,score:0})), close:async()=>{}, ...overrides };
}
function cli(args=[],extra={}) {
  return spawnSync(process.execPath,['dist/cli.js',...args],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME,...extra},timeout:15000});
}
test('CLI missing config fails safely with no cloud call',()=>{const r=cli();assert.equal(r.status,1);assert.equal(JSON.parse(r.stderr).error,'writes_require_explicit_opt_in');});
test('explicit live gate without opt-in fails rather than skips',()=>{const r=cli(['--live'],env);assert.equal(r.status,1);assert.match(r.stderr,/live_gate_requires_LIVE_AZURE_TEST_true_no_network/);});
test('unknown CLI arguments fail closed',()=>{assert.equal(cli(['--reset'],env).status,1);});
test('configuration requires unique disposable scope and all explicit opt-ins',()=>{
  for(const key of ['VECTOR_SEARCH_ALLOW_WRITES','MONGO_DATABASE','MONGO_COLLECTION_PREFIX','MONGO_AUTH_MODE','QUERY_VECTOR_FILE']) assert.throws(()=>loadConfig({...env,[key]:undefined}));
  for(const database of ['Hotels','admin','vectorsearch_disposable','vectorsearch_disposable_../x']) assert.throws(()=>loadConfig({...env,MONGO_DATABASE:database}));
  assert.throws(()=>loadConfig({...env,MONGO_COLLECTION:'hotels'}));
  assert.throws(()=>loadConfig({...env,EMBEDDING_MODE:'azure-openai'}));
});
test('numeric config rejects zero, NaN, decimals, trailing junk and excessive limits',()=>{
  for(const key of ['LOAD_SIZE_BATCH','TOP_K','VECTOR_SEARCH_CASE_TIMEOUT_MS','EMBEDDING_DIMENSIONS']) for(const value of ['0','NaN','1.2','12junk','1000000000','-1']) assert.throws(()=>loadConfig({...env,[key]:value}));
  assert.equal(config().dimensions,1536);
});
test('strict Azure domain validation precedes credential creation',()=>{
  for(const host of ['localhost','127.0.0.1','evil.azure.com','a.mongocluster.cosmos.azure.com.evil.test','nested.a.mongocluster.cosmos.azure.com','a.mongocluster.cosmos.azure.cn','https://a.mongocluster.cosmos.azure.com','-a.mongocluster.cosmos.azure.com']) assert.throws(()=>loadConfig({...env,MONGO_HOST:host}));
  assert.throws(()=>makeClient({...config(),host:'attacker.invalid'},controller().signal));
  assert.throws(()=>loadConfig({...env,MONGO_CONNECTION_STRING:'mongodb+srv://user:secret@approved.mongocluster.cosmos.azure.com'}));
});
test('native URI TLS, endpoint, auth and duplicate option defenses',()=>{
  const base='mongodb+srv://user:password@approved.mongocluster.cosmos.azure.com/';
  assert.equal(validateURI(base+'?tls=true&retryWrites=false&authMechanism=SCRAM-SHA-256&authSource=admin&appName=unit'), 'approved.mongocluster.cosmos.azure.com');
  for(const suffix of ['?tls=false','?TLS=true&tls=true','?tlsAllowInvalidCertificates=true','?tlsInsecure=true','?tlsAllowInvalidHostnames=true','?authMechanism=MONGODB-OIDC','?authMechanismProperties=ENVIRONMENT:azure','?authSource=other','?proxyHost=evil','?socketTimeoutMS=0','?retryWrites=true','?unknown=x','?ssl=false','#','Hotels']) assert.throws(()=>validateURI(base+suffix));
  for(const uri of ['mongodb://user:password@approved.mongocluster.cosmos.azure.com/',base.replace(':password',''),base.replace('approved.mongocluster.cosmos.azure.com','evil.test'),base.replace('.com/','.com:27017/')]) assert.throws(()=>validateURI(uri));
});
test('native construction enables TLS without OIDC fallback',async()=>{
  const c=loadConfig({...env,MONGO_AUTH_MODE:'connection-string',MONGO_CONNECTION_STRING:'mongodb+srv://user:password@approved.mongocluster.cosmos.azure.com/?tls=true'});
  const client=makeClient(c,controller().signal); assert.equal(client.options.tls,true); assert.equal(client.options.rejectUnauthorized,true); assert.equal(client.options.checkServerIdentity,undefined); assert.equal(client.options.retryWrites,false);assert.equal(client.options.credentials.mechanism,'DEFAULT');await client.close();
});
test('OIDC callback v1 returns seconds from epoch milliseconds and fixed audience',async()=>{
  let args;
  const result=await tokenCallback(params(),{getToken:async(...input)=>{args=input;return {token:'unit-token',expiresOnTimestamp:4600123};}},controller().signal,()=>1000000);
  assert.equal(result.expiresInSeconds,3600);assert.equal(result.accessToken,'unit-token');assert.equal(args[0],azureScope);assert.ok(args[1].abortSignal instanceof AbortSignal);
});
test('OIDC rejects empty/null/expired/nonfinite tokens and unsupported callback versions',async()=>{
  for(const token of [null,{token:'',expiresOnTimestamp:5000},{token:' ',expiresOnTimestamp:5000},{token:'x',expiresOnTimestamp:1000},{token:'x',expiresOnTimestamp:1999},{token:'x',expiresOnTimestamp:NaN}]) await assert.rejects(tokenCallback(params(),{getToken:async()=>token},controller().signal,()=>1000));
  await assert.rejects(tokenCallback({...params(),version:2},{getToken:async()=>{throw Error('must not request');}},controller().signal));
});
test('OIDC honors driver cancellation before credential calls and after token delivery',async()=>{
  const c=controller(); c.abort(); let called=false;
  await assert.rejects(tokenCallback({...params(),timeoutContext:c.signal},{getToken:async()=>{called=true;}},controller().signal));assert.equal(called,false);
  const d=controller();await assert.rejects(tokenCallback(params(),{getToken:async()=>{d.abort();return {token:'x',expiresOnTimestamp:Date.now()+60000};}},d.signal));
});
test('seed rejects malformed IDs/vectors/unsafe fields before writes',()=>{
  for(const value of [[],null,[{HotelId:'1',DescriptionVector:[0,0]}],[{HotelId:'1',DescriptionVector:[1,null]}],[{HotelId:'1',DescriptionVector:[1,Infinity]}],[{HotelId:'1',DescriptionVector:[1]}],[{HotelId:'1',_id:5,DescriptionVector:[1,0]}],[{HotelId:'1','bad.key':1,DescriptionVector:[1,0]}]]) assert.throws(()=>prepareSeed(value,2));
  assert.throws(()=>prepareSeed([{HotelId:'1',DescriptionVector:[1,0]},{HotelId:'1',DescriptionVector:[1,0]}],2));
  assert.equal(synthetic[0]._id,'vectorsearch:a');assert.throws(()=>validateVector([1e308,1e308],2));
});
test('independent metric oracle discriminates COS, L2 and IP without database scores',()=>{
  assert.deepEqual(oracle(synthetic,[1,0],'COS',2),['vectorsearch:a','vectorsearch:b']);
  assert.deepEqual(oracle(synthetic,[1,0],'L2',2),['vectorsearch:a','vectorsearch:c']);
  assert.deepEqual(oracle(synthetic,[1,0],'IP',2),['vectorsearch:b','vectorsearch:c']);
  assert.throws(()=>oracle([{...synthetic[0],_id:'x'},synthetic[0]],[1,0],'COS',1));
});
test('full index catalog: exact semantic match or refusal, never dropping',()=>{
  const spec=indexSpec({algorithm:'ivf',metric:'COS'});
  assert.equal(compatibleIndex([],spec),false);assert.equal(compatibleIndex([{...spec,v:2,ns:'unit',background:true,sparse:false,unique:false,hidden:false}],spec),true);
  for(const [key,value] of Object.entries({sparse:true,unique:true,hidden:true,expireAfterSeconds:0,partialFilterExpression:{HotelId:'1'},collation:{locale:'en'},futureOption:false})) assert.throws(()=>compatibleIndex([{...spec,[key]:value}],spec),key);
  assert.throws(()=>compatibleIndex([{...spec,cosmosSearchOptions:{...spec.cosmosSearchOptions,numLists:'1'}}],spec));
  assert.throws(()=>compatibleIndex([{...spec,cosmosSearchOptions:{...spec.cosmosSearchOptions,extra:1}}],spec));
  assert.throws(()=>compatibleIndex([{...spec,key:{DescriptionVector:'cosmosSearch',other:1}}],spec));
  assert.throws(()=>compatibleIndex([spec,{...spec,name:'second'}],spec));
  assert.equal(compatibleIndex([{name:'other',key:{HotelId:1}},spec],spec),true);
});
test('stable insert-only seeds preserve changed existing and unrelated records',async()=>{
  const stored=new Map([['vectorsearch:a',{...synthetic[0],HotelName:'keep-user-change'}],['unrelated',{_id:'unrelated',note:'keep'}]]);
  const collection={bulkWrite:async(ops,options)=>{
    assert.equal(options.ordered,true);assert.ok(options.timeoutMS>0);let matchedCount=0,upsertedCount=0;
    for(const {updateOne:op} of ops){assert.deepEqual(Object.keys(op.update),['$setOnInsert']);assert.equal(op.upsert,true);if(stored.has(op.filter._id))matchedCount++;else{stored.set(op.filter._id,op.update.$setOnInsert);upsertedCount++;}}
    return {isOk:()=>true,upsertedCount,matchedCount,modifiedCount:0};
  }};
  assert.deepEqual(await seedData(collection,synthetic,2,()=>1000),{total:3,inserted:2,existing:1});
  assert.deepEqual(await seedData(collection,synthetic,2,()=>1000),{total:3,inserted:0,existing:3});
  assert.equal(stored.get('vectorsearch:a').HotelName,'keep-user-change');assert.equal(stored.get('unrelated').note,'keep');
});
test('write failures and partial acknowledgments are never swallowed',async()=>{
  let count=0;
  await assert.rejects(seedData({bulkWrite:async()=>{count++;throw Error('denied');}},synthetic,1,()=>1000));assert.equal(count,1);
  await assert.rejects(seedData({bulkWrite:async()=>({isOk:()=>true,matchedCount:0,upsertedCount:0,modifiedCount:0})},synthetic,2,()=>1000));
  for(const batch of [0,NaN,-1,1.5]) await assert.rejects(seedData({bulkWrite:async()=>assert.fail()},synthetic,batch,()=>1000));
});
test('results reject absent, null, nonfinite scores and preserve zero/negative scores',()=>{
  for(const score of [undefined,null,NaN,Infinity,'0']) assert.throws(()=>parseHits([{document:{_id:'id'},score}],1));
  assert.deepEqual(parseHits([{document:{_id:'a'},score:0},{document:{_id:'b'},score:-1}],2),[{id:'a',score:0},{id:'b',score:-1}]);
  assert.throws(()=>parseHits([],5));assert.throws(()=>parseHits([{document:{},score:0}],1));
});
test('all cases attempted after first failure, truthful aggregate and cleanup',async()=>{
  const visited=[],closed=[];
  const r=await runCases(config(),planned,inputs,(c,item)=>{visited.push(item);return fake(item,{connect:async()=>{if(visited.length===1)throw {code:67,message:'mongodb://secret'};},close:async()=>closed.push(item)});});
  assert.equal(r.cases.length,comparison?9:3);assert.equal(r.failed,1);assert.equal(r.succeeded,planned.length-1);assert.equal(closed.length,planned.length);assert.equal(r.cases[0].serverCode,67);assert.doesNotMatch(JSON.stringify(r),/mongodb:\/\/secret/);
});
test('index checked on repeated seeded collections and missing indexes rebuilt',async()=>{
  let checked=0,created=0,seeded=0;
  const r=await runCases(config(),planned,inputs,(c,item)=>{let indexes=[];return fake(item,{indexes:async()=>{checked++;return indexes;},createIndex:async spec=>{created++;indexes=[spec];},seed:async()=>{seeded++;return {total:3,inserted:0,existing:3};}});});
  assert.equal(r.failed,0);assert.equal(checked,planned.length*2);assert.equal(created,planned.length);assert.equal(seeded,planned.length);
});
test('index conflict fails before seeding and close failure fails gate',async()=>{
  let writes=0;
  const conflict=await runCases(config(),planned,inputs,(c,item)=>fake(item,{indexes:async()=>[{...indexSpec(item),sparse:true}],seed:async()=>{writes++;}}));assert.equal(conflict.failed,planned.length);assert.equal(writes,0);
  const cleanup=await runCases(config(),planned,inputs,(c,item)=>fake(item,{close:async()=>{throw Error('secret');}}));assert.equal(cleanup.failed,planned.length);assert.ok(cleanup.cases.every(row=>row.cleanupError));
});
test('metric rank mismatch is failure even when results are nonempty',async()=>{
  const r=await runCases(config(),planned,inputs,(c,item)=>fake(item,{search:async()=>[{id:'wrong',score:99}]}));assert.equal(r.failed,planned.length);assert.ok(r.cases.every(row=>row.error==='independent_metric_rank_oracle_mismatch'));
});
test('production adapter uses scoped DB commands, verified indexes and closes cursors',async()=>{
  const names=[],commands=[];let closed=0;
  const spec=indexSpec(planned[0]);
  const coll={collectionName:'unit_ivf_cos',listIndexes:()=>({toArray:async()=>[spec],close:async()=>{closed++;}}),aggregate:(pipeline,options)=>{assert.equal(pipeline[0].$search.cosmosSearch.path,'DescriptionVector');assert.ok(options.timeoutMS>0);return {toArray:async()=>[{document:{_id:'vectorsearch:a'},score:1}],close:async()=>{closed++;}};}};
  const client={db:name=>{names.push(name);return {collection:()=>coll,command:async command=>{commands.push(command);}};},connect:async()=>{},close:async()=>{closed++;}};
  const store=new MongoStore(client,config(),planned[0],controller().signal);await store.connect();await store.indexes();await store.createIndex(spec);await store.search([1,0],1);await store.close();assert.deepEqual(names,['vectorsearch_disposable_unit']);assert.deepEqual(commands[0],{ping:1});assert.equal(closed,3);
});
test('bounded cancellation and cleanup do not hang',async()=>{
  const c=controller();setTimeout(()=>c.abort(),10);await assert.rejects(within(new Promise(()=>{}),c.signal),/case_deadline_exceeded/);
  await assert.rejects(closeBounded({close:()=>new Promise(()=>{})},10),/cleanup_deadline_exceeded/);
});
test('safe errors expose only controlled reason and numeric server code',()=>{
  assert.deepEqual(safeError(new Error('Bearer secret uri password document')),{error:'operation_failed_details_withheld'});
  assert.deepEqual(safeError({code:'secret'}),{error:'operation_failed_details_withheld'});
  assert.deepEqual(safeError(new SampleError('expected_reason')),{error:'expected_reason'});
});
test('safe local files: exclusive output, bounded regular reads, hash verification',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'vector-ts-'));
  try {const file=path.join(dir,'file.json');await writeNewJSON(file,[1,2]);await assert.rejects(writeNewJSON(file,[3]));assert.equal(await readFile(file,'utf8'),'[1,2]\n');await assert.rejects(readBounded(file,2));await assert.rejects(loadFixture(file),/fixture_checksum_mismatch/);const link=path.join(dir,'link');await symlink(file,link);await assert.rejects(writeNewJSON(link,[3]));}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI bad fixture produces nonzero redacted error before network',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'vector-ts-cli-'));
  try{const file=path.join(dir,'bad.json');await writeFile(file,'[]');const r=cli([],{...env,DATA_FILE_WITH_VECTORS:file});assert.equal(r.status,1);assert.match(r.stderr,/fixture_checksum_mismatch/);assert.doesNotMatch(r.stderr,/approved.global/);}
  finally{await rm(dir,{recursive:true,force:true});}
});

test('configured vector field and seed ID overrides cannot be silently ignored',()=>{
  assert.throws(()=>loadConfig({...env,EMBEDDED_FIELD:'OtherVector'}));
  assert.throws(()=>loadConfig({...env,SEED_ID_FIELD:'OtherId'}));
  assert.equal(loadConfig({...env,EMBEDDED_FIELD:'DescriptionVector',SEED_ID_FIELD:'HotelId'}).dimensions,1536);
});
test('each case has its own deadline and aborted cases still close and continue',async()=>{
  let closed=0;
  const c={...config(),caseTimeoutMS:10};
  const r=await runCases(c,planned,inputs,()=>({connect:()=>new Promise(()=>{}),close:async()=>{closed++;}}));
  assert.equal(r.failed,planned.length);assert.equal(closed,planned.length);assert.ok(r.cases.every(row=>row.error==='case_deadline_exceeded'));
});
test('acknowledged create without visible index fails before seeding',async()=>{
  let writes=0;
  const r=await runCases(config(),planned,inputs,(c,item)=>fake(item,{indexes:async()=>[],createIndex:async()=>{},seed:async()=>{writes++;}}));
  assert.equal(r.failed,planned.length);assert.equal(writes,0);assert.ok(r.cases.every(row=>row.error==='index_not_visible_after_create'));
});
test('production adapter closes failing list/search cursors and only treats namespace absence as empty',async()=>{
  let closed=0,code=13;
  const cursor=()=>({toArray:async()=>{throw {code,message:'secret'};},close:async()=>{closed++;}});
  const client={db:()=>({collection:()=>({listIndexes:cursor,aggregate:cursor})}),close:async()=>{}};
  const store=new MongoStore(client,config(),planned[0],controller().signal);
  await assert.rejects(store.indexes());code=26;assert.deepEqual(await store.indexes(),[]);
  await assert.rejects(store.search([1,0],1));assert.equal(closed,3);
});
test('actual CLI aggregate exit status for connect/index/write/empty/rank/close failures',()=>{
  for(const failure of ['none','connect','index','seed','empty','rank','close']) {
    const r=spawnSync(process.execPath,['--import','./test/fixtures/cli-preload.mjs','dist/cli.js'],{encoding:'utf8',env:{PATH:process.env.PATH,...env,TEST_FAILURE:failure,TOP_K:'1'},timeout:15000});
    assert.equal(r.status,failure==='none'?0:1,`${failure}: ${r.stderr}`);
    const report=JSON.parse(r.stdout);assert.equal(report.cases.length,planned.length);assert.equal(report.failed,failure==='none'?0:planned.length);assert.doesNotMatch(r.stdout+r.stderr,/mongodb\+srv:\/\/secret/);
  }
});

test('real MongoDB constructor supports nonempty OIDC username with no native password',async()=>{
  const username='00000000-0000-4000-8000-000000000001';
  const c=loadConfig({...env,MONGO_OIDC_USERNAME:username});
  // Real production makeClient/MongoClient constructor: no transport hooks,
  // no connect(), DNS, token acquisition or Azure calls.
  const client=makeClient(c,controller().signal);
  try {
    assert.equal(client.options.credentials.username,username);
    assert.equal(client.options.credentials.password,'');
    assert.equal(client.options.credentials.mechanism,'MONGODB-OIDC');
    assert.equal(client.options.credentials.source,'$external');
    assert.equal(typeof client.options.credentials.mechanismProperties.OIDC_CALLBACK,'function');
    assert.equal(client.options.tls,true);
    assert.equal(client.options.rejectUnauthorized,true);
    assert.equal(client.options.checkServerIdentity,undefined);
    assert.equal(client.options.retryWrites,false);
  } finally { await client.close(); }
});
