// Dependency-free lifecycle/fault-injection tests; GPU operations are simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../docs/index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
const settle = async () => { for(let i=0; i<20; i++) await Promise.resolve(); };

function harness(withGL = false) {
  const devices = [], workers = [], locks = [], rafs = new Map(), timers = new Map();
  let gpuAvailable = true;
  let nextId = 0, adapterGate = null;
  class Element extends EventTarget {
    constructor() { super(); this.width=1024; this.height=768; this.dataset={}; this.attrs={}; }
    setAttribute(key,value) { this.attrs[key]=value; }
    removeAttribute(key) { delete this.attrs[key]; }
    cloneNode() { return new Element(); }
    replaceWith() {}
    getContext(kind) {
      if(kind === 'webgl2') return withGL ? {
        canvas:this, createProgram:()=>({}), createShader:()=>({}), shaderSource(){},compileShader(){},
        getShaderParameter:()=>true, attachShader(){},linkProgram(){},getProgramParameter:()=>true,
        getUniformLocation:()=>({}),getExtension:()=>({loseContext(){}}),
        viewport(){},useProgram(){},uniform2f(){},uniform1f(){},uniform1i(){},drawArrays(){}
      } : null;
      return {configure(){}, unconfigure(){}, getCurrentTexture(){return {createView(){return {};}};}};
    }
  }
  function device() {
    const d = new EventTarget(), lost = deferred();
    Object.assign(d, {
      lost: lost.promise, lose: info => lost.resolve(info), dead:false, submissions:0, done:[],
      destroy() { this.dead=true; lost.resolve({reason:'destroyed'}); },
      pushErrorScope(){}, popErrorScope: async()=>null,
      createShaderModule:()=>({}),
      createComputePipeline:()=>({getBindGroupLayout:()=>({})}),
      createRenderPipeline:()=>({getBindGroupLayout:()=>({})}),
      createBuffer:()=>({destroy(){}}), createBindGroup:()=>({}), createSampler:()=>({}),
      createTexture:descriptor=>{assert.equal(descriptor.usage,20); const texture={width:descriptor.size[0],height:descriptor.size[1],destroyed:false,createView:()=>({}),destroy(){this.destroyed=true;}}; (d.textures??=[]).push(texture); return texture;},
      createCommandEncoder:()=>({
        beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(n){assert(n<=1024);},end(){}}),
        beginRenderPass:()=>({setPipeline(){},setBindGroup(){},setScissorRect(x,y,w,h){assert(w<=512&&h<=512);},draw(){},end(){}}),
        finish:()=>({})
      }),
      queue:{writeBuffer(){},submit(){assert(!d.dead);d.submissions++;},onSubmittedWorkDone(){const done=deferred();d.done.push(done);return done.promise;}}
    });
    devices.push(d); return d;
  }
  const nodes = new Map(['toggle','elapsed','gpu-canvas','ocean-canvas'].map(id=>[id,new Element()]));
  const document = new EventTarget();
  Object.assign(document,{visibilityState:'visible',getElementById:id=>nodes.get(id),querySelector:()=>new Element()});
  const window = new EventTarget();
  const context = vm.createContext({
    window, document, console, performance, setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{fn,ms});return id;}, clearTimeout:id=>timers.delete(id),
    setInterval:()=>++nextId, clearInterval(){},
    requestAnimationFrame:fn=>{const id=++nextId;rafs.set(id,fn);return id;}, cancelAnimationFrame:id=>rafs.delete(id),
    addEventListener:window.addEventListener.bind(window), innerWidth:1024, innerHeight:768, devicePixelRatio:2,
    navigator:{hardwareConcurrency:4, gpu:{
      requestAdapter:async()=>{if(adapterGate) await adapterGate.promise;return gpuAvailable ? {requestDevice:async()=>device()} : null;},
      getPreferredCanvasFormat:()=> 'bgra8unorm'
    }, wakeLock:{request:async()=>{const lock=new EventTarget();Object.assign(lock,{released:false,async release(){this.released=true;}});locks.push(lock);return lock;}}},
    Worker:class { constructor(){this.stopped=false;workers.push(this);} postMessage(){} terminate(){this.stopped=true;} },
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Blob,
    GPUBufferUsage:{UNIFORM:1,COPY_DST:2,STORAGE:4}, GPUTextureUsage:{RENDER_ATTACHMENT:16,TEXTURE_BINDING:4}
  });
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, 'window.test = {start,stop,state,nextGPUChunk,frame}; })();'),context);
  return {test:window.test,window,document,devices,workers,locks,rafs,timers,
    setGPUAvailable(value){gpuAvailable=value;},
    async fireTimer(id){const timer=timers.get(id);timers.delete(id);await timer.fn();await settle();},
    gate(){adapterGate=deferred();return adapterGate;},
    draw(){const callbacks=[...rafs.values()];rafs.clear();for(const fn of callbacks)fn(performance.now());}
  };
}

