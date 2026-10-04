import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
const { default: config } = await import(new URL('../../rspack.config.mjs', import.meta.url));
function middlewares(){return config.devServer.setupMiddlewares([
 {name:'host-header-check',middleware(){}},
 {name:'rspack-dev-server-invalidate',middleware(){throw Error('unsafe action invoked');}},
 {name:'rspack-dev-server-open-editor',middleware(){throw Error('unsafe action invoked');}},
 {name:'@rspack/dev-middleware',middleware(){}}
]);}
function invoke(url,method='GET'){
 const res={statusCode:200,ended:false,end(){this.ended=true;}};let next=0;
 middlewares()[0].middleware({url,method},res,()=>{next++;});return {status:res.statusCode,ended:res.ended,next};
}
test('dev action handlers are absent before registration, normal middleware preserved',()=>{
 const names=middlewares().map(x=>x.name);
 assert.deepEqual(names,['deny-dev-server-actions','host-header-check','@rspack/dev-middleware']);
});
test('guard blocks action URL variants before next handler for all methods',()=>{
 const urls=['/rspack-dev-server/open-editor?fileName=never-launched','/rspack-dev-server/invalidate','/RSPACK-DEV-SERVER/OPEN-EDITOR','/Rspack-Dev-Server/Invalidate/','/rspack-dev-server/open-editor/?probe=yes','/rspack-dev-server/%69nvalidate?probe=yes','/rspack-dev-server%2fopen-editor','/webpack-dev-server/open-editor','/webpack-dev-server/invalidate'];
 for(const method of ['GET','HEAD','POST','OPTIONS'])for(const url of urls)assert.deepEqual(invoke(url,method),{status:403,ended:true,next:0},`${method} ${url}`);
});
test('guard allows application, assets, HMR, API and harmless dev paths',()=>{
 for(const url of ['/','/main.js','/api/isolated-smoke','/ws','/workspace/personal/interviews','/rspack-dev-server/assets','/rspack-dev-server/invalidate-other'])assert.deepEqual(invoke(url),{status:200,ended:false,next:1},url);
});
test('malformed encoded URL fails closed without invoking next',()=>{
 assert.deepEqual(invoke('/rspack-dev-server/%ZZ'),{status:400,ended:true,next:0});
});
test('CORP protects source assets in plain HTTP mode',()=>{
 assert.equal(config.devServer.headers['Cross-Origin-Resource-Policy'],'same-origin');
});
test('proxy keeps API path filtering and uncompressed realtime streams',()=>{
 assert.equal(config.devServer.compress,false);assert.deepEqual(config.devServer.proxy[0].pathFilter,['/api']);
 assert.equal(config.devServer.proxy[0].changeOrigin,true);
});
test('supported proxy callback destroys upstream when SSE response closes',()=>{
 const response=new EventEmitter();let destroyed=0;
 config.devServer.proxy[0].on.proxyReq({destroy(){destroyed++;}},{url:'/api/realtime/rooms/room-smoke/stream?probe=yes'},response);
 assert.equal(destroyed,0);response.emit('close');assert.equal(destroyed,1);response.emit('close');assert.equal(destroyed,1);
});
test('ordinary API response does not register SSE-only close callback',()=>{
 const response=new EventEmitter();let destroyed=0;
 config.devServer.proxy[0].on.proxyReq({destroy(){destroyed++;}},{url:'/api/isolated-smoke'},response);
 response.emit('close');assert.equal(destroyed,0);assert.equal(response.listenerCount('close'),0);
});
