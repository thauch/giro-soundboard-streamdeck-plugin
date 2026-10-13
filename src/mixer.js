import {NativeAudioPlayer} from './player.js';
// One reusable player: every accepted press restarts playback, never overlaps.
export class SoundMixer {
  constructor({createVoice=options=>new NativeAudioPlayer(options),...options}={}) {
    this.control=createVoice(options);
    this.control.onError=error=>this.onError?.(error);
  }
  listOutputs(){return this.control.listOutputs();}
  play(...args){return this.control.play(...args);}
  stop(){return this.control.stop();}
}
