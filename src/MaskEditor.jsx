import React,{useEffect,useRef,useState} from 'react';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export default function MaskEditor({source,onClose,name='specimen'}){
 const canvas=useRef(null),image=useRef(null),edges=useRef(null);
 const [points,setPoints]=useState([]),[hover,setHover]=useState(null),[closed,setClosed]=useState(false),[snap,setSnap]=useState(true),[radius,setRadius]=useState(14),[color,setColor]=useState('#7777ff'),[width,setWidth]=useState(2),[showFill,setShowFill]=useState(false);
 useEffect(()=>{const img=new Image();img.onload=()=>{image.current=img;const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;const g=new Float32Array(c.width*c.height);for(let y=1;y<c.height-1;y++)for(let x=1;x<c.width-1;x++){const at=(xx,yy)=>{let i=(yy*c.width+xx)*4;return .2126*d[i]+.7152*d[i+1]+.0722*d[i+2]};const dx=at(x+1,y)-at(x-1,y),dy=at(x,y+1)-at(x,y-1);g[y*c.width+x]=Math.hypot(dx,dy)}edges.current=g;paint()};img.src=source;return()=>{image.current=null}},[source]);
 function magnetic(x,y){const img=image.current;if(!snap||!edges.current||!img)return {x,y};let best={x,y},score=-Infinity;for(let dy=-radius;dy<=radius;dy+=2)for(let dx=-radius;dx<=radius;dx+=2){const xx=Math.round(x+dx),yy=Math.round(y+dy);if(xx<1||yy<1||xx>=img.width-1||yy>=img.height-1)continue;const distance=Math.hypot(dx,dy);if(distance>radius)continue;const score=edges.current[yy*img.width+xx]-distance*2.5;if(score>best.score||best.score===undefined){best={x:xx,y:yy,score}}}return {x:best.x,y:best.y}}

 function trace(a,b){
  const img=image.current,g=edges.current;if(!snap||!g||!img)return [a,b];
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),steps=Math.ceil(len/2);
  if(steps<2)return [a,b];
  const normal={x:-dy/len,y:dx/len},span=Math.min(22,radius),states=2*span+1;
  let costs=new Float64Array(states).fill(Infinity);costs[span]=0;
  const back=[];
  for(let t=1;t<=steps;t++){
   const next=new Float64Array(states).fill(Infinity),prev=new Int16Array(states).fill(-1);
   for(let j=0;j<states;j++){
    const off=j-span,x=Math.round(a.x+dx*t/steps+normal.x*off),y=Math.round(a.y+dy*t/steps+normal.y*off);
    if(x<1||y<1||x>=img.width-1||y>=img.height-1)continue;
    const strength=g[y*img.width+x];
    const pixelCost=2.5/(1+strength/18)+Math.abs(off)*.008;
    for(let k=Math.max(0,j-3);k<=Math.min(states-1,j+3);k++){
     const c=costs[k]+pixelCost+Math.abs(k-j)*.12;
     if(c<next[j]){next[j]=c;prev[j]=k}
    }
   }
   back.push(prev);costs=next;
  }
  let best=span;if(!Number.isFinite(costs[best]))best=costs.indexOf(Math.min(...costs));
  const path=[b];for(let t=steps;t>0;t--){const off=best-span;path.push({x:a.x+dx*t/steps+normal.x*off,y:a.y+dy*t/steps+normal.y*off});best=back[t-1][best];if(best<0)break}
  path.push(a);return path.reverse();
 }
 function coords(e){const rect=canvas.current.getBoundingClientRect(),img=image.current;return magnetic(clamp((e.clientX-rect.left)*img.width/rect.width,0,img.width),clamp((e.clientY-rect.top)*img.height/rect.height,0,img.height))}
 function paint(exportOnly=false){const c=canvas.current,img=image.current;if(!c||!img)return; c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);if(!points.length)return;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)for(const p of trace(points[i-1],points[i]).slice(1))ctx.lineTo(p.x,p.y);if(!closed&&hover&&!exportOnly)for(const p of trace(points[points.length-1],hover).slice(1))ctx.lineTo(p.x,p.y);if(closed){for(const p of trace(points[points.length-1],points[0]).slice(1))ctx.lineTo(p.x,p.y);ctx.closePath()}if(closed&&showFill){ctx.fillStyle=color+'33';ctx.fill()}ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();if(!exportOnly){for(const p of points){ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill()}}}
 useEffect(()=>{paint()},[points,hover,closed,color,width,showFill]);
 function save(){paint(true);const a=document.createElement('a');a.href=canvas.current.toDataURL('image/png');a.download=name.replace(/\.[^.]+$/,'')+'_annotated.png';a.click();paint()}
 return <div className="mask-modal" role="dialog" aria-modal="true" aria-label="Magnetic outline editor"><div className="mask-header"><strong>Magnetic outline · non-destructive capture mask</strong><button onClick={onClose}>Close ×</button></div><div className="mask-work"><canvas ref={canvas} onPointerMove={e=>{if(!closed)setHover(coords(e))}} onPointerLeave={()=>setHover(null)} onClick={e=>{if(closed)return;const p=coords(e);if(points.length>2&&Math.hypot(p.x-points[0].x,p.y-points[0].y)<12)setClosed(true);else setPoints(v=>[...v,p])}} onDoubleClick={()=>{if(points.length>2)setClosed(true)}} /></div><div className="mask-controls"><label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Magnetic edge snap</label><label>Radius <input aria-label="Snap radius" type="range" min="4" max="32" value={radius} onChange={e=>setRadius(+e.target.value)}/>{radius}px</label><label>Outline <input aria-label="Outline color" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label><label>Width <input aria-label="Outline width" type="range" min="1" max="8" value={width} onChange={e=>setWidth(+e.target.value)}/>{width}px</label><label><input type="checkbox" checked={showFill} onChange={e=>setShowFill(e.target.checked)}/> Mask tint</label><button onClick={()=>{setPoints(v=>v.slice(0,-1));setClosed(false)}} disabled={!points.length}>Undo point</button><button onClick={()=>{setPoints([]);setClosed(false)}}>Clear</button><button disabled={points.length<3||closed} onClick={()=>setClosed(true)}>Close path</button><button onClick={save} disabled={!points.length}>Save annotated PNG</button></div><p className="mask-help">Click to add magnetic anchors; the line automatically follows high-contrast edges between anchors. Add anchors closer together where the boundary is ambiguous. Double-click to close. This is a screen-space annotation; the GLB and original screenshot are untouched.</p></div>
}
