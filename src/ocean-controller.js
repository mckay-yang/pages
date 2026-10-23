// Lifecycle adapter around stackedlol/ascii-sharks' original World and AsciiRenderer.
class AsciiOcean {
  constructor(canvas) {
    this.canvas=canvas; this.renderer=new AsciiRenderer(canvas); this.world=new World();
    this.renderer.setFontFamily('ui-monospace, SFMono-Regular, Menlo, monospace');
    this.raf=0; this.last=0; this.running=false; this.contextLost=false;
    this.diagnostics={contextLosses:0,contextRestores:0,frames:0};
    this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    canvas.addEventListener('contextlost',()=>{
      // Unlike WebGL, preventing this 2D event would disable automatic restoration.
      this.contextLost=true; this.diagnostics.contextLosses++;
      cancelAnimationFrame(this.raf); this.raf=0; this.last=0;
    });
    canvas.addEventListener('contextrestored',()=>{
      this.contextLost=false; this.diagnostics.contextRestores++;
      this.resize(true);
      if(this.running) this.schedule();
    });
    this.resize();
    this.motion.addEventListener('change',()=>{
      cancelAnimationFrame(this.raf); this.raf=0; this.last=0;
      if(this.running&&!this.motion.matches) this.schedule();
    });
    addEventListener('pointermove',event=>{
      if(this.press?.id===event.pointerId && Math.hypot(event.clientX-this.press.x,event.clientY-this.press.y)>8) this.press=null;
      this.world.pointer.x=event.clientX; this.world.pointer.y=event.clientY;
      this.world.pointer.active=this.running&&event.pointerType!=='touch'&&event.buttons===0;
    },{passive:true});
    addEventListener('pointerdown',event=>{
      this.press=this.running&&event.isPrimary&&event.button===0&&!event.target.closest('button')&&!this.motion.matches
        ? {id:event.pointerId,x:event.clientX,y:event.clientY} : null;
    },{passive:true});
    addEventListener('pointerup',event=>{
      const press=this.press; this.press=null;
      if(press?.id===event.pointerId&&this.running&&!this.motion.matches&&Math.hypot(event.clientX-press.x,event.clientY-press.y)<=8)
        this.world.splash(event.clientX,event.clientY);
    },{passive:true});
    addEventListener('pointercancel',()=>{this.press=null;},{passive:true});
    addEventListener('blur',()=>{this.world.pointer.active=false;});
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible') this.start();
      else this.stop();
    });
    addEventListener('pagehide',()=>this.stop());
    addEventListener('pageshow',()=>{
      if(document.visibilityState==='visible') this.start();
    });
    if(document.visibilityState==='visible') this.start();
  }
  resize(force=false) {
    const width=this.canvas.clientWidth, height=this.canvas.clientHeight, dpr=Math.min(devicePixelRatio||1,1.5);
    if(this.contextLost||!width||!height||(!force&&width===this.width&&height===this.height&&dpr===this.dpr)) return;
    this.width=width; this.height=height; this.dpr=dpr;
    const first=this.world.width===0;
    this.renderer.resize(width,height,dpr);
    // Keep the same animals and simulation time when Safari's viewport changes.
    this.world.resize(width,height,this.renderer.cellWidth,this.renderer.cellHeight);
    if(first) for(let i=0;i<120;i++) this.world.step(1/60);
    this.renderer.render(this.world,0);
    this.diagnostics.frames++;
  }
  schedule() {
    if(this.raf||!this.running||this.contextLost||this.motion.matches) return;
    this.raf=requestAnimationFrame(now=>{
      this.raf=0;
      if(!this.running||this.contextLost||this.motion.matches) return;
      if(!this.last) this.last=now;
      if(now-this.last>=50) {
        const dt=Math.min((now-this.last)/1000,.067); this.last=now;
        const steps=Math.max(1,Math.round(dt*60));
        for(let i=0;i<steps;i++) this.world.step(1/60);
        this.renderer.render(this.world,dt);
        this.diagnostics.frames++;
      }
      this.schedule();
    });
  }
  start() { if(this.running) return; this.running=true; this.last=0; this.schedule(); }
  stop() { this.running=false; cancelAnimationFrame(this.raf); this.raf=0; this.last=0; this.world.pointer.active=false; this.press=null; }
}
window.AsciiOcean=AsciiOcean;