(async()=>{
  const h=harness(true), {test:t}=h;
  const g={elementCount:4194304,computeOffset:0,computePass:0,renderTile:0};
  for(let cycle=0;cycle<2;cycle++) {
    let elements=0, pixels=0, chunks=0, expectedOffset=0;
    do {
      const c=t.nextGPUChunk(g,2731,2049); chunks++;
      if(c.kind==='compute') {assert.equal(c.offset,expectedOffset);elements+=c.count;expectedOffset=(expectedOffset+c.count)%g.elementCount;}
      else {assert(c.x+c.width<=2731&&c.y+c.height<=2049);pixels+=c.width*c.height;}
    } while(g.computePass || g.computeOffset || g.renderTile);
    assert.equal(elements,g.elementCount*4); assert.equal(pixels,2731*2049); assert(chunks>64 && chunks<128);
  }
  await t.start(); h.draw(); await settle();
  assert.equal(t.state.gpu.pending,16); assert.equal(h.devices[0].submissions,16);
  assert.equal(h.devices[0].done.length,4,'One completion callback per four of sixteen queued jobs');
  assert.equal(h.rafs.size,0); const started=t.state.startTime, workerCount=h.workers.length;
  // Lose the first device: CPU and timer remain running; one replacement is allowed.
  h.devices[0].lose({reason:'unknown',message:'simulated reset'}); await settle();h.draw();
  assert(t.state.running); assert.equal(t.state.startTime,started); assert.equal(h.workers.length,workerCount);
  assert(h.workers.every(w=>!w.stopped)); assert.equal(h.devices.length,2);assert.equal(t.state.gpu.pending,16);
  const submissions=h.devices[1].submissions;
  h.devices[0].done.forEach(d=>d.resolve()); await settle();
  assert.equal(h.devices[1].submissions,submissions,'Old completion callbacks cannot submit to the replacement');
  h.devices[1].done.shift().resolve(); await settle();
  assert.equal(t.state.gpu.pending,16);assert.equal(h.devices[1].submissions,submissions+4);
  assert.equal(h.window.burnDiagnostics.gpuCompletionCallbacks,1);
  assert.equal(h.window.burnDiagnostics.gpuComputedElements,4*262144);
  // A later checkpoint can be observed first without double counting or overfilling.
  h.devices[1].done.at(-1).resolve(); await settle();
  assert.equal(t.state.gpu.pending,16);
  h.devices[1].done[0].resolve(); await settle();
  assert.equal(t.state.gpu.pending,16);
  h.devices[1].lose({message:'second reset'});await settle();
  assert.equal(h.devices.length,2,'No unbounded device retry loop');
  assert(t.state.running);assert.equal(t.state.backend,'webgl2');h.draw();
  t.state.gl.gl.canvas.dispatchEvent(new Event('webglcontextlost'));await settle();
  assert(t.state.running);assert.equal(t.state.backend,'cpu-only');
  assert(t.state.gpuRetryTimer,'A lighter fallback schedules WebGPU recovery');
  await h.fireTimer(t.state.gpuRetryTimer);h.draw();
  assert.equal(t.state.backend,'webgpu');assert.equal(t.state.gpuRetryAttempts,1);assert(t.state.running);
  assert.equal(h.workers.length,workerCount);assert.equal(t.state.startTime,started);
  assert.equal(t.state.gpu.pending,16);assert.equal(t.state.gpuRetryTimer,0);
  h.setGPUAvailable(false);h.devices[2].lose({message:'recurring reset'});await settle();
  assert.equal(h.timers.get(t.state.gpuRetryTimer).ms,60000);
  await h.fireTimer(t.state.gpuRetryTimer);
  assert.equal(h.timers.get(t.state.gpuRetryTimer).ms,120000);
  await h.fireTimer(t.state.gpuRetryTimer);
  assert.equal(t.state.gpuRetryAttempts,3);assert.equal(t.state.gpuRetryTimer,0,'Delayed retries have a finite budget');
  t.stop();await settle();assert(h.workers.every(w=>w.stopped));assert(h.locks.every(l=>l.released));assert.equal(h.rafs.size,0);assert.equal(h.timers.size,0);assert(h.devices.every(d=>d.textures.every(t=>t.destroyed)));

  const deferredRun=harness();deferredRun.setGPUAvailable(false);await deferredRun.test.start();
  const oldTimer=deferredRun.timers.get(deferredRun.test.state.gpuRetryTimer);
  deferredRun.test.stop();await deferredRun.test.start();
  const newTimerId=deferredRun.test.state.gpuRetryTimer;
  await oldTimer.fn();await settle();
  assert.equal(deferredRun.test.state.gpuRetryTimer,newTimerId,'Stale timer cannot erase a new run timer');
  deferredRun.window.dispatchEvent(new Event('pagehide'));await settle();
  assert.equal(deferredRun.timers.size,0);assert.equal(deferredRun.test.state.gpuRetryTimer,0);
  assert(!deferredRun.test.state.running);

  // Stop and restart while the old run is still reacquiring an adapter.
  const race=harness(); await race.test.start();race.draw();
  const gate=race.gate();race.devices[0].lose({message:'reset before stop'});await settle();
  race.test.stop();const restarting=race.test.start();gate.resolve();await restarting;await settle();race.draw();
  assert(race.test.state.running);assert.equal(race.devices.length,2,'Stale recovery must not allocate another device');
  assert.equal(race.test.state.gpu.device,race.devices[1]);
  race.window.dispatchEvent(new Event('pagehide'));await settle();
  assert(!race.test.state.running);assert(race.workers.every(w=>w.stopped));assert(race.locks.every(l=>l.released));
  race.window.dispatchEvent(new Event('pageshow'));await settle();assert(!race.test.state.running);
  console.log('PASS: complete chunk coverage, bounded queue, immediate/delayed GPU recovery, retry budget, stale callbacks/timers, texture disposal, pagehide and wake-lock cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
