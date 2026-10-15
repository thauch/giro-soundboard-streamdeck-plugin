import {NativeAudioPlayer} from './player.js';
// One reusable player: every accepted press restarts playback, never overlaps.
export class SoundMixer {
  constructor({createVoice=options=>new NativeAudioPlayer(options),...options}={}) {
    this.control=createVoice(options);
    this.control.onProgress=timing=>{this.timing=timing;this.onProgress?.();};
    this.control.onFinished=()=>this.clearProgress();
    this.control.onError=error=>{this.clearProgress();this.onError?.(error);};
  }
  listOutputs(){return this.control.listOutputs();}
  clearProgress(){this.timing=null;this.file=null;this.onProgress?.();}
  progressFor(file){
    if(file!==this.file || !this.timing || !(this.timing.durationMs>0))return null;
    return Math.round(Math.max(0,Math.min(1,this.timing.positionMs/this.timing.durationMs))*100)/100;
  }
  async play(...args){
    const generation=this.generation=(this.generation || 0)+1;
    this.file=args[1];this.timing=null;this.onProgress?.();
    try{return await this.control.play(...args);}
    catch(error){if(generation===this.generation)this.clearProgress();throw error;}
  }
  async stop(){this.generation=(this.generation || 0)+1;this.clearProgress();return this.control.stop();}
}
