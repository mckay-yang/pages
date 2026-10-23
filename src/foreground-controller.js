// Move only the foreground, leaving the ocean's viewport and simulation untouched.
class ForegroundMotion {
  constructor(element) {
    this.element=element;
    this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    this.drag=null;
    this.blockClick=false;
    element.addEventListener('pointerdown',event=>{
      if(!event.isPrimary) { this.blockClick=true; this.reset(); return; }
      this.blockClick=false;
      if(event.button!==0||this.motion.matches) return;
      this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
    });
    element.addEventListener('pointermove',event=>{
      const drag=this.drag;
      if(!drag||drag.id!==event.pointerId) return;
      const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<=8) return;
      drag.moved=true;
      this.blockClick=true;
      element.dataset.dragging='true';
      if(!element.hasPointerCapture(event.pointerId)) element.setPointerCapture(event.pointerId);
      const pull=(distance,limit)=>Math.sign(distance)*limit*(1-Math.exp(-Math.abs(distance)/(limit*2)));
      element.style.setProperty('--pull-x',pull(dx,48)+'px');
      element.style.setProperty('--pull-y',pull(dy,80)+'px');
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture']) element.addEventListener(type,event=>{
      if(this.drag?.id===event.pointerId) this.reset();
    });
    // A completed drag must not become a start/stop click. Keyboard activation still works.
    element.addEventListener('click',event=>{
      if(!this.blockClick||event.detail===0) return;
      this.blockClick=false;
      event.preventDefault(); event.stopImmediatePropagation();
    },true);
    this.motion.addEventListener('change',()=>this.reset());
    for(const type of ['blur','pagehide','resize']) addEventListener(type,()=>this.reset());
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState!=='visible') this.reset();
    });
  }
  reset() {
    const drag=this.drag; this.drag=null;
    this.element.dataset.dragging='false';
    this.element.style.removeProperty('--pull-x');
    this.element.style.removeProperty('--pull-y');
    if(drag&&this.element.hasPointerCapture(drag.id)) this.element.releasePointerCapture(drag.id);
  }
}
window.ForegroundMotion=ForegroundMotion;
