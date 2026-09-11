class PCMRecorder extends AudioWorkletProcessor {
 constructor(){super();this.frames=[];this.length=0;this.port.onmessage=e=>{if(e.data==='flush')this.flush(true);};}
 flush(final=false){if(!this.length){if(final)this.port.postMessage({samples:new Float32Array(),final:true});return;}const out=new Float32Array(this.length);let at=0;for(const frame of this.frames){out.set(frame,at);at+=frame.length;}this.port.postMessage({samples:out,final},[out.buffer]);this.frames=[];this.length=0;}
 process(inputs,outputs){const frame=inputs[0]?.[0];if(frame){this.frames.push(frame.slice());this.length+=frame.length;if(this.length>=sampleRate*5)this.flush();}for(const output of outputs)for(const c of output)c.fill(0);return true;}
}
registerProcessor('pcm-recorder',PCMRecorder);
