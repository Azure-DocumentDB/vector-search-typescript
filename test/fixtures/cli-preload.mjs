// Local CLI tests only: replace database/identity modules before production CLI import.
// Never loaded by npm start/test:live and never used as managed-Azure evidence.
import { registerHooks } from 'node:module';
const failure = process.env.TEST_FAILURE;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/auth.js') || specifier === './auth.js') return { url: 'test:auth', shortCircuit: true };
    if ((specifier.endsWith('/data.js') || specifier === './data.js') && context.parentURL?.endsWith('/run.js')) return { url: 'test:data', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:data') return { format:'module', shortCircuit:true, source: `
      export async function loadFixture(){return [{_id:'vectorsearch:a',HotelId:'a',DescriptionVector:[1,0]}]}
      export async function loadQuery(){return [1,0]}
      export function oracle(){return ['vectorsearch:a']}
    ` };
    if (url === 'test:auth') return { format:'module', shortCircuit:true, source: `
      const failure=${JSON.stringify(failure)};let indexes=[];
      const cursor=rows=>({toArray:async()=>rows,close:async()=>{}});
      export function makeClient(){return {
        connect:async()=>{if(failure==='connect')throw {code:18,message:'mongodb+srv://secret'};},
        db:()=>({command:async command=>{if(command.createIndexes){if(failure==='index')throw {code:67,message:'secret'};indexes=command.indexes;}},
          collection:name=>({collectionName:name,listIndexes:()=>cursor(indexes),
            bulkWrite:async ops=>{if(failure==='seed')throw Error('secret');return {isOk:()=>true,upsertedCount:ops.length,matchedCount:0,modifiedCount:0};},
            aggregate:()=>cursor(failure==='empty'?[]:[{document:{_id:failure==='rank'?'wrong':'vectorsearch:a'},score:1}])})}),
        close:async()=>{indexes=[];if(failure==='close')throw Error('secret');}
      }}
    ` };
    return nextLoad(url, context);
  }
});
